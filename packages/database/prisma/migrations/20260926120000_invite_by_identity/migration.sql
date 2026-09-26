-- Existing link invitations cannot be matched to a person. Drop them with the bearer token.
DELETE FROM "Invitation";

DROP INDEX "Invitation_tokenHash_key";

ALTER TABLE "Invitation" DROP COLUMN "tokenHash";
ALTER TABLE "Invitation" ADD COLUMN "email" TEXT;
ALTER TABLE "Invitation" ADD COLUMN "username" TEXT;

CREATE UNIQUE INDEX "Invitation_workspaceId_email_key" ON "Invitation"("workspaceId", "email");
CREATE UNIQUE INDEX "Invitation_workspaceId_username_key" ON "Invitation"("workspaceId", "username");

ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_identifier_check" CHECK (
  ("email" IS NOT NULL AND "username" IS NULL)
  OR ("email" IS NULL AND "username" IS NOT NULL)
);

ALTER TABLE "OAuthAccount" ADD COLUMN "email" TEXT;

CREATE INDEX "OAuthAccount_email_idx" ON "OAuthAccount"("email");
