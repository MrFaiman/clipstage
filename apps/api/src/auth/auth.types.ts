import { SetMetadata } from "@nestjs/common";
import type { Request } from "express";
export const PUBLIC = "clipstage:public";
export const DEVICE_ALLOWED = "clipstage:device-allowed";
export const Public = () => SetMetadata(PUBLIC, true);
export const DeviceAllowed = () => SetMetadata(DEVICE_ALLOWED, true);
export type Actor =
  | { kind: "session"; userId: string; sessionId: string }
  | { kind: "device"; userId: string; workspaceId: string; deviceId: string };
export type AuthRequest = Request & { actor: Actor };
