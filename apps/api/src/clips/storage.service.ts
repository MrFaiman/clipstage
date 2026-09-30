import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  PutObjectCommand,
  UploadPartCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ENV, type Env } from "../config";

// 8 MiB satisfies S3's 5 MiB minimum for all but the final part.
export const PART_SIZE = 8 * 1024 * 1024;

@Injectable()
export class StorageService {
  private readonly client: S3Client;
  constructor(@Inject(ENV) private readonly env: Env) {
    this.client = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      },
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }
  async upload(key: string, mimeType: string, sizeBytes: number) {
    // A signed, mandatory conditional header prevents replaying a PUT to replace a finalized source.
    const uploadUrl = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.env.S3_BUCKET,
        Key: key,
        ContentType: mimeType,
        ContentLength: sizeBytes,
        IfNoneMatch: "*",
      }),
      {
        expiresIn: 900,
        signableHeaders: new Set(["content-type", "if-none-match"]),
      },
    );
    return {
      uploadUrl,
      headers: { "Content-Type": mimeType, "If-None-Match": "*" },
      expiresAt: new Date(Date.now() + 900000).toISOString(),
    };
  }
  async startMultipart(key: string, mimeType: string) {
    const response = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.env.S3_BUCKET,
        Key: key,
        ContentType: mimeType,
      }),
    );
    if (!response.UploadId) throw new Error("S3 did not return an upload ID");
    return response.UploadId;
  }
  async abortMultipart(key: string, uploadId: string) {
    await this.client.send(
      new AbortMultipartUploadCommand({
        Bucket: this.env.S3_BUCKET,
        Key: key,
        UploadId: uploadId,
      }),
    );
  }
  async part(
    key: string,
    uploadId: string,
    partNumber: number,
    length: number,
  ) {
    return getSignedUrl(
      this.client,
      new UploadPartCommand({
        Bucket: this.env.S3_BUCKET,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
        ContentLength: length,
      }),
      { expiresIn: 900, signableHeaders: new Set(["content-length"]) },
    );
  }
  async parts(key: string, uploadId: string) {
    const parts: { number: number; length: number; etag: string }[] = [];
    let marker: string | undefined;
    do {
      const page = await this.client.send(
        new ListPartsCommand({
          Bucket: this.env.S3_BUCKET,
          Key: key,
          UploadId: uploadId,
          PartNumberMarker: marker,
        }),
      );
      for (const part of page.Parts ?? []) {
        if (part.PartNumber && part.Size !== undefined && part.ETag)
          parts.push({
            number: part.PartNumber,
            length: part.Size,
            etag: part.ETag,
          });
      }
      if (!page.IsTruncated) break;
      if (!page.NextPartNumberMarker || page.NextPartNumberMarker === marker)
        throw new Error("S3 returned an invalid parts cursor");
      marker = page.NextPartNumberMarker;
    } while (true);
    // Some S3-compatible stores list superseded versions of the same part.
    // Use the last returned ETag/size for each part number, as for S3's latest-part semantics.
    return [...new Map(parts.map((part) => [part.number, part])).values()].sort(
      (a, b) => a.number - b.number,
    );
  }
  async finishMultipart(
    key: string,
    uploadId: string,
    parts: { number: number; etag: string }[],
  ) {
    await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.env.S3_BUCKET,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: parts.map((part) => ({
            PartNumber: part.number,
            ETag: part.etag,
          })),
        },
      }),
    );
  }
  async verify(key: string, sizeBytes: number, mimeType: string) {
    let object;
    try {
      object = await this.client.send(
        new HeadObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key }),
      );
    } catch (error) {
      if (
        error instanceof Error &&
        ["NotFound", "NoSuchKey"].includes(error.name)
      )
        throw new BadRequestException("Upload is not complete yet");
      throw error;
    }
    if (object.ContentLength !== sizeBytes || object.ContentType !== mimeType)
      throw new BadRequestException(
        "Uploaded object does not match its declared size or content type. Create a new upload.",
      );
  }
  async remove(key: string) {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key }),
    );
  }
  async read(key: string, fileName?: string) {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.env.S3_BUCKET,
        Key: key,
        ResponseContentDisposition: fileName
          ? `attachment; filename*=UTF-8''${encodeURIComponent(fileName).replace(/'/g, "%27")}`
          : "inline",
      }),
      { expiresIn: 3600 },
    );
  }
}
