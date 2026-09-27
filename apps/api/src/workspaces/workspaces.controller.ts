import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Req,
} from "@nestjs/common";
import { deviceSchema, workspaceSchema } from "@clipstage/contracts";
import { parse } from "../common/validation";
import type { AuthRequest } from "../auth/auth.types";
import { WorkspacesService } from "./workspaces.service";

@Controller()
export class WorkspacesController {
  constructor(
    @Inject(WorkspacesService) private readonly workspaces: WorkspacesService,
  ) {}
  @Post("workspaces") create(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.workspaces.create(
      req.actor.userId,
      parse(workspaceSchema, body).name,
    );
  }
  @Patch("workspaces/:workspaceId") rename(
    @Req() req: AuthRequest,
    @Param("workspaceId") id: string,
    @Body() body: unknown,
  ) {
    return this.workspaces.rename(
      req.actor,
      id,
      parse(workspaceSchema, body).name,
    );
  }
  @Post("workspaces/:workspaceId/logo") beginLogo(
    @Req() req: AuthRequest,
    @Param("workspaceId") id: string,
    @Body() body: unknown,
  ) {
    return this.workspaces.beginLogo(req.actor, id, body);
  }
  @Post("workspaces/:workspaceId/logo/complete") completeLogo(
    @Req() req: AuthRequest,
    @Param("workspaceId") id: string,
    @Body() body: unknown,
  ) {
    return this.workspaces.completeLogo(req.actor, id, body);
  }
  @Delete("workspaces/:workspaceId/logo") clearLogo(
    @Req() req: AuthRequest,
    @Param("workspaceId") id: string,
  ) {
    return this.workspaces.clearLogo(req.actor, id);
  }
  @Get("workspaces/:workspaceId/members") members(
    @Req() req: AuthRequest,
    @Param("workspaceId") id: string,
  ) {
    return this.workspaces.members(req.actor, id);
  }
  @Delete("workspaces/:workspaceId/members/:userId") removeMember(
    @Req() req: AuthRequest,
    @Param("workspaceId") id: string,
    @Param("userId") userId: string,
  ) {
    return this.workspaces.removeMember(req.actor, id, userId);
  }
  @Get("workspaces/:workspaceId/invitations") invitations(
    @Req() req: AuthRequest,
    @Param("workspaceId") id: string,
  ) {
    return this.workspaces.invitations(req.actor, id);
  }
  @Post("workspaces/:workspaceId/invitations") invite(
    @Req() req: AuthRequest,
    @Param("workspaceId") id: string,
    @Body() body: unknown,
  ) {
    return this.workspaces.invite(req.actor, id, body);
  }
  @Delete("workspaces/:workspaceId/invitations/:invitationId") cancelInvitation(
    @Req() req: AuthRequest,
    @Param("workspaceId") id: string,
    @Param("invitationId") invitationId: string,
  ) {
    return this.workspaces.cancelInvitation(req.actor, id, invitationId);
  }
  @Get("workspaces/:workspaceId/devices") devices(
    @Req() req: AuthRequest,
    @Param("workspaceId") id: string,
  ) {
    return this.workspaces.devices(req.actor, id);
  }
  @Post("workspaces/:workspaceId/devices") createDevice(
    @Req() req: AuthRequest,
    @Param("workspaceId") id: string,
    @Body() body: unknown,
  ) {
    return this.workspaces.createDevice(
      req.actor,
      id,
      parse(deviceSchema, body).name,
    );
  }
  @Delete("workspaces/:workspaceId/devices/:deviceId") revokeDevice(
    @Req() req: AuthRequest,
    @Param("workspaceId") id: string,
    @Param("deviceId") deviceId: string,
  ) {
    return this.workspaces.revokeDevice(req.actor, id, deviceId);
  }
}
