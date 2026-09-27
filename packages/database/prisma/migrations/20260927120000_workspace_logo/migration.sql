-- Object key only. Signed read URLs are issued when a workspace is loaded.
ALTER TABLE "Workspace" ADD COLUMN "logoKey" TEXT;
