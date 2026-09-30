import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Response } from "express";
import { Database } from "../common/database";
import { hashToken } from "../common/crypto";
import { ENV, type Env } from "../config";
import { AuthService } from "./auth.service";
import { DEVICE_ALLOWED, PUBLIC, type AuthRequest } from "./auth.types";

export function trustedMutation(
  method: string,
  origin: string | undefined,
  expected: string,
  device: boolean,
): boolean {
  return (
    ["GET", "HEAD", "OPTIONS"].includes(method) || device || origin === expected
  );
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(Database) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
  ) {}
  async canActivate(context: ExecutionContext) {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, targets)) return true;
    const req = context.switchToHttp().getRequest<AuthRequest>();
    const bearer = req.headers.authorization;
    let browserSession: Awaited<ReturnType<AuthService["session"]>> = null;
    if (bearer) {
      if (
        !this.reflector.getAllAndOverride<boolean>(DEVICE_ALLOWED, targets) ||
        !/^Bearer cs_obs_[A-Za-z0-9_-]{43}$/.test(bearer)
      )
        throw new UnauthorizedException("Invalid device credential");
      const device = await this.db.device.findUnique({
        where: { tokenHash: hashToken(bearer.slice(7)) },
      });
      if (!device || device.revokedAt || device.expiresAt <= new Date())
        throw new UnauthorizedException("Device expired or revoked");
      req.actor = {
        kind: "device",
        deviceId: device.id,
        workspaceId: device.workspaceId,
        userId: device.createdById,
      };
      await this.db.device.update({
        where: { id: device.id },
        data: { lastSeenAt: new Date() },
      });
    } else {
      const session = await this.auth.session(req);
      if (!session) throw new UnauthorizedException("Sign in to continue");
      browserSession = session;
      req.actor = {
        kind: "session",
        userId: session.userId,
        sessionId: session.id,
      };
    }
    if (
      !trustedMutation(
        req.method,
        req.headers.origin,
        this.env.WEB_ORIGIN,
        req.actor.kind === "device",
      )
    )
      throw new ForbiddenException("Untrusted request origin");
    if (browserSession)
      await this.auth.touch(
        browserSession,
        req,
        context.switchToHttp().getResponse<Response>(),
      );
    return true;
  }
}
