ALTER TABLE "Session"
  ADD COLUMN "createdAt" TIMESTAMP(3),
  ADD COLUMN "lastUsedAt" TIMESTAMP(3),
  ADD COLUMN "userAgent" TEXT;

-- Previously sessions were issued with a fixed 30-day lifetime. Preserve their
-- original login time instead of resetting the absolute cap during deployment.
UPDATE "Session"
SET "createdAt" = "expiresAt" - INTERVAL '30 days',
    "lastUsedAt" = "expiresAt" - INTERVAL '30 days';

ALTER TABLE "Session"
  ALTER COLUMN "createdAt" SET NOT NULL,
  ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "lastUsedAt" SET NOT NULL,
  ALTER COLUMN "lastUsedAt" SET DEFAULT CURRENT_TIMESTAMP;
