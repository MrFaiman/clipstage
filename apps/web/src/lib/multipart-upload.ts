import type { UploadTicket } from "@clipstage/contracts";
import { StorageUploadError } from "./api";

/** Uploads bounded-size S3 parts sequentially; retries resume from ListParts, not byte zero. */
export async function uploadMultipart(
  initial: UploadTicket,
  file: Blob,
  refresh: () => Promise<UploadTicket>,
  partUrl: (clipId: string, number: number) => Promise<string>,
  put: (
    url: string,
    chunk: Blob,
    progress: (value: number) => void,
  ) => Promise<void>,
  progress: (value: number) => void,
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
) {
  let ticket = initial;
  const config = ticket.multipart;
  if (
    !config ||
    config.partSize < 5 * 1024 * 1024 ||
    config.partCount !== Math.ceil(file.size / config.partSize)
  )
    throw new Error("Invalid multipart upload ticket");
  for (let number = 1; number <= config.partCount; number++) {
    let done = false;
    for (let attempt = 0; attempt < 4 && !done; attempt++) {
      if (
        ticket.status !== "UPLOADING" ||
        ticket.multipart?.uploadedParts.includes(number)
      ) {
        done = true;
        break;
      }
      try {
        const url = await partUrl(ticket.clipId, number);
        const start = (number - 1) * config.partSize;
        const chunk = file.slice(
          start,
          Math.min(start + config.partSize, file.size),
        );
        await put(url, chunk, (value) =>
          progress(
            Math.round(
              ((start + (chunk.size * value) / 100) / file.size) * 100,
            ),
          ),
        );
        done = true;
      } catch (error) {
        if (
          !(error instanceof StorageUploadError) ||
          (![0, 403, 408, 429].includes(error.status) && error.status < 500) ||
          attempt === 3
        )
          throw error;
        await sleep(1000 * 2 ** attempt);
        const next = await refresh();
        if (
          next.clipId !== initial.clipId ||
          (next.status === "UPLOADING" &&
            (next.multipart?.partSize !== config.partSize ||
              next.multipart?.partCount !== config.partCount))
        )
          throw new Error("Multipart retry returned a different upload");
        ticket = next;
      }
    }
    progress(
      Math.round(
        (Math.min(number * config.partSize, file.size) / file.size) * 100,
      ),
    );
  }
}
