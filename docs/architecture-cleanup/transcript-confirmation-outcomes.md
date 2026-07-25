# Transcript Confirmation Outcome Map

Last verified: July 25, 2026

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
| Confirmation/metadata claim loses while the exact transcript remains current | The fallback CAS can still commit confirmation while another metadata mutation owns the newer revision | 200 if the final DTO read succeeds | Returned state is authoritative; blind replay is unsafe |
| Confirmation claim and fallback CAS both lose | No write by this request | Coded source conflict or generic 409 | Reload before retry |
| Metadata provider/schema failure | Transcript remains confirmed; metadata becomes `FAILED`; workflow returns to `TRANSCRIBED` | 500 | Confirmation must not be replayed blindly |
| API dies during metadata work | Transcript remains confirmed with a leased queued-kind `RUNNING` metadata claim | Connection failure | Lease expiry can requeue metadata for the worker |
| Browser reaches its 20-second timeout | Backend normally continues the already-claimed run | Status-0 `ApiError` | Outcome is unknown until an authoritative read |
| Source changes before metadata publication | Metadata fencing rejects the old run before it can publish | Uncoded 409 from the old request | Reload the new source |
| Source changes after metadata publication or during derived entity work | Old entity work cannot publish, but the two-phase producer deliberately reports metadata completion | 200 with the current authoritative DTO if its read succeeds | Adopt the returned current source; do not infer old-source entity success |
| Metadata succeeds and entity extraction fails | Metadata remains `SUCCESS`; entity becomes `FAILED`; prior entity projection is preserved | 200 | Retry entity work, not confirmation |
| Final Letter DTO read fails | All earlier confirmation/metadata/entity writes remain committed | 500 | Blind confirmation retry is unsafe and often rejected by workflow |
| Canonical metadata is already `RUNNING` or `SUCCESS` | Canonical workflow is already `METADATA_EXTRACTING` or `METADATA_DRAFTED`, so current route validation writes nothing | 400 | Current endpoint is not idempotent |
| Legacy-incoherent `TRANSCRIBED` plus `RUNNING`/`SUCCESS` | Confirmation-only compare-and-set can commit, but these pairs are not produced by the canonical lifecycle | 200 if the final DTO read succeeds | Repair/reload state; do not use this branch to define normal target behavior |
| Content is not a letter | Confirmation commits; no metadata producer runs | 200 | Current success copy falsely claims extraction |
| Repeat after provider failure | The first failure advances the metadata revision; a second request re-confirms and claims that revision as another queued-kind attempt | Usually another long request | This is the clearest unsafe blind-retry branch |
| Repeat after metadata success | No write because canonical workflow is no longer `TRANSCRIBED` | 400 | Current endpoint is not idempotent |

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

Confirming a transcript is a short, exact-source, idempotent database mutation. For an
eligible letter whose metadata is `PENDING` or `FAILED`, one commit records reviewer
confirmation and durable queued metadata intent whose human correction guidance is
bound to that exact confirmation/source/transcript. The same operation returns an
explicit disposition: `queued`, `already_running`, `already_available`, `failed`, or
`not_applicable`. Already-running/available/failed work from an existing
matching confirmation is not reset by replay, and non-letter content never receives
permanently ineligible metadata work.

The HTTP request performs no AI. Its commit returns a durable confirmation receipt
containing the confirmation identity, transcript-source identity, current complete
metadata-input identity, intent identity, and metadata disposition. Full Letter
hydration is optional on that response path: if the post-commit DTO read fails, the
route returns the accepted receipt rather than reporting confirmation failure. A
post-commit worker wake is advisory; durable queue state remains the authority.

Only the singleton worker claims queued metadata. Metadata and entity publication
remain separately lease- and revision-fenced. Provider failure, lease expiry, retry,
and entity failure are processing outcomes, not retroactive transcript-confirmation
failures.

The response includes the authoritative Letter when hydration succeeds plus the
explicit disposition. Frontends may claim metadata availability only from that state,
must reconcile a receipt without a Letter and every ambiguous non-precondition
failure—including transport errors and HTTP 5xx—with an authoritative GET, and must
direct later failures to the durable processing retry rather than replay confirmation.

## Durable Guidance Requirements

The queued job must persist optional confirmed sender/recipient guidance and bind it
to the confirmation that created the job. At minimum:

- a validated nullable guidance envelope;
- a server-generated confirmation identity and a deterministic intent hash over the
  exact source revision, transcript digest, and validated guidance values;
- a separate durable metadata-input identity covering every AI input—not only the
  transcript—including extra-content text/state, date/filename context, and collection
  context; attempt/lease transitions must not masquerade as input changes;
- an exact binding from guidance to that confirmation identity, with source/transcript
  invalidation making stale guidance unusable;
- atomic write of confirmation, guidance, and queued metadata state;
- concurrent same-hash requests return the already-accepted receipt, while a
  different-hash request against that confirmation conflicts without replacing or
  silently attaching new guidance;
- same-intent replay re-reads the current metadata-input identity and disposition
  rather than returning a cached old receipt; extra-content/date/collection
  invalidation therefore leaves its new `PENDING` work authoritative and cannot be
  suppressed by an older confirmation receipt;
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
4. Concurrent and later same-intent replay returns the same confirmation identity and
   cannot duplicate metadata work. After extra-content or other metadata-source
   invalidation it returns the new input identity/current queued disposition rather
   than suppressing that work with the old receipt.
5. Concurrent or later different/stale guidance conflicts without replacing or
   silently attaching to the earlier confirmation.
6. The worker receives the durable guidance; metadata retry and deferred entity work
   retain it.
7. Newly eligible `PENDING`/`FAILED`, matching-confirmation queued/running/available/
   failed, and non-letter inputs return their exact disposition without resetting
   existing work or creating ineligible work.
8. A failed post-commit Letter DTO read returns an accepted receipt. Letter Review
   adopts the queued DTO when present, otherwise reconciles; it uses truthful copy,
   hides confirmation, and cannot offer duplicate generation while processing.
9. Dashboard does not follow confirmation with synchronous regeneration and refreshes
   after partial or ambiguous outcomes.
10. Transport and HTTP 5xx ambiguity reconcile through an authoritative read.
    Confirmed state blocks confirmation replay; unconfirmed state remains retryable;
    failed reconciliation reports an unknown outcome rather than claiming failure.
11. Source changes before metadata publication remain fenced; source changes after
    publication cannot publish stale entities and return/reconcile the newer
    authoritative state without claiming the old source fully completed.
12. Pre-commit source conflicts remain coded, and late old-source work cannot publish
    or repaint a newer visit.
