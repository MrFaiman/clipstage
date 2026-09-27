import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ENV, type Env } from "../config";

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
