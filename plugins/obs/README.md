# Clipstage OBS dock — source preview

Native OBS plugins use C/C++. This is the only non-TypeScript application component. It uses the OBS frontend API and Qt 6 Network, with asynchronous, file-streamed uploads (no extra local server or Node/Bun inside OBS).

## Requirements

- OBS Studio **30+**, built with Qt 6; development exports for `libobs` and `obs-frontend-api`.
- The **same Qt version and architecture as your OBS build**, including Core, Widgets, and Network.
- CMake 3.28+ and a C++17 compiler.
- A configured Clipstage API, PostgreSQL, private S3 bucket, and owner-issued device credential.

The application's Bun build does **not** compile this plugin. A normal OBS application installation often does not include the development CMake exports. Build/install the matching OBS source or obtain its development SDK first. Qt/OBS ABI mismatch can crash OBS; test in a separate profile before use on a real stream.

## Build

```sh
cmake -S plugins/obs -B plugins/obs/build \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_PREFIX_PATH="/path/to/obs-sdk;/path/to/qt6"
cmake --build plugins/obs/build --config Release
cmake --install plugins/obs/build --config Release --prefix /path/to/staging
```

Copy the resulting plugin to the plugin directory for your OBS installation:

- Linux: `~/.config/obs-studio/plugins/clipstage-obs/bin/64bit/clipstage-obs.so`
- Windows: `%APPDATA%\obs-studio\plugins\clipstage-obs\bin\64bit\clipstage-obs.dll`
- macOS: `~/Library/Application Support/obs-studio/plugins/clipstage-obs.plugin`

These paths depend on OBS packaging; Flatpak and portable builds differ. macOS distribution requires signing/notarization and testing library install names; Windows distribution requires compatible runtime dependencies. No signed/prebuilt binaries are provided.

## Connect and capture

1. Start Clipstage with demo mode **off**. Open **OBS integration** in your workspace.
2. Create a named device credential. Copy the JSON configuration.
3. Restart OBS and open **Docks → Clipstage**.
4. Click **Paste connection settings**. The token is kept **only in memory**; clear the clipboard after pairing. Pair again after restarting OBS. Loading settings is not a connectivity check; the first upload validates them.
5. Set OBS recording output to H.264/AAC MP4 (hybrid/fragmented MP4 is preferred for crash resilience). MKV and some MOV/WebM codecs are not browser-playable.
6. Enter a title/brief **before the recording is stopped or the replay is saved**. They are copied into that upload's job.
7. Use **Start clip recording**, then **Stop recording & upload**. This controls OBS's normal recording output; it does not start/stop the stream and cannot create a second independent recording output.
8. If you keep a full-stream recording, enable/start OBS's **Replay Buffer** and use **Save replay clip** instead. Configure its duration and memory cap in OBS.

While auto-upload is checked, stopped recordings and saved replays triggered elsewhere in OBS (including OBS hotkeys) also upload. Disabling auto-upload does not cancel jobs already queued. Split-file recording events are not handled; disable splitting for short clip recordings, or manually upload individual files.

## Upload behavior

- `POST /v1/workspaces/:id/clips/uploads` gets a presigned ticket.
- Files up to 8 MiB stream as one immutable PUT. Larger files upload directly to S3 in 8 MiB parts; the API lists uploaded parts when a job resumes. A bounded 8 MiB part is read into memory at a time. Application credentials are **never** sent to S3.
- `POST /v1/workspaces/:id/clips/:clipId/complete` verifies size/content type, then releases the clip to the inbox.
- Jobs use stable UUIDs for idempotent retries. A repeated immutable S3 PUT may return 412; the plugin proceeds to API verification rather than treating it as a failed upload.
- Up to 20 waiting jobs, one active upload. The queue is saved atomically in the OS application-data directory (`clipstage-queue.json`), including the active job and its UUID. The token is **never saved**. After restarting OBS, paste the original workspace connection again to resume; do not delete the saved queue file while jobs are pending. Only use OBS with a trusted local OS account: paths, titles, and briefs are stored in the queue file with owner-only permissions.
- Transient connection errors, HTTP 408/429, and server errors retry up to five times with exponential delays (2–32 seconds). Other errors pause the queue for manual retry or skip. A retry reuses the UUID; if the prior PUT succeeded, 412 triggers verification. Subsequent jobs pause behind a failed job.
- Files changed/moved after queueing must be skipped and re-added. **Original files are never removed.**
- Use **Upload an existing clip…** to recover a capture made before pairing or when the queue could not be saved.
- TLS certificates are verified. API redirects are not followed; HTTPS is required except for loopback development endpoints. Error logs never include tokens or presigned URLs.

## Preview limitations

There is no OS-keychain integration, thumbnail generation, or transcoding. Set a bucket lifecycle rule to abort incomplete multipart uploads after a suitable interval (e.g. seven days). Automatic retries are bounded; permanent failures require manual action. The maximum file size is 2 GiB (the API may impose a lower limit). A revoked token cannot make new API requests, but an already-issued presigned URL can remain usable for up to 15 minutes; a revoked device cannot finalize the upload.

Linux ARM64 compilation has been checked with OBS 30.0.2 and Qt 6.4.2. Reproduce a Linux compilation check with `docker build -f plugins/obs/Dockerfile.buildcheck plugins/obs` from the repository root. This does not launch OBS. Native builds on other targets and actual recording/upload behavior must be validated on each supported OS before distribution. See `../../docs/architecture.md` for the rollout checklist.
