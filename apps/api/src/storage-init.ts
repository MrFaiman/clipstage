import {
  CreateBucketCommand,
  PutBucketCorsCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const endpoint = process.env.S3_ENDPOINT;
if (
  !endpoint ||
  !["localhost", "127.0.0.1"].includes(new URL(endpoint).hostname)
) {
  throw new Error(
    "This development helper only initializes loopback S3 endpoints. Configure production buckets separately.",
  );
}
const client = new S3Client({
  endpoint,
  region: process.env.S3_REGION ?? "us-east-1",
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  },
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});
const Bucket = process.env.S3_BUCKET ?? "clipstage";
try {
  await client.send(new CreateBucketCommand({ Bucket }));
} catch (error) {
  if (
    !(error instanceof Error) ||
    !["BucketAlreadyOwnedByYou", "BucketAlreadyExists"].includes(error.name)
  )
    throw error;
}
await client.send(
  new PutBucketCorsCommand({
    Bucket,
    CORSConfiguration: {
      CORSRules: [
        {
          AllowedOrigins: [process.env.WEB_ORIGIN ?? "http://localhost:3000"],
          AllowedMethods: ["GET", "HEAD", "PUT"],
          AllowedHeaders: ["Content-Type", "If-None-Match"],
          ExposeHeaders: ["ETag"],
          MaxAgeSeconds: 3600,
        },
      ],
    },
  }),
);
console.log(
  `Private local bucket '${Bucket}' is ready. Browser CORS is limited to WEB_ORIGIN.`,
);
client.destroy();
