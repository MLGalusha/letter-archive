# Admin API

Routes: `backend/src/routes/admin/letters.ts`, `backend/src/routes/admin/letters/`, `uploads.ts`

All prefixed with `/admin`.

## Architecture

The admin letters route file is a thin routing layer. Business logic lives in service files:

| Service | File | Responsibility |
|---------|------|---------------|
| Letter Queries | `services/letter-queries.ts` | Listing, filtering, pagination, stats |
| Processing Queue | `services/processing-queue.ts` | Durable queue snapshot/CRUD, recovery, and configured-worker wakeups |
| Letter Operations facade | `services/letter-operations.ts` | Stable import surface for the smaller modules under `services/letter/` |
| Transcription pipeline | `pipeline/transcription.ts` | Canonical queue and direct-request transcription producer |
| Transcription ownership | `services/letter/transcription-job.ts` | Claim, run-ID fencing, and terminal publication |

---

## Letter List

### GET /admin/letters

**Query**: `page`, `limit`, `collection`, `visibility`, `workflow` (comma-separated), `search`, `sort`, `sortOrder`, `year`, `month`, `day`, `dateFrom`, `dateTo`, `transcriptStatus`, `metadataStatus`, `extraContentStatus`

**Response**: `{ letters, pagination: { page, limit, total, totalPages }, stats }`

**Service**: `queryAdminLetters()` in `letter-queries.ts`

---

## Single Letter

### GET /admin/letters/:letterId
Returns letter with related items and linked entities.

**Service**: `fetchLetterWithRelatedAndTransform()` in `letter-queries.ts`

### PUT /admin/letters/:letterId
Update fields. All optional: `transcriptionText`, `sender`, `recipient`, `locationWritten`, `hook`, `summary`, `visibility`, `notes`, `extractedDate`, `extractedDateConfidence`, `tags`.

**Service**: `updateLetter()` in `letter-operations.ts`

### POST /admin/letters/:letterId/process
Re-enqueue letter for processing.

### DELETE /admin/letters/:letterId
Soft delete.

---

## Processing Queue

### GET /admin/processing/queue
Durable active and queued state for transcription, metadata, entity extraction, and
extra content; recent main-stage activity; and an expiry-aware public worker
projection. `isPolling` reflects the live database execution lease; report fields are
observations from that exact owner, and the private token is never returned. Extra
content has no stage-specific queue/completion timestamp yet, so its queued timestamp
is `null` and it is not projected into recent activity.

**Service**: `getQueueStatus()` in `processing-queue.ts`

### POST /admin/processing/wake
Request one global drain of any durable queued stage. This endpoint accepts no stage or
filters because the worker polls the global queue. It returns `{ requested: true }`,
`{ requested: false, reason: "queue_empty" }`, or
`{ requested: false, reason: "worker_not_configured" }`. Cloud Run trigger failures
propagate as request errors instead of being reported as successful requests.

The old filtered starts, process registry, process SSE, and process-local
pause/resume/abort/progress controls have been removed. In local development the
separate `npm run worker` process consumes the queue.

### POST /admin/processing/cancel
Cancel the exact persisted active attempt: `{ letterId, type }`. Cancellation revokes
the observed run identity; an already-running AI call may finish, but its fenced result
cannot publish afterward.

### POST /admin/processing/queue/remove
Remove a PENDING item: `{ letterId, type }` where type is
`transcription | metadata | entity_extraction | extra_content`.

### POST /admin/processing/queue/clear
Clear all PENDING items of a type: `{ type }`

### POST /admin/processing/queue/retry
Retry a FAILED item: `{ letterId, type }`

---

## Bulk Operations

### POST /admin/letters/bulk/transcribe
Queue letters for transcription: `{ letterIds: [...] }`

**Service**: `bulkTranscribe()` in `letter-operations.ts`

### POST /admin/letters/bulk/extract-metadata
Queue confirmed transcripts for metadata extraction: `{ letterIds: [...] }`

**Service**: `bulkExtractMetadata()` in `letter-operations.ts`

### POST /admin/letters/bulk/clear-transcriptions
Clear transcriptions and reset to UPLOADED: `{ letterIds: [...] }`

**Service**: `bulkClearTranscriptions()` in `letter-operations.ts`

### PATCH /admin/letters/bulk/update-fields
Update sender/recipient: `{ updates: [{ letterId, sender?, recipient? }] }`

**Service**: `bulkUpdateFields()` in `letter-operations.ts`

Manual sender/recipient edits now immediately run participant sync:
- Auto-create canonical person if no confident match exists
- Auto-link only on strict confidence thresholds
- Queue ambiguous matches for review
- Keep sender/recipient person links + relationship graph in sync

### POST /admin/letters/bulk/clear-metadata
Keep transcript, clear metadata: `{ letterIds: [...] }`

**Service**: `bulkClearMetadata()` in `letter-operations.ts`

---

## Workflow Actions

### POST /admin/letters/:letterId/confirm-transcript
Triggers metadata extraction. Requires TRANSCRIBED state.

### POST /admin/letters/:letterId/regenerate-metadata
Re-run metadata extraction. Requires confirmed transcript.

### POST /admin/letters/:letterId/regenerate-entities
Re-run entity extraction only. Requires successful metadata.

---

## Two-Track Verification

### POST /admin/letters/:letterId/verify-transcript | unverify-transcript
**Service**: `verifyTranscript()`, `unverifyTranscript()` in `services/letter/verification.ts` (re-exported by `letter-operations.ts`)

### POST /admin/letters/:letterId/verify-metadata | unverify-metadata
**Service**: `verifyMetadata()`, `unverifyMetadata()` in `letter-operations.ts`

### POST /admin/letters/:letterId/verify-extra-content | unverify-extra-content
**Service**: `verifyExtraContent()`, `unverifyExtraContent()` in `letter-operations.ts`

---

## Transcription

### POST /admin/letters/:letterId/regenerate-transcription
Re-run transcription. Query: `includeExtras=true` to include extras.

**Service**: `regenerateTranscription()` in `services/letter/regeneration.ts`. Main-letter work uses the canonical `pipeline/transcription.ts` producer; optional extra-content work has its own lifecycle.

### POST /admin/letters/:letterId/transcribe-letter
Transcribe only the letter pages.

**Service**: `transcribeLetterOnly()` in `services/letter/regeneration.ts`. It uses the canonical transcription producer with extra-content work disabled.

### POST /admin/letters/:letterId/transcribe-extras
Transcribe extra content items.

**Service**: `transcribeExtras()` in `services/letter/extra-content.ts`

---

## Extra Content

### PUT /admin/letters/:letterId/extra-content
Update extra content text: `{ extraContent }`

### PUT /admin/letters/:letterId/ai-notes
Update AI notes: `{ aiNotes }`

---

## Version History

### GET /admin/letters/:letterId/versions
Query: `fieldType=transcript|metadata`

**Service**: `getVersions()` in `letter-operations.ts`

### POST /admin/letters/:letterId/versions
Create version snapshot: `{ fieldType, content, source }`

**Service**: `createVersion()` in `letter-operations.ts`

### POST /admin/letters/:letterId/versions/:versionNumber/restore
Restore a version. Query: `fieldType=transcript|metadata`

**Service**: `restoreVersion()` in `letter-operations.ts`

---

## Linked Entities

### PUT /admin/letters/:letterId/linked-persons/:linkId
Update canonical name: `{ canonicalName }`

### PUT /admin/letters/:letterId/linked-places/:linkId
Update canonical name: `{ canonicalName }`

### POST /admin/letters/:letterId/linked-persons
Add person: `{ name, role: 'sender'|'recipient'|'mentioned' }`

### POST /admin/letters/:letterId/linked-places
Add place: `{ name, role: 'written_from'|'mentioned'|'destination' }`

### DELETE /admin/letters/:letterId/linked-persons/:linkId
Remove person link.

### DELETE /admin/letters/:letterId/linked-places/:linkId
Remove place link.

---

## Resync

### POST /admin/letters/:letterId/resync-check
Audit metadata for issues without applying changes.

**Body**: `{ oldSender, newSender, oldRecipient, newRecipient }`

**Response**: `{ needsResync, decision }`

**Service**: `resyncCheck()` in `letter-operations.ts`

### POST /admin/letters/:letterId/resync
Audit and apply fixes.

**Body**: `{ oldSender, newSender, oldRecipient, newRecipient }`

**Response**: `{ wasUpdated, updatedFields, decision, letter }`

**Service**: `resyncLetterMetadata()` in `letter-operations.ts`

---

## Entities

Routes: `backend/src/routes/admin/entities.ts`

### GET /admin/entities/persons
List all canonical persons with letter counts.

### GET /admin/entities/places
List all canonical places with letter counts.

### GET /admin/entities/persons/:id
Get person with linked letters.

### GET /admin/entities/persons/:id/same-name-candidates
Returns other person profiles that share the same canonical name (for disambiguation before merge/rename).

### GET /admin/entities/places/:id
Get place with linked letters.

### GET /admin/entities/places/:id/same-name-candidates
Returns other place profiles that share the same canonical name (for disambiguation before merge/rename).

### GET /admin/entities/persons/search?q=<query>
Fuzzy person lookup.

### GET /admin/entities/places/search?q=<query>
Fuzzy place lookup.

### PUT /admin/entities/persons/:id
Update person: `{ canonicalName?, aliases?, notes? }`

Response includes optional `undoActionId` when a rename occurred.

### PUT /admin/entities/places/:id
Update place: `{ canonicalName?, aliases?, placeType?, notes? }`

Response includes optional `undoActionId` when a rename occurred.

### POST /admin/entities/persons/merge
Merge two people: `{ keepId, mergeId }`

Response includes `undoActionId`.

### POST /admin/entities/places/merge
Merge two places: `{ keepId, mergeId }`

Response includes `undoActionId`.

### POST /admin/entities/places/:id/themes/generate
Generate/update AI themes for a place profile and persist them in notes markers.

Response: `{ place, themes }`

### POST /admin/entities/persons/bulk-merge
Bulk merge people: `{ keepId, mergeIds }`

### POST /admin/entities/places/bulk-merge
Bulk merge places: `{ keepId, mergeIds }`

### POST /admin/entities/persons/actions/:actionId/undo
Undo a person rename/merge: `{ actionType: 'rename' | 'merge', actor? }`

### POST /admin/entities/places/actions/:actionId/undo
Undo a place rename/merge: `{ actionType: 'rename' | 'merge', actor? }`

---

## Relationships (Admin)

Routes: `backend/src/routes/admin/relationships.ts`

### GET /admin/relationships
List all person-to-person relationships for admin table/review UIs.

### GET /admin/relationships/:id
Get a single relationship by ID.

### POST /admin/relationships
Create relationship:
`{ personAId, personBId, relationshipType, confidence?, notes?, discoveredInLetterId? }`

### PUT /admin/relationships/:id
Update relationship fields:
`{ relationshipType?, confidence?, notes? }`

### DELETE /admin/relationships/:id
Delete relationship.

### POST /admin/relationships/backfill-from-letters
Backfill person-to-person relationship edges from letter-level sender/recipient metadata.

Response: `{ scannedLetters, created, updated, skipped }`

---

## Uploads

### POST /admin/uploads

Multipart `files` field. Query: `force` (overwrite).

**Response**: `{ success, failed, results: [...], errors: [...] }`

Limits: 500 files, 50MB each, images only.
