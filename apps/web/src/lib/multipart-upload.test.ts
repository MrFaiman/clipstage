import { expect, test } from "bun:test";
import type { UploadTicket } from "@clipstage/contracts";
import { StorageUploadError } from "./api";
import { uploadMultipart } from "./multipart-upload";

const size = 8 * 1024 * 1024;
const ticket: UploadTicket = {
  clipId: "clip-1",
  status: "UPLOADING",
  uploadUrl: null,
  headers: {},
  expiresAt: null,
  multipart: { partSize: size, partCount: 2, uploadedParts: [1] },
};
const noWait = async () => {};

test("resumes existing parts and uploads only the remainder", async () => {
  const numbers: number[] = [];
  let progress = 0;
  await uploadMultipart(
    ticket,
    new Blob([new Uint8Array(size + 12)]),
    async () => ticket,
    async (_clip, number) => {
      numbers.push(number);
      return "https://storage.test/part";
    },
    async (_url, chunk, report) => {
      expect(chunk.size).toBe(12);
      report(100);
    },
    (value) => {
      progress = value;
    },
    noWait,
  );
  expect(numbers).toEqual([2]);
  expect(progress).toBe(100);
});

test("ambiguous PUT response refreshes the part list before retrying", async () => {
  let attempts = 0,
    refreshes = 0;
  await uploadMultipart(
    ticket,
    new Blob([new Uint8Array(size + 12)]),
    async () => {
      refreshes++;
      return ticket;
    },
    async () => "https://storage.test/part",
    async () => {
      if (++attempts === 1) throw new StorageUploadError(0, "Lost response");
    },
    () => {},
    noWait,
  );
  expect(attempts).toBe(2);
  expect(refreshes).toBe(1);
});

test("skips a part whose PUT succeeded despite a lost response", async () => {
  let uploads = 0;
  await uploadMultipart(
    ticket,
    new Blob([new Uint8Array(size + 12)]),
    async () => ({
      ...ticket,
      multipart: { ...ticket.multipart!, uploadedParts: [1, 2] },
    }),
    async () => "https://storage.test/part",
    async () => {
      uploads++;
      throw new StorageUploadError(0, "Lost response");
    },
    () => {},
    noWait,
  );
  expect(uploads).toBe(1);
});
