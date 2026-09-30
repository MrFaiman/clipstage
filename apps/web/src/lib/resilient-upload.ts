import type { UploadTicket } from "@clipstage/contracts";
import { ApiError, StorageUploadError } from "./api";

export async function retryCompletion<T>(
  complete: () => Promise<T>,
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await complete();
    } catch (error) {
      // The server may have finalized the clip but lost its response. /complete
      // is idempotent; retry only transport failures, throttling, and 5xx.
      if (
        attempt === 3 ||
        !(
          error instanceof TypeError ||
          (error instanceof ApiError && [408, 429].includes(error.status)) ||
          (error instanceof ApiError && error.status >= 500)
        )
      )
        throw error;
      await sleep(1000 * 2 ** attempt);
    }
  }
}

// A failed PUT may have reached S3 even if the browser never saw its response.
// Always request a fresh ticket for the SAME clip/UUID; the immutable PUT will
// return 412 if it already succeeded, then the caller verifies via /complete.
export async function uploadWithRetry(
  initial: UploadTicket,
  refresh: () => Promise<UploadTicket>,
  put: (ticket: UploadTicket) => Promise<void>,
  onRetry: (attempt: number) => void,
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<void> {
  let ticket = initial;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (!ticket.uploadUrl) {
      if (ticket.status === "UPLOADING")
        throw new Error("Storage did not provide an upload URL.");
      return; // Already finalized by a previous attempt.
    }
    try {
      await put(ticket);
      return;
    } catch (error) {
      if (
        !(error instanceof StorageUploadError) ||
        (![0, 403, 408, 429].includes(error.status) && error.status < 500) ||
        attempt === 3
      )
        throw error;
      onRetry(attempt + 1);
      await sleep(1000 * 2 ** attempt);
      const next = await refresh();
      if (next.clipId !== initial.clipId)
        throw new Error("Retry returned a different clip. Upload stopped.");
      ticket = next;
    }
  }
}
