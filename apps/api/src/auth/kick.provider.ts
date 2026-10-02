import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { z } from "zod";
import { ENV, type Env } from "../config";
import { pkceChallenge } from "../common/crypto";

export class KickRefreshRejected extends Error {
  constructor() {
    super("Kick refresh token was rejected");
  }
}

const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.coerce.number().finite().positive(),
  scope: z.string().default("user:read"),
});
export const kickProfileSchema = z.object({
  data: z
    .array(
      z.object({
        user_id: z
          .union([
            z.number().int().positive().safe(),
            z.string().regex(/^[1-9]\d*$/),
          ])
          .transform(String),
        name: z.string().min(1).max(256),
        email: z
          .string()
          .trim()
          .max(320)
          .nullish()
          .transform((value) => {
            const email = value?.toLowerCase();
            if (!email) return null;
            return z.string().email().safeParse(email).success ? email : null;
          }),
        profile_picture: z
          .string()
          .nullish()
          .transform((value) => {
            if (!value) return null;
            try {
              const url = new URL(value);
              return url.protocol === "https:" && !url.username && !url.password
                ? url.href
                : null;
            } catch {
              return null;
            }
          }),
      }),
    )
    .min(1),
});

/** Provider boundary: add Twitch and Google adapters here without changing workspace auth. */
@Injectable()
export class KickProvider {
  constructor(@Inject(ENV) private readonly env: Env) {}
  authorize(state: string, verifier: string) {
    if (!this.env.KICK_CLIENT_ID || !this.env.KICK_CLIENT_SECRET)
      throw new ServiceUnavailableException("Kick OAuth is not configured yet");
    const url = new URL("https://id.kick.com/oauth/authorize");
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: this.env.KICK_CLIENT_ID,
      redirect_uri: this.env.KICK_REDIRECT_URI,
      scope: "user:read",
      state,
      code_challenge: pkceChallenge(verifier),
      code_challenge_method: "S256",
    }).toString();
    return url.toString();
  }
  async refresh(refreshToken: string) {
    if (!this.env.KICK_CLIENT_ID || !this.env.KICK_CLIENT_SECRET)
      throw new ServiceUnavailableException("Kick OAuth is not configured yet");
    try {
      const response = await fetch("https://id.kick.com/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: this.env.KICK_CLIENT_ID,
          client_secret: this.env.KICK_CLIENT_SECRET,
        }),
        signal: AbortSignal.timeout(15000),
        redirect: "error", // Never forward credentials to a redirect target.
      });
      if (response.status === 400 || response.status === 401)
        throw new KickRefreshRejected();
      if (!response.ok)
        throw new ServiceUnavailableException(
          "Kick is temporarily unavailable",
        );
      return tokenSchema.parse(await response.json());
    } catch (error) {
      if (error instanceof KickRefreshRejected) throw error;
      // Do not expose provider response bodies or transport errors with secrets.
      throw new ServiceUnavailableException(
        "Kick token refresh is temporarily unavailable",
      );
    }
  }
  async exchange(code: string, verifier: string) {
    const response = await fetch("https://id.kick.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        client_id: this.env.KICK_CLIENT_ID,
        client_secret: this.env.KICK_CLIENT_SECRET,
        redirect_uri: this.env.KICK_REDIRECT_URI,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw new ServiceUnavailableException("Kick could not complete sign-in");
    const tokens = tokenSchema.parse(await response.json());
    const profileResponse = await fetch(
      "https://api.kick.com/public/v1/users",
      {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!profileResponse.ok)
      throw new ServiceUnavailableException(
        "Kick profile is temporarily unavailable",
      );
    const profile = kickProfileSchema.parse(await profileResponse.json())
      .data[0]!;
    return { tokens, profile };
  }
}
