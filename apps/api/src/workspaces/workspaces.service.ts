import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@clipstage/database";
import { inviteSchema } from "@clipstage/contracts";
import { z } from "zod";
import { Database } from "../common/database";
import { hashToken, randomToken } from "../common/crypto";
import { parse } from "../common/validation";
import { ENV, type Env } from "../config";
import type { Actor } from "../auth/auth.types";

const INVITE_WINDOW = 7 * 86400000;

export async function claimInvites(
  tx: Prisma.TransactionClient,
  userId: string,
  profile: { email: string | null; username: string },
) {
  const email = profile.email?.trim().toLowerCase() || null;
  const username = profile.username.trim().toLowerCase();
  const matches = [
    ...(email ? [{ email }] : []),
    ...(username ? [{ username }] : []),
  ];
  if (!matches.length) return;
  const invites = await tx.invitation.findMany({
    where: {
      consumedAt: null,
      expiresAt: { gt: new Date() },
      OR: matches,
    },
  });
  for (const invite of invites) {
    await tx.membership.upsert({
      where: {
        workspaceId_userId: { workspaceId: invite.workspaceId, userId },
      },
      update: {},
      create: { workspaceId: invite.workspaceId, userId, role: "EDITOR" },
    });
    await tx.invitation.updateMany({
      where: { id: invite.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
  }
}

@Injectable()
export class WorkspacesService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
  ) {}
  async access(actor: Actor, workspaceId: string, ownerOnly = false) {
    if (actor.kind === "device" && actor.workspaceId !== workspaceId)
      throw new ForbiddenException("Device is scoped to another workspace");
    const membership = await this.db.membership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: actor.userId } },
    });
    if (!membership) throw new NotFoundException("Workspace not found");
    if (ownerOnly && membership.role !== "OWNER")
      throw new ForbiddenException("Only the workspace owner can do this");
    return membership;
  }
  async create(userId: string, name: string) {
    const workspace = await this.db.workspace.create({
      data: { name, members: { create: { userId, role: "OWNER" } } },
      select: { id: true, name: true },
    });
    return { ...workspace, role: "OWNER" as const };
  }
  async members(actor: Actor, workspaceId: string) {
    await this.access(actor, workspaceId);
    const members = await this.db.membership.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "asc" },
      include: { user: { select: { id: true, name: true, avatarUrl: true } } },
    });
    return members.map((member) => ({ ...member.user, role: member.role }));
  }
  async removeMember(actor: Actor, workspaceId: string, userId: string) {
    await this.access(actor, workspaceId, true);
    await this.db.$transaction(async (tx) => {
      const membership = await tx.membership.findUnique({
        where: { workspaceId_userId: { workspaceId, userId } },
      });
      if (!membership) throw new NotFoundException("Member not found");
      if (membership.role === "OWNER")
        throw new BadRequestException("The owner cannot be removed");
      await tx.clip.updateMany({
        where: { workspaceId, assigneeId: userId },
        data: { assigneeId: null, version: { increment: 1 } },
      });
      await tx.membership.delete({
        where: { workspaceId_userId: { workspaceId, userId } },
      });
    });
    return { ok: true };
  }
  async invite(actor: Actor, workspaceId: string, body: unknown) {
    await this.access(actor, workspaceId, true);
    const { identifier } = parse(inviteSchema, body);
    const isEmail = identifier.includes("@");
    if (isEmail && !z.string().email().safeParse(identifier).success)
      throw new BadRequestException("Enter a valid email address");
    const key = identifier.toLowerCase();
    const matches = await this.db.oAuthAccount.findMany({
      where: {
        provider: "KICK",
        ...(isEmail
          ? { email: { equals: key, mode: "insensitive" } }
          : { username: { equals: key, mode: "insensitive" } }),
      },
      select: { userId: true, user: { select: { name: true } } },
    });
    const people = [
      ...new Map(matches.map((match) => [match.userId, match])).values(),
    ];
    if (people.length > 1)
      throw new ConflictException(
        isEmail
          ? "More than one Kick account uses that email."
          : "More than one Kick account uses that name. Invite by email.",
      );
    if (people.length === 1) {
      const person = people[0]!;
      const existing = await this.db.membership.findUnique({
        where: { workspaceId_userId: { workspaceId, userId: person.userId } },
      });
      if (existing)
        throw new ConflictException("They already belong to this workspace");
      await this.db.membership.create({
        data: { workspaceId, userId: person.userId, role: "EDITOR" },
      });
      return { status: "joined" as const, name: person.user.name };
    }
    const expiresAt = new Date(Date.now() + INVITE_WINDOW);
    const pending = await this.db.invitation.findFirst({
      where: {
        workspaceId,
        ...(isEmail ? { email: key } : { username: key }),
      },
    });
    if (pending) {
      const updated = await this.db.invitation.update({
        where: { id: pending.id },
        data: { expiresAt, consumedAt: null },
      });
      return {
        status: "pending" as const,
        expiresAt: updated.expiresAt.toISOString(),
      };
    }
    const created = await this.db.invitation.create({
      data: {
        workspaceId,
        email: isEmail ? key : null,
        username: isEmail ? null : key,
        expiresAt,
      },
    });
    return {
      status: "pending" as const,
      expiresAt: created.expiresAt.toISOString(),
    };
  }
  async invitations(actor: Actor, workspaceId: string) {
    await this.access(actor, workspaceId, true);
    const invites = await this.db.invitation.findMany({
      where: {
        workspaceId,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: {
        id: true,
        email: true,
        username: true,
        expiresAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
    return invites.map((invite) => ({
      ...invite,
      expiresAt: invite.expiresAt.toISOString(),
      createdAt: invite.createdAt.toISOString(),
    }));
  }
  async cancelInvitation(actor: Actor, workspaceId: string, id: string) {
    await this.access(actor, workspaceId, true);
    const result = await this.db.invitation.deleteMany({
      where: { id, workspaceId, consumedAt: null },
    });
    if (!result.count) throw new NotFoundException("Invitation not found");
    return { ok: true };
  }
  async devices(actor: Actor, workspaceId: string) {
    await this.access(actor, workspaceId, true);
    return this.db.device.findMany({
      where: { workspaceId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: {
        id: true,
        name: true,
        createdAt: true,
        expiresAt: true,
        lastSeenAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
  }
  async createDevice(actor: Actor, workspaceId: string, name: string) {
    await this.access(actor, workspaceId, true);
    const token = `cs_obs_${randomToken()}`;
    const device = await this.db.device.create({
      data: {
        workspaceId,
        createdById: actor.userId,
        name,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 90 * 86400000),
      },
      select: { id: true, name: true, expiresAt: true },
    });
    return {
      ...device,
      token,
      workspaceId,
      apiUrl: `${this.env.API_ORIGIN}/v1`,
    };
  }
  async revokeDevice(actor: Actor, workspaceId: string, id: string) {
    await this.access(actor, workspaceId, true);
    const result = await this.db.device.updateMany({
      where: { id, workspaceId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (!result.count) throw new NotFoundException("Device not found");
    return { ok: true };
  }
}
