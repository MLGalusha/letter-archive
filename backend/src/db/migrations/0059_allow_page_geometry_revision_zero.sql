ALTER TABLE "page_geometry_revisions"
  DROP CONSTRAINT "page_geometry_revision_positive";
--> statement-breakpoint
ALTER TABLE "page_geometry_revisions"
  ADD CONSTRAINT "page_geometry_revision_nonnegative"
  CHECK ("revision" >= 0) NOT VALID;
--> statement-breakpoint
ALTER TABLE "page_geometry_revisions"
  VALIDATE CONSTRAINT "page_geometry_revision_nonnegative";
