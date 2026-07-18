-- This nullable, unbackfilled column is an application-level rollout fence.
-- Existing lease metadata cannot be proven to belong to the current run, and
-- older revisions neither write nor clear this field. In particular, an older
-- terminal writer may clear the known run/lease/kind fields while legitimately
-- leaving this binding behind, so no binding-shape CHECK is rollout-safe yet.
ALTER TABLE "letters" ADD COLUMN "transcription_lease_run_id" uuid;
