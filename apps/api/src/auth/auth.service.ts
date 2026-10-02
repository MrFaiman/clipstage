import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import type { CookieOptions, Request, Response } from "express";
import { Prisma, type Session } from "@clipstage/database";
import type { ActiveSession } from "@clipstage/contracts";
import { Database } from "../common/database";
import { encrypt, hashToken, randomToken, safeEqual } from "../common/crypto";
import { ENV, type Env } from "../config";
import { KickProvider } from "./kick.provider";
import {
  claimInvites,
  WorkspacesService,
} from "../workspaces/workspaces.service";

const DAY = 1000 * 60 * 60 * 24;
const SESSION_AGE = DAY * 30;
const SESSION_CAP = DAY * 90;
export function sessionExpiry(createdAt: Date, now: Date): Date {
  return new Date(
    Math.min(now.getTime() + SESSION_AGE, createdAt.getTime() + SESSION_CAP),
  );
}
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
    const now = new Date();
    return session &&
      session.expiresAt > now &&
      session.createdAt.getTime() + SESSION_CAP > now.getTime()
      ? session
      : null;
  }
  async touch(session: Session, req: Request, res: Response) {
    // SSR cannot deliver Set-Cookie to the browser. Do not let its fetch consume
    // the daily renewal slot before a browser request can renew the cookie.
    if (
      req.headers.origin !== this.env.WEB_ORIGIN &&
      req.headers["sec-fetch-site"] !== "same-origin"
    )
      return;
    const now = new Date();
    const dayAgo = new Date(now.getTime() - DAY);
    if (session.lastUsedAt >= dayAgo) return;
    const expiresAt = sessionExpiry(session.createdAt, now);
    if (expiresAt <= now)
      throw new UnauthorizedException("Sign in to continue");
    const updated = await this.db.session.updateMany({
      where: {
        id: session.id,
        lastUsedAt: { lt: dayAgo },
        expiresAt: { gt: now },
      },
      data: { expiresAt, lastUsedAt: now },
    });
    if (updated.count === 1) {
      res.cookie(this.cookieName, req.cookies[this.cookieName], {
        ...this.cookieOptions(),
        maxAge: expiresAt.getTime() - now.getTime(),
      });
    }
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
    const userId = await this.db
      .$transaction(async (tx) => {
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
        if (attempt.userId) {
          const existing = await tx.oAuthAccount.findUnique({
            where: {
              userId_provider: { userId: attempt.userId, provider: "KICK" },
            },
          });
          if (existing && existing.providerUserId !== profile.user_id)
            throw new ConflictException(
              "Your account already has a Kick connection. Reconnect the same Kick account.",
            );
        }
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
        } else if (!attempt.userId) {
          // Refresh the returning user's picture. Linking another Kick identity
          // must not silently replace the primary account's profile photo.
          await tx.user.update({
            where: { id },
            data: { avatarUrl: profile.profile_picture ?? null },
          });
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
      })
      .catch((error: unknown) => {
        // The DB constraint is authoritative even for concurrent OAuth callbacks.
        // Never replace an existing identity or silently merge another user's account.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        )
          throw new ConflictException(
            "This identity is already connected, or your account already has a connection for this provider.",
          );
        throw error;
      });
    const oldSession = await this.session(req);
    const token = randomToken();
    const now = new Date();
    const expiresAt = sessionExpiry(now, now);
    await this.db.$transaction(async (tx) => {
      if (oldSession)
        await tx.session.deleteMany({ where: { id: oldSession.id } });
      await tx.session.create({
        data: {
          tokenHash: hashToken(token),
          userId,
          createdAt: now,
          lastUsedAt: now,
          userAgent: req.headers["user-agent"]?.slice(0, 256) ?? null,
          expiresAt,
        },
      });
    });
    res.cookie(this.cookieName, token, {
      ...this.cookieOptions(),
      maxAge: expiresAt.getTime() - now.getTime(),
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
  async sessions(userId: string, currentId: string): Promise<ActiveSession[]> {
    const now = new Date();
    const sessions = await this.db.session.findMany({
      where: {
        userId,
        expiresAt: { gt: now },
        createdAt: { gt: new Date(now.getTime() - SESSION_CAP) },
      },
      select: {
        id: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
        userAgent: true,
      },
      orderBy: [{ lastUsedAt: "desc" }, { id: "asc" }],
    });
    return sessions.map((session) => ({
      id: session.id,
      createdAt: session.createdAt.toISOString(),
      lastUsedAt: session.lastUsedAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      userAgent: session.userAgent,
      current: session.id === currentId,
    }));
  }
  async revokeSession(
    userId: string,
    currentId: string,
    id: string,
    res: Response,
  ) {
    const deleted = await this.db.session.deleteMany({ where: { id, userId } });
    if (!deleted.count) throw new NotFoundException("Session not found");
    if (id === currentId)
      res.clearCookie(this.cookieName, this.cookieOptions());
    return { ok: true };
  }
  async revokeOtherSessions(userId: string, currentId: string) {
    await this.db.session.deleteMany({
      where: { userId, id: { not: currentId } },
    });
    return { ok: true };
  }
  async logout(req: Request, res: Response) {
    const session = await this.session(req);
    if (session)
      await this.db.session.deleteMany({ where: { id: session.id } });
    res.clearCookie(this.cookieName, this.cookieOptions());
    return { ok: true };
  }
}
