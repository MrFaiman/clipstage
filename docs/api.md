# API v1

Base: `http://localhost:4000/v1`. JSON unless redirecting or accessing a signed storage URL. Shared input schemas and DTOs live in `packages/contracts/src/index.ts`.

## Auth and errors

Browser requests use `credentials: include`. Sessions have a 30-day idle expiry and a 90-day absolute lifetime. Authenticated browser API requests renew expiry and the session cookie at most daily; Next server-side reads do not renew. Expired sessions cannot be renewed. Mutations must include the exact app `Origin`; no browser bearer tokens are stored in localStorage. The API emits `Cache-Control: no-store` and restricts CORS to `WEB_ORIGIN`.

OBS requests use `Authorization: Bearer cs_obs_<credential>` **only** on the two upload endpoints. Device tokens have no list/read/edit/admin scope. They are bound to a workspace, hashed at rest, expire in 90 days, and are returned once on creation.

Errors have this shape:

```json
{
  "statusCode": 409,
  "message": "Someone updated this clip. Reopen it to load their changes."
}
```

Relevant statuses: 400 invalid input/pending upload, 401 absent/expired authentication, 403 insufficient role or untrusted mutation origin, 404 unavailable resource/workspace, 409 conflict, 429 rate limit. Successful `POST` endpoints return 201 by default, `PATCH` and `DELETE` return 200. An already-completed upload is safe to complete again.

## Provider connections

Each user may have at most one identity per provider (Kick, Twitch, YouTube). Only Kick OAuth is implemented today. A signed-in Kick callback may connect Kick if not already linked, or refresh credentials for the same linked Kick identity. Attempting to link a different Kick identity returns 409 without replacing the existing connection. Identities owned by another user also return 409; users are never merged by email.

## Browser sessions

`GET /auth/sessions` returns an array of `{ id, createdAt, lastUsedAt, expiresAt, userAgent, current }`. Timestamps are ISO 8601; `userAgent` is nullable and limited to 256 characters when recorded at sign-in. `lastUsedAt` updates at most daily and is not a precise activity log. No token hashes or bearer tokens are returned. `/auth/me` continues to omit sessions.

Session mutations require the exact app Origin. A successful DELETE returns `{ "ok": true }` (200); revoke-others returns `{ "ok": true }` (201). Revoking the current session clears its HttpOnly cookie; the frontend then navigates to login. Revoke-others leaves other users and OBS device credentials untouched. OBS bearer credentials cannot use any session-management route. A revoked session fails subsequent authentication; in-flight requests may already have passed the guard.

## Routes

| Method | Route                                                | Access / purpose                                                          |
| ------ | ---------------------------------------------------- | ------------------------------------------------------------------------- |
| GET    | `/health`                                            | Public liveness                                                           |
| GET    | `/auth/kick`                                         | Sign in, connect Kick once, or reconnect the same linked identity            |
| GET    | `/auth/kick/callback`                                | Browser-bound state + PKCE callback                                       |
| GET    | `/auth/me`                                           | Safe user profile, connections, workspace memberships                     |
| POST   | `/auth/logout`                                       | Revoke current session and clear cookie                                   |
| GET    | `/auth/sessions`                                     | List this user's unexpired browser sessions; mark the current session      |
| DELETE | `/auth/sessions/:id`                                 | Revoke an owned session; 404 if missing/not owned; clears cookie if current |
| POST   | `/auth/sessions/revoke-others`                        | Revoke all this user's sessions except the current one                     |
| POST   | `/workspaces`                                        | Create workspace; body `{ "name": "My studio" }`                          |
| PATCH  | `/workspaces/:workspaceId`                           | Owner; body `{ "name" }`; renames the workspace                           |
| POST   | `/workspaces/:workspaceId/logo`                      | Owner; body `{ mimeType, sizeBytes }`; JPEG, PNG, or WebP up to 2 MiB     |
| POST   | `/workspaces/:workspaceId/logo/complete`             | Owner; verifies the upload and stores its object key                      |
| DELETE | `/workspaces/:workspaceId/logo`                      | Owner; removes the logo                                                   |
| GET    | `/workspaces/:workspaceId/members`                   | Members                                                                   |
| DELETE | `/workspaces/:workspaceId/members/:userId`           | Owner only; cannot remove owner; unassigns clips                          |
| GET    | `/workspaces/:workspaceId/invitations`               | Owner; unexpired pending invites                                          |
| POST   | `/workspaces/:workspaceId/invitations`               | Owner; body `{ identifier }`; Kick email or username; does not send email |
| DELETE | `/workspaces/:workspaceId/invitations/:invitationId` | Owner; cancels a pending invite                                           |
| GET    | `/workspaces/:workspaceId/devices`                   | Owner; active device metadata, no secrets                                 |
| POST   | `/workspaces/:workspaceId/devices`                   | Owner; body `{ name }`; returns one-time connection settings              |
| DELETE | `/workspaces/:workspaceId/devices/:deviceId`         | Owner; revokes credential                                                 |
| GET    | `/workspaces/:workspaceId/clips?cursor=...`          | Members; newest first, 30 per page, opaque cursor                         |
| GET    | `/workspaces/:workspaceId/clips/:clipId`             | Members; safe metadata + signed playback/download URLs                    |
| POST   | `/workspaces/:workspaceId/clips/uploads`             | Member or scoped OBS device; initiate/retry                               |
| POST   | `/workspaces/:workspaceId/clips/:clipId/complete`    | Original uploader / initiating device; verify and release                 |
| PATCH  | `/workspaces/:workspaceId/clips/:clipId`             | Members; versioned edit; owner-only approval                              |

## Device pairing

Request:

```http
POST /v1/workspaces/WORKSPACE_ID/devices
Content-Type: application/json
Origin: http://localhost:3000
Cookie: cs_session=YOUR_SESSION

{ "name": "Streaming PC" }
```

Response includes `id`, `name`, `expiresAt`, and the connection settings below. Copy these into the OBS dock:

```json
{
  "apiUrl": "http://localhost:4000/v1",
  "workspaceId": "YOUR_WORKSPACE_ID",
  "token": "cs_obs_YOUR_ONE_TIME_SECRET"
}
```

Examples use placeholders; they are not usable credentials. The dock keeps this configuration only in memory.

## Upload a clip

### 1. Initiate

```http
POST /v1/workspaces/WORKSPACE_ID/clips/uploads
Authorization: Bearer cs_obs_YOUR_ONE_TIME_SECRET
Content-Type: application/json

{
  "clientUploadId": "4bf29d60-066d-42bb-81a9-2d757fd41d47",
  "title": "The final round clutch",
  "brief": "Keep the last push and my reaction. Aim for a tight vertical edit.",
  "fileName": "clutch.mp4",
  "mimeType": "video/mp4",
  "sizeBytes": 1048576,
  "durationSeconds": 42.5,
  "provider": "KICK"
}
```

`durationSeconds` is optional. `provider` defaults to KICK. Supported MIME types: `video/mp4`, `video/webm`, `video/quicktime`, `video/x-matroska`. Maximum size: 2 GiB or the lower configured server limit. Briefs: 4,000 characters; titles: 120. No client-controlled object keys or paths.

Response:

```json
{
  "clipId": "CLIP_ID",
  "status": "UPLOADING",
  "uploadUrl": "https://YOUR_STORAGE/PRESIGNED_URL",
  "headers": { "Content-Type": "video/mp4", "If-None-Match": "*" },
  "expiresAt": "2026-09-26T14:39:00.000Z"
}
```

### 2. Upload directly

PUT the **raw file**, not multipart/form-data, to `uploadUrl`. Include every returned header exactly. Do **not** send the Clipstage bearer token/cookie to storage. Browser XHR sets Content-Length from the file automatically.

```ts
const result = await fetch(ticket.uploadUrl, {
  method: "PUT",
  headers: ticket.headers,
  body: file,
});
if (!result.ok && result.status !== 412) throw new Error("Retry upload");
```

A 412 on retry means an object already exists at this immutable key; continue to verification. If the URL expires, repeat initiation with the **same clientUploadId** to get a fresh URL. If that clip has already completed, initiation returns its current status with `uploadUrl: null`, `expiresAt: null`, and empty headers. Never generate a new client ID for an ordinary network retry.

For files **larger than 8 MiB**, initiation instead returns `uploadUrl: null` and `multipart: { "partSize": 8388608, "partCount": N, "uploadedParts": [1, ...] }`. Slice the file into numbered 8 MiB parts (the last may be smaller). For each missing part, call `POST /v1/workspaces/WORKSPACE_ID/clips/CLIP_ID/parts/PART_NUMBER` with your session/OBS credential. The response contains `uploadUrl` and `expiresAt`; PUT that part's raw bytes to the URL **without app credentials**. After a lost response, repeat initiation to list saved parts, then request fresh URLs for missing parts. Do not send client-supplied ETags to `/complete`; the API lists and validates parts itself. Configure your bucket to abort incomplete multipart uploads after a suitable interval.

### 3. Complete

```http
POST /v1/workspaces/WORKSPACE_ID/clips/CLIP_ID/complete
Authorization: Bearer cs_obs_YOUR_ONE_TIME_SECRET
```

Nest verifies stored byte count/content type, conditionally transitions to INBOX, and returns the safe `Clip` DTO. Missing/mismatched objects cannot become reviewable. If a changed file needs uploading, create a new UUID; original keys cannot be overwritten.

## Edit

```http
PATCH /v1/workspaces/WORKSPACE_ID/clips/CLIP_ID
Content-Type: application/json
Origin: http://localhost:3000
Cookie: cs_session=YOUR_SESSION

{
  "version": 1,
  "brief": "Keep the opening reaction and end on the laugh.",
  "assigneeId": "A_WORKSPACE_MEMBER_CUID",
  "status": "IN_REVIEW",
  "trim": { "start": 2.5, "end": 28 }
}
```

`version` is required. Other fields are optional; `title` is also editable. `assigneeId: null` unassigns; `trim: null` clears trim points. `start >= 0`, `end > start`, finite values only, with end bounded by the declared source duration when available. `APPROVED` requires OWNER. Reopen approved clips to EDITING before changing their content. `UPLOADING` is not an editable status.

A successful edit returns the updated DTO and incremented version. **409** means reload/reconcile instead of blindly retrying. An optional nullable `project` contains the full VideoFlow VideoJSON (up to 1 MiB). When present, its first video layer determines the trim; a project without video layers clears the trim. A `trim` sent with a project must match that layer (**400** otherwise). A trim-only edit to a clip with a saved project must match its cut (**409** otherwise); change the cut in the timeline or clear the project. Other tracks, text, effects, and keyframes are preserved. `project: null` clears the saved project. Detail and update responses include the project; library pages omit it. Store the original media as `clipstage:source`, not an expiring S3 URL or a local blob. The web editor rebinds that reference on open. MP4 exports download locally through VideoFlow; no server render/upload endpoint is called and the original source is unchanged.

## Storage setup

Use a private bucket with public access disabled. Grant the API's identity only the bucket/object permissions needed for signing PUT/GET and HEAD; production provisioning should happen separately. `storage:init` is restricted to loopback endpoints.

Apply `infra/s3-cors.json` after replacing the example origin. CORS must allow `PUT`, `GET`, `HEAD`, `Content-Type`, and `If-None-Match`. Keep the signed conditional header intact in proxies. S3-compatible implementations must enforce signed headers and conditional PUT; the integration suite checks both. `S3_ENDPOINT` must be reachable by browsers and OBS because it is embedded in signed URLs. For AWS, omit it and use the region/bucket; set `S3_FORCE_PATH_STYLE=false`.
