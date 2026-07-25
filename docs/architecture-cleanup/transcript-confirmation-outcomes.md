# Transcript Confirmation Outcome Map

Last verified: July 24, 2026

This document separates the transcript-confirmation write from the metadata and
entity work that the current HTTP request also performs. It is the authority for
Slice 037 characterization and the boundary that replaces the synchronous request
in the next behavior-changing slice.

## Current Operation

`POST /admin/letters/:letterId/confirm-transcript` currently performs five distinct
steps:

1. Validate the source revision, workflow, transcription state, and correction
   payload.
2. Atomically confirm the transcript and claim metadata as `RUNNING`.
3. Await metadata AI and publish or fail the claimed metadata run.
4. Attempt entity extraction inline; entity failure is deliberately non-fatal after
   metadata publication.
5. Read and return a full admin Letter DTO.

Only step 2 is atomic. It commits before provider work starts. The request and both
frontend consumers nevertheless treat one returned DTO or one thrown error as the
outcome of the entire operation.

The provider timeout is five minutes. The frontend aborts the request after twenty
seconds, but aborting the browser fetch does not roll back the committed claim or
stop the API process.

## Committed-versus-reported Matrix

| Failure or branch | Durable state | Current HTTP result | Retry truth |
| --- | --- | --- | --- |
| Initial validation or stale source | No write by this request | 400 or coded 409 | Safe after correcting or reloading |
| Exact confirmation/claim loses | Normally no write by this request | Generic or coded 409 depending on the observed race | Must reload |
| Metadata provider/schema failure | Transcript remains confirmed; metadata becomes `FAILED`; workflow returns to `TRANSCRIBED` | 500 | Confirmation must not be replayed blindly |
| API dies during metadata work | Transcript remains confirmed with a leased queued-kind `RUNNING` metadata claim | Connection failure | Lease expiry can requeue metadata for the worker |
| Browser reaches its 20-second timeout | Backend normally continues the already-claimed run | Status-0 `ApiError` | Outcome is unknown until an authoritative read |
| Source changes during AI | Fencing rejects old publication; source invalidation may revoke confirmation | Uncoded 409 from the old request | Must reload the new source |
| Metadata succeeds and entity extraction fails | Metadata remains `SUCCESS`; entity becomes `FAILED`; prior entity projection is preserved | 200 | Retry entity work, not confirmation |
| Final Letter DTO read fails | All earlier confirmation/metadata/entity writes remain committed | 500 | Blind confirmation retry is unsafe and often rejected by workflow |
| Metadata was already `RUNNING` | Confirmation-only compare-and-set may commit | 200 | Current success copy falsely claims extraction |
| Metadata was already `SUCCESS` or the content is not a letter | Confirmation commits; no metadata producer runs | 200 | Current success copy falsely claims extraction |

The endpoint is therefore repeatable but not idempotent. An error does not establish
that nothing committed, and a success does not establish that this request extracted
metadata.

## Current Frontend Mismatch

Letter Review always says `Transcript confirmed — metadata extracted` after adopting
the response. Any uncoded failure reports confirmation failure without refreshing
authoritative state, leaving a stale confirmation action available for an implicit
retry.

Dashboard combines confirmation and metadata generation. If a future fast
confirmation response returns confirmed, still-empty metadata, Dashboard immediately
calls synchronous regeneration. That would race the queued worker job. Dashboard also
refreshes only after the combined path settles and always reports generated or
regenerated copy.

`MetadataSection` decides whether to offer Generate from content status alone. It does
not suppress the action while the workflow is `METADATA_EXTRACTING`.

## Rejected Partial Fixes

- Raising the frontend timeout reduces one symptom but cannot make a committed write
  and its response atomic.
- Automatically retrying the POST can duplicate or conflict with committed work.
- Returning HTTP 202 alone does not describe whether metadata was queued, already
  running, already available, failed, or not applicable.
- Moving the existing call to the worker without new persistence loses the
  sender/recipient corrections, which currently exist only in in-memory
  `ExtractionOptions`.
- Leaving the API-owned claim `RUNNING` for a worker does not work: worker discovery
  selects durable `PENDING` metadata rows.
- Treating stored sender/recipient scalars as correction truth is unsafe because they
  can be prior AI output. The pipeline deliberately avoids that promotion today.

## Target Invariant

Confirming a transcript is a short, exact-source, idempotent database mutation. One
commit records reviewer confirmation and a durable `PENDING` metadata intent whose
human correction guidance is bound to that exact confirmation/source/transcript.
The HTTP request performs no AI and never reports confirmation failure after that
commit. A post-commit worker wake is advisory; durable queue state remains the
authority.

Only the singleton worker claims queued metadata. Metadata and entity publication
remain separately lease- and revision-fenced. Provider failure, lease expiry, retry,
and entity failure are processing outcomes, not retroactive transcript-confirmation
failures.

The confirmation response must include the authoritative Letter plus an explicit
metadata disposition. Frontends may claim metadata availability only from the
returned state/disposition, must reconcile an ambiguous transport failure with an
authoritative GET, and must direct later failures to the durable processing retry
rather than replay confirmation.

## Durable Guidance Requirements

The queued job must persist optional confirmed sender/recipient guidance and bind it
to the confirmation that created the job. At minimum:

- a validated nullable guidance envelope;
- an exact binding to the current transcript confirmation, with source/transcript
  invalidation making stale guidance unusable;
- atomic write of confirmation, guidance, and queued metadata state;
- queued metadata retries preserve the same guidance;
- deferred entity extraction receives the same still-current guidance;
- terminal entity success and every newer confirmation/source/regeneration intent
  clear or supersede it;
- rolling deployment cannot let an older API write make stale guidance look current.

The binding and rollout rule must be proven in migration and lifecycle tests before
the API stops running metadata inline.

## Implementation Acceptance

The behavior-changing continuation must prove:

1. Confirmation and durable metadata intent commit atomically against the exact
   source and transcript.
2. The request returns before any provider call.
3. A worker wake occurs only after durable enqueue; wake failure leaves recoverable
   work.
4. Same-intent replay is idempotent and cannot duplicate metadata work.
5. Different or stale corrections cannot silently attach to an earlier confirmation.
6. The worker receives the durable guidance; metadata retry and deferred entity work
   retain it.
7. Letter Review adopts the queued DTO, uses truthful copy, hides confirmation, and
   cannot offer duplicate generation while processing.
8. Dashboard does not follow confirmation with synchronous regeneration and refreshes
   after partial or ambiguous outcomes.
9. Ambiguous transport failure reconciles through an authoritative read. Confirmed
   state blocks confirmation replay; unconfirmed state remains retryable; failed
   reconciliation reports an unknown outcome rather than claiming failure.
10. Pre-commit source conflicts remain coded, and late old-source work cannot publish
    or repaint a newer visit.
