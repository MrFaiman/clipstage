import "reflect-metadata";
import { describe, expect, test } from "bun:test";
import {
  decrypt,
  encrypt,
  hashToken,
  pkceChallenge,
  randomToken,
  safeEqual,
} from "../src/common/crypto";
import { trustedMutation } from "../src/auth/auth.guard";
import { loadEnv } from "../src/config";

const key = "b7".repeat(32);
describe("credential protection", () => {
  test("encrypts and round trips tokens", () => {
    const encrypted = encrypt("provider-secret", key);
    expect(encrypted).not.toContain("provider-secret");
    expect(decrypt(encrypted, key)).toBe("provider-secret");
    expect(encrypt("provider-secret", key)).not.toBe(encrypted);
  });
  test("detects tampering and wrong keys", () => {
    const encrypted = encrypt("secret", key);
    const parts = encrypted.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decrypt(parts.join("."), key)).toThrow();
    expect(() => decrypt(encrypted, "a2".repeat(32))).toThrow();
  });
  test("creates unguessable URL-safe credentials with deterministic hashes", () => {
    const token = randomToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(token);
    expect(hashToken(token)).toHaveLength(64);
    expect(hashToken(token)).toBe(hashToken(token));
  });
  test("PKCE S256 matches the RFC 7636 vector", () => {
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });
  test("state comparison fails safely for different lengths", () => {
    expect(safeEqual("state", "state")).toBe(true);
    expect(safeEqual("state", "other")).toBe(false);
    expect(safeEqual("state", "")).toBe(false);
  });
});
describe("origin enforcement", () => {
  const origin = "https://app.clipstage.test";
  test("session mutations need the exact app origin", () => {
    expect(trustedMutation("POST", origin, origin, false)).toBe(true);
    expect(trustedMutation("PATCH", "https://evil.test", origin, false)).toBe(
      false,
    );
    expect(trustedMutation("DELETE", undefined, origin, false)).toBe(false);
    expect(
      trustedMutation(
        "POST",
        "https://app.clipstage.test.evil.test",
        origin,
        false,
      ),
    ).toBe(false);
  });
  test("authenticated device clients do not need browser origins", () => {
    expect(trustedMutation("POST", undefined, origin, true)).toBe(true);
  });
  test("read-only requests don't need a browser origin", () => {
    expect(trustedMutation("GET", undefined, origin, false)).toBe(true);
  });
});
describe("environment safety", () => {
  const env = {
    DATABASE_URL: "postgresql://user:pass@localhost:5432/test",
    TOKEN_ENCRYPTION_KEY: key,
    S3_BUCKET: "test",
    S3_ACCESS_KEY_ID: "test",
    S3_SECRET_ACCESS_KEY: "test",
  };
  test("rejects a missing encryption key", () => {
    expect(() =>
      loadEnv({ ...env, TOKEN_ENCRYPTION_KEY: "placeholder" }),
    ).toThrow();
  });
  test("rejects noncanonical origins", () => {
    expect(() =>
      loadEnv({ ...env, WEB_ORIGIN: "http://localhost:3000/" }),
    ).toThrow();
  });
  test("rejects split hosts that would break host-only SSR cookies", () => {
    expect(() =>
      loadEnv({ ...env, API_ORIGIN: "http://api.localhost:4000" }),
    ).toThrow("share a hostname");
  });
  test("production cannot silently use insecure local defaults", () => {
    expect(() => loadEnv({ ...env, NODE_ENV: "production" })).toThrow("HTTPS");
  });
  test("parses boolean settings explicitly", () => {
    expect(
      loadEnv({ ...env, S3_FORCE_PATH_STYLE: "false" }).S3_FORCE_PATH_STYLE,
    ).toBe(false);
  });
});
