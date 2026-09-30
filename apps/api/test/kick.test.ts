import "reflect-metadata";
import { describe, expect, test } from "bun:test";
import { kickProfileSchema, KickProvider } from "../src/auth/kick.provider";
import { loadEnv } from "../src/config";
import { pkceChallenge } from "../src/common/crypto";

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
