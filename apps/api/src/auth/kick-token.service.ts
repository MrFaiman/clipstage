import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { Prisma, type OAuthAccount } from "@clipstage/database";
import { Database } from "../common/database";
import { decrypt, encrypt } from "../common/crypto";
import { ENV, type Env } from "../config";
import { KickProvider, KickRefreshRejected } from "./kick.provider";

@Injectable()
export class KickTokenService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    @Inject(KickProvider) private readonly kick: KickProvider,
  ) {}
  private account(account: OAuthAccount | null) {
    if (!account) throw new NotFoundException("Connection not found");
    if (account.provider !== "KICK")
      throw new BadRequestException("Expected a Kick connection");
    return account;
  }
  private reconnect(): never {
    throw new UnauthorizedException("Reconnect Kick to continue");
  }
  /** Internal use only. Callers must authorize ownership before supplying an account ID. */
  async accessToken(accountId: string): Promise<string> {
    const account = this.account(
      await this.db.oAuthAccount.findUnique({ where: { id: accountId } }),
    );
    if (account.needsReconnect) return this.reconnect();
    if (account.expiresAt.getTime() > Date.now() + 60000)
      return decrypt(account.accessToken, this.env.TOKEN_ENCRYPTION_KEY);

    // A rejected refresh must COMMIT its flag, so return a result from the
    // transaction and throw only afterwards. Throwing inside would roll it back.
    const result = await this.db
      .$transaction(
        async (tx) => {
          const locked = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT "id" FROM "OAuthAccount" WHERE "id" = ${accountId} FOR UPDATE
      `);
          if (!locked.length)
            throw new NotFoundException("Connection not found");
          const current = this.account(
            await tx.oAuthAccount.findUnique({ where: { id: accountId } }),
          );
          if (current.needsReconnect) return { reconnect: true } as const;
          // Another request may have refreshed while this transaction waited.
          if (current.expiresAt.getTime() > Date.now() + 60000)
            return {
              token: decrypt(
                current.accessToken,
                this.env.TOKEN_ENCRYPTION_KEY,
              ),
            };
          if (!current.refreshToken) {
            await tx.oAuthAccount.update({
              where: { id: accountId },
              data: { needsReconnect: true },
            });
            return { reconnect: true } as const;
          }
          let tokens;
          try {
            tokens = await this.kick.refresh(
              decrypt(current.refreshToken, this.env.TOKEN_ENCRYPTION_KEY),
            );
          } catch (error) {
            if (!(error instanceof KickRefreshRejected)) throw error;
            await tx.oAuthAccount.update({
              where: { id: accountId },
              data: { needsReconnect: true },
            });
            return { reconnect: true } as const;
          }
          await tx.oAuthAccount.update({
            where: { id: accountId },
            data: {
              accessToken: encrypt(
                tokens.access_token,
                this.env.TOKEN_ENCRYPTION_KEY,
              ),
              refreshToken: tokens.refresh_token
                ? encrypt(tokens.refresh_token, this.env.TOKEN_ENCRYPTION_KEY)
                : current.refreshToken,
              expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
              scopes: tokens.scope.split(" "),
              needsReconnect: false,
            },
          });
          return { token: tokens.access_token };
        },
        { maxWait: 20000, timeout: 25000 },
      )
      .catch((error: unknown) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          ["P2028", "P2034"].includes(error.code)
        )
          throw new ServiceUnavailableException(
            "Kick token refresh is busy; try again",
          );
        throw error;
      });
    if ("reconnect" in result) return this.reconnect();
    return result.token;
  }
}
