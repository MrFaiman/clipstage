import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { z } from "zod";
import { createUploadSchema, updateClipSchema } from "@clipstage/contracts";
import { DeviceAllowed, type AuthRequest } from "../auth/auth.types";
import { parse } from "../common/validation";
import { ClipsService } from "./clips.service";

@Controller("workspaces/:workspaceId/clips")
export class ClipsController {
  constructor(@Inject(ClipsService) private readonly clips: ClipsService) {}
  @Get() list(
    @Req() req: AuthRequest,
    @Param("workspaceId") workspaceId: string,
    @Query() query: unknown,
  ) {
    return this.clips.list(
      req.actor,
      workspaceId,
      parse(z.object({ cursor: z.string().max(512).optional() }), query).cursor,
    );
  }
  @Get(":id") detail(
    @Req() req: AuthRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("id") id: string,
  ) {
    return this.clips.detail(req.actor, workspaceId, id);
  }
  @DeviceAllowed() @Post("uploads") initiate(
    @Req() req: AuthRequest,
    @Param("workspaceId") workspaceId: string,
    @Body() body: unknown,
  ) {
    return this.clips.initiate(
      req.actor,
      workspaceId,
      parse(createUploadSchema, body),
    );
  }
  @DeviceAllowed() @Post(":id/parts/:number") part(
    @Req() req: AuthRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("id") id: string,
    @Param("number") number: string,
  ) {
    if (!/^[1-9]\d{0,3}$/.test(number))
      throw new BadRequestException("Invalid part number");
    return this.clips.part(req.actor, workspaceId, id, Number(number));
  }
  @DeviceAllowed() @Post(":id/complete") complete(
    @Req() req: AuthRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("id") id: string,
  ) {
    return this.clips.complete(req.actor, workspaceId, id);
  }
  @Patch(":id") update(
    @Req() req: AuthRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.clips.update(
      req.actor,
      workspaceId,
      id,
      parse(updateClipSchema, body),
    );
  }
}
