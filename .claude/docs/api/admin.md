# Admin API

Routes: `backend/src/routes/admin/letters.ts`, `uploads.ts`

All prefixed with `/admin`.

## Letter List

### GET /admin/letters

**Query**: `page`, `limit`, `collection`, `visibility`, `workflow` (comma-separated), `search`, `sort`, `sortOrder`

**Response**: `{ letters, pagination: { page, limit, total, totalPages }, stats }`

---

## Single Letter

### GET /admin/letters/:letterId
Returns any letter regardless of visibility/workflow.

### PUT /admin/letters/:letterId
Update fields. All optional: `transcriptionText`, `sender`, `recipient`, `locationWritten`, `hook`, `summary`, `visibility`, etc.

### DELETE /admin/letters/:letterId
Soft delete.

---

## Workflow Actions

### POST /admin/letters/:letterId/confirm-transcript
Triggers metadata extraction. Requires TRANSCRIBED state.

### POST /admin/letters/:letterId/review
Marks as reviewed.

---

## Bulk Operations

### POST /admin/letters/bulk/transcribe
Queue letters for transcription: `{ letterIds: [...] }`

### POST /admin/letters/bulk/extract-metadata
Queue for metadata extraction: `{ letterIds: [...] }`

### POST /admin/letters/bulk/reset-transcriptions
Reset to UPLOADED, clear all: `{ letterIds: [...] }`

### POST /admin/letters/bulk/clear-metadata
Keep transcript, clear metadata: `{ letterIds: [...] }`

### POST /admin/letters/bulk/delete
Soft delete multiple: `{ letterIds: [...] }`

---

## Resync

### POST /admin/letters/:letterId/resync-check
Audit metadata for issues without applying changes.

**Response**: `{ needsUpdate, decision: { shouldUpdateSummary, shouldCreateSenderPerson, issues, ... } }`

### POST /admin/letters/:letterId/resync
Audit and apply fixes.

**Body** (optional): `{ oldSender, newSender, oldRecipient, newRecipient }` - for identity changes

**Response**: `{ letter, resync: { wasUpdated, updatedFields, decision } }`

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
