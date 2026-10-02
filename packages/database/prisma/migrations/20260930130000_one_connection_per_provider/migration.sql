-- Do not arbitrarily delete identities or encrypted credentials on upgrade.
-- Administrators must explicitly resolve legacy duplicates before deployment.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "OAuthAccount"
    GROUP BY "userId", "provider" HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate OAuth connections: resolve users with more than one identity per provider before applying this migration';
  END IF;
END $$;

CREATE UNIQUE INDEX "OAuthAccount_userId_provider_key" ON "OAuthAccount"("userId", "provider");
