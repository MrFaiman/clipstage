import { z } from "zod";

export const ENV = Symbol("ENV");
const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().url(),
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  API_ORIGIN: z.string().url().default("http://localhost:4000"),
  TOKEN_ENCRYPTION_KEY: z
    .string()
    .regex(/^[a-fA-F0-9]{64}$/, "Use openssl rand -hex 32"),
  KICK_CLIENT_ID: z.string().default(""),
  KICK_CLIENT_SECRET: z.string().default(""),
  KICK_REDIRECT_URI: z
    .string()
    .url()
    .default("http://localhost:4000/v1/auth/kick/callback"),
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().min(3),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z
    .enum(["true", "false"])
    .default("false")
    .transform((s) => s === "true"),
  MAX_UPLOAD_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .max(2147483648)
    .default(2147483648),
});
export type Env = z.infer<typeof schema>;
export function loadEnv(
  input: Record<string, string | undefined> = process.env,
): Env {
  const env = schema.parse(input);
  for (const key of ["WEB_ORIGIN", "API_ORIGIN"] as const) {
    if (new URL(env[key]).origin !== env[key])
      throw new Error(`${key} must be an origin without a trailing slash`);
  }
  if (new URL(env.WEB_ORIGIN).hostname !== new URL(env.API_ORIGIN).hostname) {
    throw new Error(
      "App and API must share a hostname for host-only session cookies. Reverse-proxy /v1 to Nest in production.",
    );
  }
  if (env.NODE_ENV === "production") {
    for (const value of [
      env.WEB_ORIGIN,
      env.API_ORIGIN,
      env.KICK_REDIRECT_URI,
      env.S3_ENDPOINT,
    ].filter(Boolean)) {
      if (!value?.startsWith("https://"))
        throw new Error("Production endpoints must use HTTPS");
    }
    if (!env.KICK_CLIENT_ID || !env.KICK_CLIENT_SECRET)
      throw new Error("Production requires Kick credentials");
    // Host-only cookies also reach Next's server loader through the shared hostname.
  }
  return env;
}
