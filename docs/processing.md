# Processing Pipeline

Locations: `backend/src/pipeline/`, `backend/src/services/worker-processing-cycle.ts`,
and `backend/src/services/letter/*-job.ts`

## Ownership

The worker is the sole automatic executor. Upload, retry, and bulk API paths persist
eligible work and may request one global worker wake; they do not run an API-memory
batch. Explicit single-letter admin actions remain request-owned, but use the same
persisted stage claim, lease, heartbeat, cancellation, and terminal-publication
boundaries as worker work.

Each stage has its own lifecycle owner:

| Stage | Lifecycle owner |
| --- | --- |
| Main transcription | `services/letter/transcription-job.ts` |
| Related T/C/E content | `services/letter/extra-content-job.ts` |
| Basic metadata | `services/letter/metadata-job.ts` |
| Entity projection | `services/letter/entity-extraction-job.ts` |

`services/processing-eligibility.ts` is the shared in-memory/SQL eligibility boundary.
`services/worker-processing-cycle.ts` discovers bounded durable work and invokes the
four explicit producers in that order.

## Workflow

```text
UPLOADED → TRANSCRIBING → TRANSCRIBED → (human confirms transcript)
  → METADATA_EXTRACTING → METADATA_DRAFTED → REVIEWED
```

Job statuses and content-review statuses are separate from workflow. Entity extraction
does not introduce another workflow value; it builds a revisioned projection after
metadata is committed.

## Stage Contracts

### Main transcription

An eligible L record with at least one page claims `PENDING` work before loading source
images. The producer combines page transcripts, then publishes the transcript and
`SUCCESS` only while its exact run-bound lease remains authoritative. Human transcript
writes revoke any active AI attempt.

### Related extra content

T/C/E companion pages are processed into the primary L record. Page persistence and
extra-content invalidation share one database transaction. A meaningful source change
requeues derived work; human edits and verification revoke the active AI owner.

### Basic metadata

A confirmed, nonblank transcript gates metadata. The claim reserves the next metadata
revision and invalidates the dependent entity attempt. Metadata content and the
`METADATA_DRAFTED` workflow publish atomically.

### Entity extraction

Successful metadata gates entity work. A claim reserves `committed revision + 1`;
people, places, relationships, review rows, the extraction JSON, status, and revision
publish in one transaction. Human-authored projection rows are preserved. Entity and
extra-content work are mutually exclusive.

## Liveness and Recovery

Every current stage claim stores:

- a unique run ID;
- a PostgreSQL-clock lease deadline;
- a lease-to-run binding;
- `QUEUED` or `REQUESTED` recovery intent.

The producer confirms ownership before provider work and renews through the shared
non-overlapping heartbeat. Exact queued expiry returns to durable work. Exact requested
expiry fails visibly rather than silently becoming automatic work. Legacy, unleased,
partial, or lease-mismatched attempts remain manual because the system cannot infer
their owner safely.

The worker itself has a separate singleton execution lease. Every automatic stage
claim and worker recovery mutation includes that token in the same SQL statement.

## State Fields

| Field family | Purpose |
| --- | --- |
| `transcription_*` | Main transcript status, retries, run, lease, and intent |
| `extra_content_job_*` | Related-content status, run, lease, revision, and intent |
| `metadata_*` | Metadata status, revision, run, lease, and intent |
| `entity_extraction_*` | Entity status, committed/reserved revision, run, lease, and intent |
| `transcript_status` | `EMPTY` → `AI_DRAFT` → `EDITED` → `VERIFIED` |
| `metadata_content_status` | `EMPTY` → `AI_DRAFT` → `EDITED` → `VERIFIED` |

The detailed failure matrix and rolling-deployment rules live in
[`architecture-cleanup/processing-ownership.md`](architecture-cleanup/processing-ownership.md).
