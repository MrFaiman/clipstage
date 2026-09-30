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
import { PART_SIZE, StorageService } from "./storage.service";

const include = {
  assignee: { select: { id: true, name: true, avatarUrl: true } },
  uploadedBy: { select: { name: true } },
} satisfies Prisma.ClipInclude;
type StoredClip = Prisma.ClipGetPayload<{ include: typeof include }>;
const cursorSchema = z.object({
  createdAt: z.string().datetime(),
  id: z.string().cuid(),
});
function sameTrim(
  a: { start: number; end: number } | null | undefined,
  b: { start: number; end: number } | null | undefined,
) {
  if (!a || !b) return !a && !b;
  return Math.abs(a.start - b.start) < 0.001 && Math.abs(a.end - b.end) < 0.001;
}
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
    if (Number(clip.sizeBytes) > PART_SIZE) {
      if (!clip.multipartId) {
        const uploadId = await this.storage.startMultipart(
          clip.storageKey,
          clip.mimeType,
        );
        const claimed = await this.db.clip.updateMany({
          where: { id: clip.id, status: "UPLOADING", multipartId: null },
          data: { multipartId: uploadId },
        });
        if (!claimed.count) {
          await this.storage.abortMultipart(clip.storageKey, uploadId);
        }
        clip = await this.db.clip.findUniqueOrThrow({ where: { id: clip.id } });
      }
      if (clip.status !== "UPLOADING")
        return {
          clipId: clip.id,
          status: clip.status,
          uploadUrl: null,
          headers: {},
          expiresAt: null,
        };
      if (!clip.multipartId)
        throw new ConflictException("Retry upload initiation");
      const size = Number(clip.sizeBytes);
      const count = Math.ceil(size / PART_SIZE);
      let parts: Awaited<ReturnType<StorageService["parts"]>>;
      try {
        parts = await this.storage.parts(clip.storageKey, clip.multipartId);
      } catch (error) {
        if (!(error instanceof Error && error.name === "NoSuchUpload"))
          throw error;
        await this.storage.verify(
          clip.storageKey,
          Number(clip.sizeBytes),
          clip.mimeType,
        );
        parts = Array.from({ length: count }, (_, index) => ({
          number: index + 1,
          length: Math.min(PART_SIZE, size - index * PART_SIZE),
          etag: "",
        }));
      }
      return {
        clipId: clip.id,
        status: clip.status,
        uploadUrl: null,
        headers: {},
        expiresAt: null,
        multipart: {
          partSize: PART_SIZE,
          partCount: count,
          uploadedParts: parts
            .filter(
              (p) =>
                p.number >= 1 &&
                p.number <= count &&
                p.length ===
                  Math.min(PART_SIZE, size - (p.number - 1) * PART_SIZE),
            )
            .map((p) => p.number),
        },
      };
    }
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
  async part(actor: Actor, workspaceId: string, id: string, number: number) {
    await this.workspaces.access(actor, workspaceId);
    const clip = await this.find(workspaceId, id);
    this.assertUploader(actor, clip);
    if (clip.status !== "UPLOADING" || !clip.multipartId)
      throw new ConflictException("No active multipart upload");
    if (number < 1 || number > Math.ceil(Number(clip.sizeBytes) / PART_SIZE))
      throw new BadRequestException("Invalid part number");
    return {
      uploadUrl: await this.storage.part(
        clip.storageKey,
        clip.multipartId,
        number,
        Math.min(PART_SIZE, Number(clip.sizeBytes) - (number - 1) * PART_SIZE),
      ),
      expiresAt: new Date(Date.now() + 900000).toISOString(),
    };
  }
  async complete(actor: Actor, workspaceId: string, id: string) {
    await this.workspaces.access(actor, workspaceId);
    const clip = await this.find(workspaceId, id);
    this.assertUploader(actor, clip);
    if (clip.status !== "UPLOADING") return serialize(clip);
    if (clip.multipartId) {
      let finalized = false;
      try {
        await this.storage.verify(
          clip.storageKey,
          Number(clip.sizeBytes),
          clip.mimeType,
        );
        finalized = true; // Another request completed, or the process died before updating the row.
      } catch (error) {
        if (!(error instanceof BadRequestException)) throw error;
      }
      if (!finalized) {
        // List parts on the server: client-supplied ETags/lengths cannot be trusted.
        const count = Math.ceil(Number(clip.sizeBytes) / PART_SIZE);
        let parts: Awaited<ReturnType<StorageService["parts"]>> = [];
        let valid = false;
        // Some S3-compatible stores expose an earlier version briefly after a
        // part is replaced. Re-read a few times; never complete with wrong sizes.
        for (let attempt = 0; attempt < 4; attempt++) {
          if (attempt)
            await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
          try {
            parts = await this.storage.parts(clip.storageKey, clip.multipartId);
          } catch (error) {
            if (!(error instanceof Error && error.name === "NoSuchUpload"))
              throw error;
            await this.storage.verify(
              clip.storageKey,
              Number(clip.sizeBytes),
              clip.mimeType,
            );
            finalized = true;
            break;
          }
          valid =
            parts.length === count &&
            parts.every(
              (part, index) =>
                part.number === index + 1 &&
                part.length ===
                  Math.min(
                    PART_SIZE,
                    Number(clip.sizeBytes) - index * PART_SIZE,
                  ),
            );
          if (valid) break;
        }
        if (!finalized && !valid)
          throw new BadRequestException(
            "Upload is missing parts or has invalid part sizes",
          );
        if (!finalized)
          try {
            await this.storage.finishMultipart(
              clip.storageKey,
              clip.multipartId,
              parts.map((part) => ({ number: part.number, etag: part.etag })),
            );
          } catch (error) {
            // A concurrent /complete may have finalized the same upload already.
            // Never accept a failed completion unless the final object matches.
            if (!(error instanceof Error && error.name === "NoSuchUpload"))
              throw error;
          }
      }
    }
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
      if (
        input.project &&
        input.trim !== undefined &&
        !sameTrim(trim, input.trim)
      )
        throw new BadRequestException(
          "Trim must match the project's first video layer. Change the cut in the timeline.",
        );
      if (
        input.project === undefined &&
        input.trim !== undefined &&
        current.project !== null &&
        !sameTrim(input.trim, projectTrim(current.project as ClipProject))
      )
        throw new ConflictException(
          "This clip has a saved timeline. Change the cut in the timeline, or clear the project.",
        );
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
