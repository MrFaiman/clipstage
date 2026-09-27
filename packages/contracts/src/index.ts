import { z } from "zod";
import { videoProjectSchema, type ClipProject } from "./video-project";
export * from "./video-project";

export const providers = ["KICK", "TWITCH", "YOUTUBE"] as const;
export const clipStatuses = [
  "UPLOADING",
  "INBOX",
  "EDITING",
  "IN_REVIEW",
  "APPROVED",
] as const;
export type Provider = (typeof providers)[number];
export type ClipStatus = (typeof clipStatuses)[number];
export type Role = "OWNER" | "EDITOR";

export const MAX_UPLOAD_BYTES = 2 * 1024 ** 3;
export const mimeTypes = [
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-matroska",
] as const;
export const createUploadSchema = z
  .object({
    clientUploadId: z.string().uuid(),
    title: z.string().trim().min(1).max(120),
    brief: z.string().trim().max(4000).default(""),
    fileName: z
      .string()
      .min(1)
      .max(255)
      .regex(/^[^/\\\u0000-\u001f]+$/, "Use a file name, not a path"),
    mimeType: z.enum(mimeTypes),
    sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
    durationSeconds: z.number().positive().max(21600).optional(),
    provider: z.enum(providers).default("KICK"),
  })
  .strict();
export type CreateUpload = z.infer<typeof createUploadSchema>;

export const trimSchema = z
  .object({
    start: z.number().finite().min(0),
    end: z.number().finite().positive(),
  })
  .strict()
  .refine(
    (trim) => trim.end > trim.start,
    "Out point must be after the in point",
  );

export const updateClipSchema = z
  .object({
    version: z.number().int().min(0),
    title: z.string().trim().min(1).max(120).optional(),
    brief: z.string().trim().max(4000).optional(),
    status: z.enum(["INBOX", "EDITING", "IN_REVIEW", "APPROVED"]).optional(),
    assigneeId: z.string().cuid().nullable().optional(),
    trim: trimSchema.nullable().optional(),
    project: videoProjectSchema.nullable().optional(),
  })
  .strict();
export type UpdateClip = z.infer<typeof updateClipSchema>;
export const workspaceSchema = z
  .object({ name: z.string().trim().min(2).max(60) })
  .strict();
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
export const LOGO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const logoUploadSchema = z
  .object({
    mimeType: z.enum(LOGO_TYPES),
    sizeBytes: z.number().int().positive().max(MAX_LOGO_BYTES),
  })
  .strict();
export const completeLogoSchema = logoUploadSchema
  .extend({ key: z.string().min(1).max(512) })
  .strict();
export type LogoUpload = z.infer<typeof logoUploadSchema>;
export interface LogoTicket {
  key: string;
  uploadUrl: string;
  headers: Record<string, string>;
  expiresAt: string;
}
export const deviceSchema = z
  .object({ name: z.string().trim().min(2).max(60) })
  .strict();
export const inviteSchema = z
  .object({ identifier: z.string().trim().min(1).max(254) })
  .strict();
export type InviteIdentifier = z.infer<typeof inviteSchema>;
export type InviteResult =
  { status: "joined"; name: string } | { status: "pending"; expiresAt: string };
export interface PendingInvite {
  id: string;
  email: string | null;
  username: string | null;
  expiresAt: string;
  createdAt: string;
}

export interface Person {
  id: string;
  name: string;
  avatarUrl: string | null;
}
export interface Workspace {
  id: string;
  name: string;
  role: Role;
  logoUrl: string | null;
}
export interface Connection {
  id: string;
  provider: Provider;
  username: string;
}
export interface Viewer extends Person {
  workspaces: Workspace[];
  connections: Connection[];
}
export interface Member extends Person {
  role: Role;
}
export interface Clip {
  id: string;
  title: string;
  brief: string;
  status: ClipStatus;
  provider: Provider;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  durationSeconds: number | null;
  trim: { start: number; end: number } | null;
  project?: ClipProject | null;
  assignee: Person | null;
  uploadedBy: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}
export interface ClipPage {
  items: Clip[];
  nextCursor: string | null;
}
export interface ClipDetail extends Clip {
  playbackUrl: string | null;
  downloadUrl: string | null;
}
export interface UploadTicket {
  clipId: string;
  status: ClipStatus;
  uploadUrl: string | null;
  headers: Record<string, string>;
  expiresAt: string | null;
}
export interface Device {
  id: string;
  name: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string | null;
}
export interface WorkspaceData {
  clips: Clip[];
  members: Member[];
  nextCursor: string | null;
}

export const statusLabels: Record<ClipStatus, string> = {
  UPLOADING: "Uploading",
  INBOX: "New clip",
  EDITING: "In progress",
  IN_REVIEW: "In review",
  APPROVED: "Approved",
};
export function canManageWorkspace(role: Role): boolean {
  return role === "OWNER";
}
export function canSetStatus(role: Role, status: ClipStatus): boolean {
  return status !== "UPLOADING" && (status !== "APPROVED" || role === "OWNER");
}
