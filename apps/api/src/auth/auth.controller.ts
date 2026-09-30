import {
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";
import { parse } from "../common/validation";
import { AuthService } from "./auth.service";
import { Public, type AuthRequest } from "./auth.types";

@Controller("auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  @Public()
  @Get("kick")
  begin(@Req() req: Request, @Res() res: Response) {
    return this.auth.begin(req, res);
  }
  @Public()
  @Get("kick/callback")
  callback(@Req() req: Request, @Res() res: Response, @Query() query: unknown) {
    const data = parse(
      z.object({
        code: z.string().min(1).max(2048),
        state: z.string().min(32).max(128),
      }),
      query,
    );
    return this.auth.callback(req, res, data.code, data.state);
  }
  @Get("me") me(@Req() req: AuthRequest) {
    return this.auth.me(req.actor.userId);
  }
  private sessionActor(req: AuthRequest) {
    if (req.actor.kind !== "session")
      throw new UnauthorizedException("Session required");
    return req.actor;
  }
  @Get("sessions") sessions(@Req() req: AuthRequest) {
    const actor = this.sessionActor(req);
    return this.auth.sessions(actor.userId, actor.sessionId);
  }
  @Delete("sessions/:id") revokeSession(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const actor = this.sessionActor(req);
    return this.auth.revokeSession(
      actor.userId,
      actor.sessionId,
      parse(z.string().cuid(), id),
      res,
    );
  }
  @Post("sessions/revoke-others") revokeOthers(@Req() req: AuthRequest) {
    const actor = this.sessionActor(req);
    return this.auth.revokeOtherSessions(actor.userId, actor.sessionId);
  }
  @Post("logout") logout(
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.auth.logout(req, res);
  }
}
