-- Preserve the original object; this column stores only non-destructive timeline decisions.
ALTER TABLE "Clip" ADD COLUMN "project" JSONB;
