import { expect, test } from "bun:test";
import type { UploadTicket } from "@clipstage/contracts";
import { ApiError, StorageUploadError } from "./api";
import { retryCompletion, uploadWithRetry } from "./resilient-upload";

const ticket: UploadTicket = {
  clipId: "clip-1",
  status: "UPLOADING",
  uploadUrl: "https://storage.test/put",
  headers: { "If-None-Match": "*" },
  expiresAt: new Date().toISOString(),
};
const noWait = async () => {};

test("refreshes the same immutable ticket after an ambiguous network failure", async () => {
  let calls = 0,
    refreshed = 0;
  await uploadWithRetry(
    ticket,
    async () => {
      refreshed++;
      return ticket;
    },
    async () => {
      if (++calls === 1) throw new StorageUploadError(0, "Connection lost");
      // A 412 is accepted by uploadFile; API /complete verifies the object afterwards.
    },
    () => {},
    noWait,
  );
  expect(calls).toBe(2);
  expect(refreshed).toBe(1);
});

test("does not retry non-transient errors", async () => {
  let refreshed = false;
  await expect(
    uploadWithRetry(
      ticket,
      async () => {
        refreshed = true;
        return ticket;
      },
      async () => {
        throw new StorageUploadError(400, "Bad request");
      },
      () => {},
      noWait,
    ),
  ).rejects.toThrow("Bad request");
  expect(refreshed).toBe(false);
});

test("stops after four attempts and rejects a changed clip ID", async () => {
  let calls = 0;
  await expect(
    uploadWithRetry(
      ticket,
      async () => ticket,
      async () => {
        calls++;
        throw new StorageUploadError(503, "Unavailable");
      },
      () => {},
      noWait,
    ),
  ).rejects.toThrow("Unavailable");
  expect(calls).toBe(4);
  await expect(
    uploadWithRetry(
      ticket,
      async () => ({ ...ticket, clipId: "other" }),
      async () => {
        throw new StorageUploadError(0, "Lost");
      },
      () => {},
      noWait,
    ),
  ).rejects.toThrow("different clip");
});

test("retries ambiguous completion responses but not validation failures", async () => {
  let calls = 0;
  const result = await retryCompletion(async () => {
    if (++calls === 1) throw new TypeError("Connection lost");
    return "INBOX";
  }, noWait);
  expect(result).toBe("INBOX");
  expect(calls).toBe(2);
  await expect(
    retryCompletion(async () => {
      throw new ApiError(400, "Wrong size");
    }, noWait),
  ).rejects.toThrow("Wrong size");
});

test("a finalized retry proceeds to verification without re-uploading", async () => {
  let calls = 0;
  await uploadWithRetry(
    ticket,
    async () => ({ ...ticket, status: "INBOX", uploadUrl: null }),
    async () => {
      calls++;
      throw new StorageUploadError(0, "Lost");
    },
    () => {},
    noWait,
  );
  expect(calls).toBe(1);
});
