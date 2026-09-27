import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { CookieOptions, Request, Response } from "express";
import { Database } from "../common/database";
import { encrypt, hashToken, randomToken, safeEqual } from "../common/crypto";
import { ENV, type Env } from "../config";
import { KickProvider } from "./kick.provider";
import {
  claimInvites,
  WorkspacesService,
} from "../workspaces/workspaces.service";

const SESSION_AGE = 1000 * 60 * 60 * 24 * 30;
const STATE_AGE = 1000 * 60 * 10;

@Injectable()
export class AuthService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    @Inject(KickProvider) private readonly kick: KickProvider,
    @Inject(WorkspacesService) private readonly workspaces: WorkspacesService,
  ) {}
  private get cookieName() {
    return this.env.NODE_ENV === "production"
      ? "__Host-cs_session"
      : "cs_session";
  }
  private cookieOptions(path = "/"): CookieOptions {
    return {
      httpOnly: true,
      secure: this.env.NODE_ENV === "production",
      sameSite: "lax",
      path,
    };
  }
  async session(req: Request) {
    const token: unknown = req.cookies?.[this.cookieName];
    if (typeof token !== "string" || token.length > 128) return null;
    const session = await this.db.session.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    return session && session.expiresAt > new Date() ? session : null;
  }
  async begin(req: Request, res: Response) {
    const state = randomToken(),
      verifier = randomToken();
    const url = this.kick.authorize(state, verifier);
    const session = await this.session(req);
    await this.db.oAuthAttempt.create({
      data: {
        stateHash: hashToken(state),
        verifier,
        userId: session?.userId,
        expiresAt: new Date(Date.now() + STATE_AGE),
      },
    });
    res.cookie("cs_oauth", state, {
      ...this.cookieOptions("/v1/auth/kick"),
      maxAge: STATE_AGE,
    });
    res.redirect(url);
  }
  async callback(req: Request, res: Response, code: string, state: string) {
    const cookie: unknown = req.cookies?.cs_oauth;
    res.clearCookie("cs_oauth", this.cookieOptions("/v1/auth/kick"));
    if (typeof cookie !== "string" || !safeEqual(cookie, state))
      throw new BadRequestException("OAuth state mismatch");
    const attempt = await this.db.oAuthAttempt.findUnique({
      where: { stateHash: hashToken(state) },
    });
    if (!attempt || attempt.expiresAt < new Date())
      throw new BadRequestException("Sign-in expired");
    // A linking flow must still belong to the same logged-in browser at callback time.
    if (attempt.userId && (await this.session(req))?.userId !== attempt.userId)
      throw new UnauthorizedException("Your session changed. Start again.");
    const consumed = await this.db.oAuthAttempt.deleteMany({
      where: { stateHash: attempt.stateHash, expiresAt: { gt: new Date() } },
    });
    if (consumed.count !== 1)
      throw new BadRequestException("Sign-in already used");
    const { tokens, profile } = await this.kick.exchange(
      code,
      attempt.verifier,
    );
    const userId = await this.db.$transaction(async (tx) => {
      const identity = await tx.oAuthAccount.findUnique({
        where: {
          provider_providerUserId: {
            provider: "KICK",
            providerUserId: profile.user_id,
          },
        },
      });
      if (attempt.userId && identity && identity.userId !== attempt.userId)
        throw new ConflictException(
          "This Kick account belongs to another user",
        );
      let id = attempt.userId ?? identity?.userId;
      if (!id) {
        const user = await tx.user.create({
          data: {
            name: profile.name,
            avatarUrl: profile.profile_picture ?? null,
            memberships: {
              create: {
                role: "OWNER",
                workspace: {
                  create: { name: `${profile.name}'s studio`.slice(0, 60) },
                },
              },
            },
          },
        });
        id = user.id;
      }
      const data = {
        username: profile.name,
        email: profile.email,
        accessToken: encrypt(
          tokens.access_token,
          this.env.TOKEN_ENCRYPTION_KEY,
        ),
        refreshToken: tokens.refresh_token
          ? encrypt(tokens.refresh_token, this.env.TOKEN_ENCRYPTION_KEY)
          : undefined,
        expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        scopes: tokens.scope.split(" "),
      };
      if (identity) {
        await tx.oAuthAccount.update({ where: { id: identity.id }, data });
      } else {
        // A concurrent identity claim must fail its unique constraint, not silently link another user.
        await tx.oAuthAccount.create({
          data: {
            ...data,
            userId: id,
            provider: "KICK",
            providerUserId: profile.user_id,
          },
        });
      }
      await claimInvites(tx, id, {
        email: profile.email,
        username: profile.name,
      });
      return id;
    });
    const oldSession = await this.session(req);
    const token = randomToken();
    await this.db.$transaction(async (tx) => {
      if (oldSession)
        await tx.session.deleteMany({ where: { id: oldSession.id } });
      await tx.session.create({
        data: {
          tokenHash: hashToken(token),
          userId,
          expiresAt: new Date(Date.now() + SESSION_AGE),
        },
      });
    });
    res.cookie(this.cookieName, token, {
      ...this.cookieOptions(),
      maxAge: SESSION_AGE,
    });
    res.redirect(`${this.env.WEB_ORIGIN}/`);
  }
  async me(userId: string) {
    const user = await this.db.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        avatarUrl: true,
        accounts: { select: { id: true, provider: true, username: true } },
        memberships: {
          orderBy: { createdAt: "asc" },
          select: {
            role: true,
            workspace: { select: { id: true, name: true, logoKey: true } },
          },
        },
      },
    });
    return {
      id: user.id,
      name: user.name,
      avatarUrl: user.avatarUrl,
      connections: user.accounts,
      workspaces: await Promise.all(
        user.memberships.map((membership) =>
          this.workspaces.present(membership.workspace, membership.role),
        ),
      ),
    };
  }
  async logout(req: Request, res: Response) {
    const session = await this.session(req);
    if (session)
      await this.db.session.deleteMany({ where: { id: session.id } });
    res.clearCookie(this.cookieName, this.cookieOptions());
    return { ok: true };
  }
}
