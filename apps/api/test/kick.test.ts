import "reflect-metadata";
import { describe, expect, spyOn, test } from "bun:test";
import {
  kickProfileSchema,
  KickProvider,
  KickRefreshRejected,
} from "../src/auth/kick.provider";
import { loadEnv } from "../src/config";
import { pkceChallenge } from "../src/common/crypto";

const refreshEnv = loadEnv({
  DATABASE_URL: "postgresql://user:pass@localhost:5432/test",
  TOKEN_ENCRYPTION_KEY: "aa".repeat(32),
  S3_BUCKET: "test",
  S3_ACCESS_KEY_ID: "test",
  S3_SECRET_ACCESS_KEY: "test",
  KICK_CLIENT_ID: "client",
  KICK_CLIENT_SECRET: "secret",
});

describe("Kick refresh", () => {
  test("sends a refresh-token grant and validates rotated credentials", async () => {
    const fetch = spyOn(globalThis, "fetch").mockImplementation((async (
      url: Parameters<typeof globalThis.fetch>[0],
      init: Parameters<typeof globalThis.fetch>[1],
    ) => {
      expect(String(url)).toBe("https://id.kick.com/oauth/token");
      expect(init?.method).toBe("POST");
      expect(init?.redirect).toBe("error");
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("grant_type")).toBe("refresh_token");
      expect(body.get("refresh_token")).toBe("old-refresh");
      expect(body.get("client_secret")).toBe("secret");
      return Response.json({
        access_token: "fresh",
        refresh_token: "rotated",
        expires_in: 3600,
      });
    }) as typeof globalThis.fetch);
    try {
      expect(
        await new KickProvider(refreshEnv).refresh("old-refresh"),
      ).toMatchObject({
        access_token: "fresh",
        refresh_token: "rotated",
        scope: "user:read",
      });
    } finally {
      fetch.mockRestore();
    }
  });
  test.each([400, 401])(
    "recognizes rejected refresh tokens (%p)",
    async (status) => {
      const fetch = spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("Do not expose provider errors", { status }),
      );
      try {
        await expect(
          new KickProvider(refreshEnv).refresh("old-refresh"),
        ).rejects.toBeInstanceOf(KickRefreshRejected);
      } finally {
        fetch.mockRestore();
      }
    },
  );
  test.each([403, 429, 500, 503])(
    "temporary/provider errors return 503 (%p)",
    async (status) => {
      const fetch = spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("Sensitive provider details", { status }),
      );
      try {
        await expect(
          new KickProvider(refreshEnv).refresh("old-refresh"),
        ).rejects.toMatchObject({ status: 503 });
      } finally {
        fetch.mockRestore();
      }
    },
  );
  test("timeouts and malformed token responses return 503", async () => {
    const fetch = spyOn(globalThis, "fetch").mockRejectedValue(
      new DOMException("Timed out", "TimeoutError"),
    );
    try {
      await expect(
        new KickProvider(refreshEnv).refresh("old-refresh"),
      ).rejects.toMatchObject({ status: 503 });
      fetch.mockResolvedValue(
        Response.json({ access_token: "", expires_in: -1 }),
      );
      await expect(
        new KickProvider(refreshEnv).refresh("old-refresh"),
      ).rejects.toMatchObject({ status: 503 });
    } finally {
      fetch.mockRestore();
    }
  });
});

describe("Kick provider boundary", () => {
  test("requests basic profile scope, state and S256 PKCE", () => {
    const env = loadEnv({
      DATABASE_URL: "postgresql://user:pass@localhost:5432/test",
      TOKEN_ENCRYPTION_KEY: "aa".repeat(32),
      S3_BUCKET: "test",
      S3_ACCESS_KEY_ID: "test",
      S3_SECRET_ACCESS_KEY: "test",
      KICK_CLIENT_ID: "client",
      KICK_CLIENT_SECRET: "secret",
    });
    const url = new URL(new KickProvider(env).authorize("state", "verifier"));
    expect(url.origin).toBe("https://id.kick.com");
    expect(url.searchParams.get("scope")).toBe("user:read");
    expect(url.searchParams.get("state")).toBe("state");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(
      pkceChallenge("verifier"),
    );
    expect(url.searchParams.has("client_secret")).toBe(false);
  });
  test.each([
    undefined,
    null,
    "",
    "undefined",
    "not-an-id",
    0,
    -1,
    Number.MAX_SAFE_INTEGER + 1,
  ])("rejects malformed provider ID %p", (user_id) => {
    expect(
      kickProfileSchema.safeParse({ data: [{ user_id, name: "Someone" }] })
        .success,
    ).toBe(false);
  });
  test.each([
    undefined,
    null,
    "",
    "not-a-url",
    "http://cdn.example.com/photo.jpg",
    "javascript:alert(1)",
    "https://user:secret@cdn.example.com/photo.jpg",
  ])("ignores unsafe or missing profile picture %p", (profile_picture) => {
    const profile = kickProfileSchema.parse({
      data: [{ user_id: 123, name: "Streamer", profile_picture }],
    }).data[0];
    expect(profile?.profile_picture).toBeNull();
  });
  test("keeps the HTTPS OAuth profile picture", () => {
    const profile = kickProfileSchema.parse({
      data: [
        {
          user_id: 123,
          name: "Streamer",
          profile_picture: "https://cdn.example.com/photo.jpg",
        },
      ],
    }).data[0];
    expect(profile?.profile_picture).toBe("https://cdn.example.com/photo.jpg");
  });
  test("canonicalizes the Kick id and keeps a profile email when present", () => {
    const withEmail = kickProfileSchema.parse({
      data: [{ user_id: 123, name: "Streamer", email: "Streamer@Example.com" }],
    }).data[0];
    expect(withEmail?.user_id).toBe("123");
    expect(withEmail?.email).toBe("streamer@example.com");
    const withoutEmail = kickProfileSchema.parse({
      data: [{ user_id: "123", name: "Streamer" }],
    }).data[0];
    expect(withoutEmail?.user_id).toBe("123");
    expect(withoutEmail?.email).toBeNull();
  });
});
