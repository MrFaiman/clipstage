export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/v1";
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    cache: "no-store",
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new ApiError(
      response.status,
      body?.message ?? "The API is unavailable. Please try again.",
    );
  return body as T;
}
export const post = <T>(path: string, body?: unknown) =>
  api<T>(path, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });

export class StorageUploadError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function uploadFile(
  url: string,
  file: Blob,
  headers: Record<string, string>,
  progress: (percent: number) => void,
  allowAlreadyExists = true,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    // Intentionally do not send application cookies or device credentials to object storage.
    for (const [key, value] of Object.entries(headers))
      xhr.setRequestHeader(key, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable)
        progress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      // 412 means this immutable upload already succeeded. The API still verifies it.
      if (
        (xhr.status >= 200 && xhr.status < 300) ||
        (allowAlreadyExists && xhr.status === 412)
      )
        resolve();
      else
        reject(
          new StorageUploadError(
            xhr.status,
            `Storage upload failed (${xhr.status}). Check your connection and retry.`,
          ),
        );
    };
    xhr.onerror = () =>
      reject(
        new StorageUploadError(
          0,
          "Could not reach storage. Check your connection and S3 CORS settings.",
        ),
      );
    xhr.ontimeout = () =>
      reject(
        new StorageUploadError(
          408,
          "Upload timed out. Your file is safe locally; retry the upload.",
        ),
      );
    xhr.timeout = 30 * 60 * 1000;
    xhr.send(file);
  });
}
