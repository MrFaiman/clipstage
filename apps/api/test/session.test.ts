import "reflect-metadata";
import { expect, test } from "bun:test";
import type { Request, Response } from "express";
import type { Session } from "@clipstage/database";
import { AuthService, sessionExpiry } from "../src/auth/auth.service";
import { AuthCleanupService } from "../src/auth/auth-cleanup.service";
import type { Database } from "../src/common/database";
import type { Env } from "../src/config";
import type { KickProvider } from "../src/auth/kick.provider";
import type { WorkspacesService } from "../src/workspaces/workspaces.service";

const day = 86400000;
const createdAt = new Date("2026-01-01T00:00:00Z");
test("session expiry slides by 30 days without exceeding 90 days from login", () => {
  expect(sessionExpiry(createdAt, createdAt).getTime()).toBe(
    createdAt.getTime() + 30 * day,
  );
  expect(
    sessionExpiry(
      createdAt,
      new Date(createdAt.getTime() + 45 * day),
    ).getTime(),
  ).toBe(createdAt.getTime() + 75 * day);
  expect(
    sessionExpiry(
      createdAt,
      new Date(createdAt.getTime() + 80 * day),
    ).getTime(),
  ).toBe(createdAt.getTime() + 90 * day);
  expect(
    sessionExpiry(
      createdAt,
      new Date(createdAt.getTime() + 95 * day),
    ).getTime(),
  ).toBeLessThan(createdAt.getTime() + 95 * day);
});

test("SSR does not consume renewal; recent activity and lost CAS do not send cookies", async () => {
  let writes = 0,
    cookies = 0;
  const db = {
    session: {
      updateMany: async () => {
        writes++;
        return { count: 0 };
      },
    },
  } as unknown as Database;
  const auth = new AuthService(
    db,
    { WEB_ORIGIN: "https://app.test", NODE_ENV: "production" } as Env,
    {} as KickProvider,
    {} as WorkspacesService,
  );
  const session = {
    id: "id",
    createdAt: new Date(),
    lastUsedAt: new Date(Date.now() - 2 * day),
    expiresAt: new Date(Date.now() + day),
  } as Session;
  const req = {
    headers: {},
    cookies: { "__Host-cs_session": "token" },
  } as unknown as Request;
  const res = {
    cookie: () => {
      cookies++;
    },
  } as unknown as Response;
  await auth.touch(session, req, res);
  expect(writes).toBe(0);
  req.headers["sec-fetch-site"] = "same-origin";
  await auth.touch({ ...session, lastUsedAt: new Date() }, req, res);
  expect(writes).toBe(0);
  await auth.touch(session, req, res);
  expect(writes).toBe(1);
  expect(cookies).toBe(0);
});

test("cleanup tolerates database failure and can run again", async () => {
  let runs = 0;
  const db = {
    session: {
      deleteMany: async () => {
        if (++runs === 1) throw new Error("DB offline");
        return { count: 0 };
      },
    },
    oAuthAttempt: { deleteMany: async () => ({ count: 0 }) },
  } as unknown as Database;
  const cleanup = new AuthCleanupService(db);
  await cleanup.cleanup();
  await cleanup.cleanup();
  cleanup.onModuleDestroy();
  expect(runs).toBe(2);
});
