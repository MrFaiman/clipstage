import { describe, expect, test } from "bun:test";
import {
  canManageWorkspace,
  canSetStatus,
  createUploadSchema,
  MAX_UPLOAD_BYTES,
  trimSchema,
  updateClipSchema,
} from "./index";

const upload = {
  clientUploadId: "4bf29d60-066d-42bb-81a9-2d757fd41d47",
  title: "A great moment",
  fileName: "clip.mp4",
  mimeType: "video/mp4",
  sizeBytes: 1000,
};
describe("upload contracts", () => {
  test("defaults to Kick with an empty brief", () => {
    expect(createUploadSchema.parse(upload)).toMatchObject({
      provider: "KICK",
      brief: "",
    });
  });
  test.each([0, -1, MAX_UPLOAD_BYTES + 1, 1.5, Infinity])(
    "rejects invalid file size %p",
    (sizeBytes) => {
      expect(
        createUploadSchema.safeParse({ ...upload, sizeBytes }).success,
      ).toBe(false);
    },
  );
  test.each(["../clip.mp4", "folder/clip.mp4", "C:\\clip.mp4", "clip\n.mp4"])(
    "rejects unsafe filename %p",
    (fileName) => {
      expect(
        createUploadSchema.safeParse({ ...upload, fileName }).success,
      ).toBe(false);
    },
  );
  test("requires a stable UUID for idempotency", () => {
    expect(
      createUploadSchema.safeParse({ ...upload, clientUploadId: "123" })
        .success,
    ).toBe(false);
  });
  test("rejects client-selected storage keys", () => {
    expect(
      createUploadSchema.safeParse({
        ...upload,
        storageKey: "other-workspace/file",
      }).success,
    ).toBe(false);
  });
  test("rejects non-video content types", () => {
    expect(
      createUploadSchema.safeParse({ ...upload, mimeType: "text/html" })
        .success,
    ).toBe(false);
  });
});
describe("editing contracts", () => {
  test.each([
    { start: 5, end: 4 },
    { start: -1, end: 10 },
    { start: 3, end: 3 },
    { start: 0, end: Infinity },
  ])("rejects invalid trim %p", (trim) => {
    expect(trimSchema.safeParse(trim).success).toBe(false);
  });
  test("accepts a non-destructive trim", () => {
    expect(trimSchema.parse({ start: 2.5, end: 10 })).toEqual({
      start: 2.5,
      end: 10,
    });
  });
  test("requires an expected version", () => {
    expect(updateClipSchema.safeParse({ brief: "new brief" }).success).toBe(
      false,
    );
  });
  test("cannot mark an existing clip as uploading", () => {
    expect(
      updateClipSchema.safeParse({ version: 0, status: "UPLOADING" }).success,
    ).toBe(false);
  });
  test("editors can review but not approve or manage the workspace", () => {
    expect(canSetStatus("EDITOR", "IN_REVIEW")).toBe(true);
    expect(canSetStatus("EDITOR", "APPROVED")).toBe(false);
    expect(canSetStatus("OWNER", "APPROVED")).toBe(true);
    expect(canManageWorkspace("EDITOR")).toBe(false);
    expect(canManageWorkspace("OWNER")).toBe(true);
  });
});
