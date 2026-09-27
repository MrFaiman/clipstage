import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  canSetStatus,
  projectTrim,
  trimSchema,
  type ClipProject,
  type Clip,
  type CreateUpload,
  type UpdateClip,
} from "@clipstage/contracts";
import { Prisma } from "@clipstage/database";
import { Database } from "../common/database";
import { ENV, type Env } from "../config";
import type { Actor } from "../auth/auth.types";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { StorageService } from "./storage.service";

const include = {
  assignee: { select: { id: true, name: true, avatarUrl: true } },
  uploadedBy: { select: { name: true } },
} satisfies Prisma.ClipInclude;
type StoredClip = Prisma.ClipGetPayload<{ include: typeof include }>;
const cursorSchema = z.object({
  createdAt: z.string().datetime(),
  id: z.string().cuid(),
});
function serialize(
  clip: Omit<StoredClip, "project"> & { project?: StoredClip["project"] },
): Clip {
  return {
    id: clip.id,
    title: clip.title,
    brief: clip.brief,
    status: clip.status,
    provider: clip.provider,
    fileName: clip.fileName,
    mimeType: clip.mimeType,
    sizeBytes: Number(clip.sizeBytes),
    durationSeconds: clip.durationSeconds,
    ...(clip.project !== undefined
      ? { project: clip.project as ClipProject | null }
      : {}),
    trim:
      clip.trimStart !== null && clip.trimEnd !== null
        ? { start: clip.trimStart, end: clip.trimEnd }
        : null,
    assignee: clip.assignee,
    uploadedBy: clip.uploadedBy.name,
    createdAt: clip.createdAt.toISOString(),
    updatedAt: clip.updatedAt.toISOString(),
    version: clip.version,
  };
}

@Injectable()
export class ClipsService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(WorkspacesService) private readonly workspaces: WorkspacesService,
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(ENV) private readonly env: Env,
  ) {}
  async list(actor: Actor, workspaceId: string, cursor?: string) {
    await this.workspaces.access(actor, workspaceId);
    let after: z.infer<typeof cursorSchema> | undefined;
    if (cursor) {
      try {
        after = cursorSchema.parse(
          JSON.parse(Buffer.from(cursor, "base64url").toString()),
        );
      } catch {
        throw new BadRequestException("Invalid cursor");
      }
    }
    const clips = await this.db.clip.findMany({
      where: {
        workspaceId,
        ...(after
          ? {
              OR: [
                { createdAt: { lt: new Date(after.createdAt) } },
                { createdAt: new Date(after.createdAt), id: { lt: after.id } },
              ],
            }
          : {}),
      },
      include,
      omit: { project: true }, // Large timelines are fetched on demand, not on every library poll.
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 31,
    });
    const items = clips.slice(0, 30),
      last = items.at(-1);
    return {
      items: items.map(serialize),
      nextCursor:
        clips.length > 30 && last
          ? Buffer.from(
              JSON.stringify({
                id: last.id,
                createdAt: last.createdAt.toISOString(),
              }),
            ).toString("base64url")
          : null,
    };
  }
  async detail(actor: Actor, workspaceId: string, id: string) {
    await this.workspaces.access(actor, workspaceId);
    const clip = await this.find(workspaceId, id);
    const [playbackUrl, downloadUrl] =
      clip.status === "UPLOADING"
        ? [null, null]
        : await Promise.all([
            this.storage.read(clip.storageKey),
            this.storage.read(clip.storageKey, clip.fileName),
          ]);
    return { ...serialize(clip), playbackUrl, downloadUrl };
  }
  async initiate(actor: Actor, workspaceId: string, input: CreateUpload) {
    await this.workspaces.access(actor, workspaceId);
    if (input.sizeBytes > this.env.MAX_UPLOAD_BYTES)
      throw new BadRequestException(
        "This file exceeds the configured upload limit",
      );
    const key = { workspaceId, clientUploadId: input.clientUploadId };
    let clip = await this.db.clip.findUnique({
      where: { workspaceId_clientUploadId: key },
    });
    if (!clip) {
      try {
        clip = await this.db.clip.create({
          data: {
            ...input,
            sizeBytes: BigInt(input.sizeBytes),
            workspaceId,
            uploadedById: actor.userId,
            deviceId: actor.kind === "device" ? actor.deviceId : null,
            storageKey: `sources/${workspaceId}/${randomUUID()}`,
          },
        });
      } catch (error) {
        if (
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          error.code !== "P2002"
        )
          throw error;
        clip = await this.db.clip.findUniqueOrThrow({
          where: { workspaceId_clientUploadId: key },
        });
      }
    }
    this.assertUploader(actor, clip);
    if (
      Number(clip.sizeBytes) !== input.sizeBytes ||
      clip.mimeType !== input.mimeType ||
      clip.fileName !== input.fileName
    )
      throw new ConflictException(
        "Upload ID is already in use for a different file",
      );
    if (clip.status !== "UPLOADING")
      return {
        clipId: clip.id,
        status: clip.status,
        uploadUrl: null,
        headers: {},
        expiresAt: null,
      };
    return {
      clipId: clip.id,
      status: clip.status,
      ...(await this.storage.upload(
        clip.storageKey,
        clip.mimeType,
        Number(clip.sizeBytes),
      )),
    };
  }
  async complete(actor: Actor, workspaceId: string, id: string) {
    await this.workspaces.access(actor, workspaceId);
    const clip = await this.find(workspaceId, id);
    this.assertUploader(actor, clip);
    if (clip.status !== "UPLOADING") return serialize(clip);
    await this.storage.verify(
      clip.storageKey,
      Number(clip.sizeBytes),
      clip.mimeType,
    );
    await this.db.clip.updateMany({
      where: { id, workspaceId, status: "UPLOADING" },
      data: { status: "INBOX", version: { increment: 1 } },
    });
    return serialize(await this.find(workspaceId, id));
  }
  async update(
    actor: Actor,
    workspaceId: string,
    id: string,
    input: UpdateClip,
  ) {
    const membership = await this.workspaces.access(actor, workspaceId);
    if (input.status && !canSetStatus(membership.role, input.status))
      throw new ForbiddenException("Only the owner can approve clips");
    return this.db.$transaction(async (tx) => {
      const current = await tx.clip.findFirst({ where: { id, workspaceId } });
      if (!current) throw new NotFoundException("Clip not found");
      if (current.status === "UPLOADING")
        throw new ConflictException("Wait until the upload is complete");
      if (current.status === "APPROVED" && input.status !== "EDITING")
        throw new ConflictException(
          "Move this approved clip back to In progress before changing it",
        );
      const trim = input.project ? projectTrim(input.project) : input.trim;
      if (trim && !trimSchema.safeParse(trim).success)
        throw new BadRequestException(
          "The first video layer must have a valid source segment",
        );
      if (trim && trim.end > (current.durationSeconds ?? 21600) + 0.1)
        throw new BadRequestException("Trim exceeds the source duration");
      if (input.assigneeId) {
        const assignee = await tx.membership.findUnique({
          where: {
            workspaceId_userId: { workspaceId, userId: input.assigneeId },
          },
        });
        if (!assignee)
          throw new BadRequestException("Assign a member of this workspace");
      }
      const updated = await tx.clip.updateMany({
        where: { id, workspaceId, version: input.version },
        data: {
          title: input.title,
          brief: input.brief,
          status: input.status,
          assigneeId: input.assigneeId,
          ...(trim !== undefined
            ? {
                trimStart: trim?.start ?? null,
                trimEnd: trim?.end ?? null,
              }
            : {}),
          ...(input.project !== undefined
            ? {
                project: input.project === null ? Prisma.DbNull : input.project,
              }
            : {}),
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1)
        throw new ConflictException(
          "Someone updated this clip. Reopen it to load their changes.",
        );
      return serialize(
        await tx.clip.findUniqueOrThrow({ where: { id }, include }),
      );
    });
  }
  private async find(workspaceId: string, id: string) {
    const clip = await this.db.clip.findFirst({
      where: { id, workspaceId },
      include,
    });
    if (!clip) throw new NotFoundException("Clip not found");
    return clip;
  }
  private assertUploader(
    actor: Actor,
    clip: { uploadedById: string; deviceId: string | null },
  ) {
    if (
      clip.uploadedById !== actor.userId ||
      (actor.kind === "device" && clip.deviceId !== actor.deviceId)
    )
      throw new ForbiddenException(
        "This upload belongs to a different uploader",
      );
  }
}
