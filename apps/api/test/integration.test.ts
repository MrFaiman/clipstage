import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chromium, expect as expectBrowser } from "@playwright/test";
import { PrismaClient } from "@clipstage/database";
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type {
  Clip,
  ClipDetail,
  UploadTicket,
  Viewer,
} from "@clipstage/contracts";
import { hashToken, randomToken } from "../src/common/crypto";
import { claimInvites } from "../src/workspaces/workspaces.service";

const integration =
  process.env.RUN_INTEGRATION === "1" ? describe : describe.skip;
integration("real API + PostgreSQL + S3", () => {
  const db = new PrismaClient();
  const origin = "http://localhost:3000",
    base = "http://localhost:4400/v1";
  const ownerToken = randomToken(),
    editorToken = randomToken(),
    outsiderToken = randomToken();
  let ownerId: string,
    editorId: string,
    outsiderId: string,
    workspaceId: string,
    otherWorkspaceId: string;
  let process: Bun.Subprocess<"ignore", "ignore", "pipe"> | undefined;
  const storageKeys: string[] = [];
  const s3 = new S3Client({
    endpoint: Bun.env.S3_ENDPOINT,
    region: Bun.env.S3_REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: Bun.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: Bun.env.S3_SECRET_ACCESS_KEY!,
    },
    requestChecksumCalculation: "WHEN_REQUIRED",
  });
  function request(
    path: string,
    token?: string,
    method = "GET",
    body?: unknown,
    sendOrigin = true,
  ) {
    return fetch(`${base}${path}`, {
      method,
      headers: {
        ...(token?.startsWith("cs_obs_")
          ? { Authorization: `Bearer ${token}` }
          : token
            ? { Cookie: `cs_session=${token}` }
            : {}),
        ...(sendOrigin ? { Origin: origin } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });
  }
  beforeAll(async () => {
    if (
      !Bun.env.DATABASE_URL?.includes("localhost") ||
      !Bun.env.S3_ENDPOINT?.includes("localhost")
    )
      throw new Error(
        "Integration tests must use local development services, never production.",
      );
    await db.$connect();
    const users = await Promise.all(
      [ownerToken, editorToken, outsiderToken].map((token, i) =>
        db.user.create({
          data: {
            name: `integration-${randomToken().slice(0, 6)}-${i}`,
            sessions: {
              create: {
                tokenHash: hashToken(token),
                expiresAt: new Date(Date.now() + 3600000),
              },
            },
          },
        }),
      ),
    );
    [ownerId, editorId, outsiderId] = users.map((user) => user.id) as [
      string,
      string,
      string,
    ];
    const workspace = await db.workspace.create({
      data: {
        name: "Integration studio",
        members: {
          create: [
            { userId: ownerId, role: "OWNER" },
            { userId: editorId, role: "EDITOR" },
          ],
        },
      },
    });
    workspaceId = workspace.id;
    otherWorkspaceId = (
      await db.workspace.create({
        data: {
          name: "Other integration studio",
          members: { create: { userId: outsiderId, role: "OWNER" } },
        },
      })
    ).id;
    process = Bun.spawn(["bun", "apps/api/src/main.ts"], {
      env: { ...Bun.env, NODE_ENV: "test", PORT: "4400", WEB_ORIGIN: origin },
      stdout: "ignore",
      stderr: "pipe",
    });
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(`${base}/health`)).ok) return;
      } catch {
        /* Wait for Nest and Prisma. */
      }
      if (process.exitCode !== null)
        throw new Error(await new Response(process.stderr).text());
      await Bun.sleep(100);
    }
    throw new Error("API startup timed out");
  }, 20000);
  afterAll(async () => {
    process?.kill();
    if (process) await process.exited;
    if (workspaceId) {
      const pending = await db.clip.findMany({
        where: { workspaceId },
        select: { storageKey: true },
      });
      storageKeys.push(...pending.map((clip) => clip.storageKey));
      await Promise.all(
        [...new Set(storageKeys)].map((Key) =>
          s3.send(new DeleteObjectCommand({ Bucket: Bun.env.S3_BUCKET, Key })),
        ),
      );
      await db.workspace.deleteMany({
        where: { id: { in: [workspaceId, otherWorkspaceId] } },
      });
      await db.user.deleteMany({
        where: { id: { in: [ownerId, editorId, outsiderId] } },
      });
    }
    await db.$disconnect();
    s3.destroy();
  });
  test("cookie auth, tenant isolation, and owner-only operations", async () => {
    expect((await request("/auth/me")).status).toBe(401);
    const me = (await (await request("/auth/me", ownerToken)).json()) as Viewer;
    expect(me.id).toBe(ownerId);
    expect("sessions" in me).toBe(false);
    expect(
      (await request(`/workspaces/${workspaceId}/clips`, outsiderToken)).status,
    ).toBe(404);
    expect(
      (
        await request(
          `/workspaces/${workspaceId}/invitations`,
          editorToken,
          "POST",
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          "/workspaces",
          ownerToken,
          "POST",
          { name: "CSRF attempt" },
          false,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          `/workspaces/${workspaceId}/members/${ownerId}`,
          ownerToken,
          "DELETE",
        )
      ).status,
    ).toBe(400);
  });
  test("upload, immutable retry, scoped device, verification, editing, and approval", async () => {
    const response = await request(
      `/workspaces/${workspaceId}/devices`,
      ownerToken,
      "POST",
      { name: "Integration OBS" },
    );
    expect(response.status).toBe(201);
    const device = (await response.json()) as { id: string; token: string };
    expect(device.token).toStartWith("cs_obs_");
    expect(
      (await request(`/workspaces/${workspaceId}/clips`, device.token)).status,
    ).toBe(401);
    const file = Bun.file("apps/web/public/demo-reel.mp4");
    const input = {
      clientUploadId: crypto.randomUUID(),
      title: "Source recording",
      brief: "Keep the first five seconds",
      fileName: "demo.mp4",
      mimeType: "video/mp4",
      sizeBytes: file.size,
      durationSeconds: 12,
    };
    expect(
      (
        await request(
          `/workspaces/${otherWorkspaceId}/clips/uploads`,
          device.token,
          "POST",
          input,
        )
      ).status,
    ).toBe(403);
    const initiated = await request(
      `/workspaces/${workspaceId}/clips/uploads`,
      device.token,
      "POST",
      input,
      false,
    );
    expect(initiated.status).toBe(201);
    const ticket = (await initiated.json()) as UploadTicket;
    expect(ticket.uploadUrl).toBeTruthy();
    expect(
      new URL(ticket.uploadUrl!).searchParams.get("X-Amz-SignedHeaders"),
    ).toContain("if-none-match");
    const again = (await (
      await request(
        `/workspaces/${workspaceId}/clips/uploads`,
        device.token,
        "POST",
        input,
      )
    ).json()) as UploadTicket;
    expect(again.clipId).toBe(ticket.clipId);
    expect(
      (
        await request(
          `/workspaces/${workspaceId}/clips/${ticket.clipId}/complete`,
          device.token,
          "POST",
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await fetch(ticket.uploadUrl!, {
          method: "PUT",
          headers: { "Content-Type": input.mimeType },
          body: file,
        })
      ).status,
    ).toBe(403);
    const uploaded = await fetch(ticket.uploadUrl!, {
      method: "PUT",
      headers: ticket.headers,
      body: file,
    });
    expect(uploaded.status).toBe(200);
    const replaced = await fetch(ticket.uploadUrl!, {
      method: "PUT",
      headers: ticket.headers,
      body: file,
    });
    expect(replaced.status).toBe(412);
    const completion = await request(
      `/workspaces/${workspaceId}/clips/${ticket.clipId}/complete`,
      device.token,
      "POST",
    );
    expect(completion.status).toBe(201);
    const clip = (await completion.json()) as Clip;
    expect(clip.status).toBe("INBOX");
    expect(clip.version).toBe(1);
    const detail = (await (
      await request(`/workspaces/${workspaceId}/clips/${clip.id}`, editorToken)
    ).json()) as ClipDetail;
    expect(detail.playbackUrl).toBeTruthy();
    expect("storageKey" in detail).toBe(false);
    const playback = await fetch(detail.playbackUrl!);
    expect(playback.status).toBe(200);
    expect((await playback.arrayBuffer()).byteLength).toBe(file.size);
    expect(
      (
        await request(
          `/workspaces/${workspaceId}/clips/${clip.id}`,
          editorToken,
          "PATCH",
          { version: 1, assigneeId: outsiderId },
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await request(
          `/workspaces/${workspaceId}/clips/${clip.id}`,
          editorToken,
          "PATCH",
          { version: 1, status: "APPROVED" },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          `/workspaces/${workspaceId}/clips/${clip.id}`,
          editorToken,
          "PATCH",
          { version: 1, trim: { start: 0, end: 15 } },
        )
      ).status,
    ).toBe(400);
    const edit = await request(
      `/workspaces/${workspaceId}/clips/${clip.id}`,
      editorToken,
      "PATCH",
      {
        version: 1,
        status: "IN_REVIEW",
        trim: { start: 0, end: 5 },
        assigneeId: editorId,
      },
    );
    expect(edit.status).toBe(200);
    expect(((await edit.json()) as Clip).version).toBe(2);
    expect(
      (
        await request(
          `/workspaces/${workspaceId}/clips/${clip.id}`,
          ownerToken,
          "PATCH",
          { version: 1, brief: "Stale edit" },
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await request(
          `/workspaces/${workspaceId}/clips/${clip.id}`,
          ownerToken,
          "PATCH",
          { version: 2, status: "APPROVED" },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          `/workspaces/${workspaceId}/clips/${clip.id}`,
          ownerToken,
          "PATCH",
          { version: 3, brief: "Change approved content" },
        )
      ).status,
    ).toBe(409);
    const refreshedTicket = (await (
      await request(
        `/workspaces/${workspaceId}/clips/uploads`,
        device.token,
        "POST",
        input,
      )
    ).json()) as UploadTicket;
    expect(refreshedTicket.uploadUrl).toBeNull();
    expect(refreshedTicket.status).toBe("APPROVED");
    expect(
      (
        await request(
          `/workspaces/${workspaceId}/devices/${device.id}`,
          ownerToken,
          "DELETE",
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          `/workspaces/${workspaceId}/clips/uploads`,
          device.token,
          "POST",
          input,
        )
      ).status,
    ).toBe(401);
  }, 30000);
  (Bun.env.RUN_LIVE_E2E === "1" ? test : test.skip)(
    "browser uploads to real storage and saves an edit through the API",
    async () => {
      const web = Bun.spawn(
        ["bun", "run", "--filter", "@clipstage/web", "dev"],
        {
          env: {
            ...Bun.env,
            NODE_ENV: "development",
            NEXT_PUBLIC_DEMO_MODE: "false",
            NEXT_PUBLIC_API_URL: base,
            API_INTERNAL_URL: base,
          },
          stdout: "ignore",
          stderr: "ignore",
        },
      );
      const browser = await chromium.launch();
      try {
        let ready = false;
        for (let i = 0; i < 120; i++) {
          try {
            if ((await fetch(`${origin}/login`)).ok) {
              ready = true;
              break;
            }
          } catch {
            /* Wait for Next. */
          }
          await Bun.sleep(250);
        }
        if (!ready) throw new Error("Next startup timed out");
        const context = await browser.newContext();
        await context.addCookies([
          {
            name: "cs_session",
            value: ownerToken,
            url: origin,
            httpOnly: true,
            sameSite: "Lax",
          },
        ]);
        const page = await context.newPage();
        await page.goto(`${origin}/?workspace=${workspaceId}`);
        await expectBrowser(page.getByText("Auto-sync on")).toBeVisible();
        await page
          .getByRole("button", { name: "Upload clip", exact: true })
          .click();
        await page
          .locator("input[type=file]")
          .setInputFiles("apps/web/public/demo-reel.mp4");
        await page
          .getByLabel("Give it a name")
          .fill("Browser integration capture");
        await page
          .getByLabel("The brief", { exact: false })
          .fill("A real handoff through browser CORS and S3.");
        await page
          .getByRole("button", { name: "Upload & share with team" })
          .click();
        await expectBrowser(page.getByRole("dialog")).not.toBeVisible({
          timeout: 20000,
        });
        await page
          .getByRole("button", { name: "Open Browser integration capture" })
          .click();
        await expectBrowser(page.locator("video")).toHaveJSProperty(
          "readyState",
          4,
        );
        await page
          .getByLabel("The streamer's brief")
          .fill("Saved by the real editor UI.");
        await page.getByRole("button", { name: "Save changes" }).click();
        await expectBrowser(page.getByRole("dialog")).not.toBeVisible();
        const stored = await db.clip.findFirstOrThrow({
          where: { workspaceId, title: "Browser integration capture" },
        });
        expect(stored.brief).toBe("Saved by the real editor UI.");
        expect(stored.status).toBe("INBOX");
      } finally {
        await browser.close();
        web.kill();
        await web.exited;
      }
    },
    60000,
  );
  test("invitations join a known Kick account, wait for sign-in, and reject ambiguous names", async () => {
    const extraIds: string[] = [];
    const account = {
      accessToken: "test",
      expiresAt: new Date(Date.now() + 3600000),
      scopes: ["user:read"],
      provider: "KICK" as const,
    };
    try {
      await db.oAuthAccount.create({
        data: {
          ...account,
          userId: outsiderId,
          providerUserId: `kick-${outsiderId}`,
          username: "OutsiderKick",
          email: "outsider@example.com",
        },
      });
      const joined = await request(
        `/workspaces/${workspaceId}/invitations`,
        ownerToken,
        "POST",
        { identifier: "outsiderkick" },
      );
      expect(joined.status).toBe(201);
      expect(await joined.json()).toMatchObject({ status: "joined" });
      expect(
        (
          await db.membership.findUniqueOrThrow({
            where: {
              workspaceId_userId: { workspaceId, userId: outsiderId },
            },
          })
        ).role,
      ).toBe("EDITOR");
      expect(
        (
          await request(
            `/workspaces/${workspaceId}/invitations`,
            ownerToken,
            "POST",
            { identifier: "outsider@example.com" },
          )
        ).status,
      ).toBe(409);
      const shared = await Promise.all(
        [0, 1].map((index) =>
          db.user.create({
            data: {
              name: `shared-${index}`,
              accounts: {
                create: {
                  ...account,
                  providerUserId: `shared-${index}-${randomToken()}`,
                  username: "SharedName",
                },
              },
            },
          }),
        ),
      );
      extraIds.push(...shared.map((user) => user.id));
      expect(
        (
          await request(
            `/workspaces/${workspaceId}/invitations`,
            ownerToken,
            "POST",
            { identifier: "sharedname" },
          )
        ).status,
      ).toBe(409);
      const pending = await request(
        `/workspaces/${workspaceId}/invitations`,
        ownerToken,
        "POST",
        { identifier: "future-editor" },
      );
      expect(pending.status).toBe(201);
      expect(((await pending.json()) as { status: string }).status).toBe(
        "pending",
      );
      const future = await db.user.create({ data: { name: "Future Editor" } });
      extraIds.push(future.id);
      await db.$transaction((tx) =>
        claimInvites(tx, future.id, {
          email: null,
          username: "Future-Editor",
        }),
      );
      expect(
        (
          await db.membership.findUniqueOrThrow({
            where: { workspaceId_userId: { workspaceId, userId: future.id } },
          })
        ).role,
      ).toBe("EDITOR");
      expect(
        (
          await db.invitation.findFirstOrThrow({
            where: { workspaceId, username: "future-editor" },
          })
        ).consumedAt,
      ).not.toBeNull();
      const waiting = await request(
        `/workspaces/${workspaceId}/invitations`,
        ownerToken,
        "POST",
        { identifier: "not-yet" },
      );
      expect(waiting.status).toBe(201);
      const listed = (await (
        await request(`/workspaces/${workspaceId}/invitations`, ownerToken)
      ).json()) as { id: string; username: string | null }[];
      const invite = listed.find((item) => item.username === "not-yet");
      expect(invite).toBeTruthy();
      expect(
        (
          await request(
            `/workspaces/${workspaceId}/invitations/${invite!.id}`,
            ownerToken,
            "DELETE",
          )
        ).status,
      ).toBe(200);
      expect(
        (await request(`/workspaces/${workspaceId}/invitations`, editorToken))
          .status,
      ).toBe(403);
      expect(
        (
          await request(
            `/workspaces/${workspaceId}/members/${outsiderId}`,
            ownerToken,
            "DELETE",
          )
        ).status,
      ).toBe(200);
      expect(
        (await request(`/workspaces/${workspaceId}/clips`, outsiderToken))
          .status,
      ).toBe(404);
    } finally {
      if (extraIds.length)
        await db.user.deleteMany({ where: { id: { in: extraIds } } });
    }
  });
});
