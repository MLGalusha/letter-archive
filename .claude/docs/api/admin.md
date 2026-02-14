# Admin API

Routes: `backend/src/routes/admin/letters.ts`, `uploads.ts`

All prefixed with `/admin`.

## Architecture

The admin letters route file is a thin routing layer. Business logic lives in service files:

| Service | File | Responsibility |
|---------|------|---------------|
| Letter Queries | `services/letter-queries.ts` | Listing, filtering, pagination, stats |
| Processing Queue | `services/processing-queue.ts` | Background processing, queue CRUD, pause/resume/abort |
| Letter Operations | `services/letter-operations.ts` | Bulk ops, updates, versions, verification, transcription, entities, resync |

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

**Service**: `buildLetterUpdates()` in `letter-operations.ts`

### POST /admin/letters/:letterId/process
Re-enqueue letter for processing.

### DELETE /admin/letters/:letterId
Soft delete.

---

## Processing Queue

### GET /admin/processing/status
Current on-demand processing state.

**Service**: `getProcessingStatus()` in `processing-queue.ts`

### GET /admin/processing/queue
Full queue status: active, queued, and recent jobs.

**Service**: `getQueueStatus()` in `processing-queue.ts`

### POST /admin/processing/start-transcription
Start transcription for eligible letters. Accepts filter options.

**Body** (optional): `{ collectionCode, visibility, search, year, month, day, dateFrom, dateTo }`

**Service**: `startTranscriptionProcessing()` in `processing-queue.ts`

### POST /admin/processing/start-metadata
Start metadata extraction for eligible letters.

**Service**: `startMetadataProcessing()` in `processing-queue.ts`

### POST /admin/processing/pause | resume | abort
Control background processing.

**Service**: `pauseProcessing()`, `resumeProcessing()`, `abortProcessing()` in `processing-queue.ts`

### POST /admin/processing/queue/remove
Remove a PENDING item: `{ letterId, type }` where type is `transcription | metadata | entity_extraction`

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
Queue for metadata extraction: `{ letterIds: [...], skipConfirmationCheck? }`

**Service**: `bulkExtractMetadata()` in `letter-operations.ts`

### POST /admin/letters/bulk/clear-transcriptions
Clear transcriptions and reset to UPLOADED: `{ letterIds: [...] }`

**Service**: `bulkClearTranscriptions()` in `letter-operations.ts`

### PATCH /admin/letters/bulk/update-fields
Update sender/recipient: `{ updates: [{ letterId, sender?, recipient? }] }`

**Service**: `bulkUpdateFields()` in `letter-operations.ts`

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
Re-run entity extraction only. Requires transcription.

---

## Two-Track Verification

### POST /admin/letters/:letterId/verify-transcript | unverify-transcript
**Service**: `verifyTranscript()`, `unverifyTranscript()` in `letter-operations.ts`

### POST /admin/letters/:letterId/verify-metadata | unverify-metadata
**Service**: `verifyMetadata()`, `unverifyMetadata()` in `letter-operations.ts`

### POST /admin/letters/:letterId/verify-extra-content | unverify-extra-content
**Service**: `verifyExtraContent()`, `unverifyExtraContent()` in `letter-operations.ts`

---

## Transcription

### POST /admin/letters/:letterId/regenerate-transcription
Re-run transcription. Query: `includeExtras=true` to include extras.

**Service**: `regenerateTranscription()` in `letter-operations.ts`

### POST /admin/letters/:letterId/transcribe-letter
Transcribe only the letter pages.

**Service**: `transcribeLetterOnly()` in `letter-operations.ts`

### POST /admin/letters/:letterId/transcribe-extras
Transcribe extra content items.

**Service**: `transcribeExtras()` in `letter-operations.ts`

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

### GET /admin/entities/places/:id
Get place with linked letters.

### PATCH /admin/entities/persons/:id
Update person: `{ canonicalName, aliases, notes }`

### PATCH /admin/entities/places/:id
Update place: `{ canonicalName, aliases, placeType, notes }`

### POST /admin/entities/persons/:id/merge
Merge into another person: `{ mergeIntoId }`

### POST /admin/entities/places/:id/merge
Merge into another place: `{ mergeIntoId }`

### DELETE /admin/entities/persons/:id
Delete person (removes links).

### DELETE /admin/entities/places/:id
Delete place (removes links).

---

## Uploads

### POST /admin/uploads

Multipart `files` field. Query: `force` (overwrite).

**Response**: `{ success, failed, results: [...], errors: [...] }`

Limits: 500 files, 50MB each, images only.
