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

---

## Uploads

### POST /admin/uploads

Multipart `files` field. Query: `force` (overwrite).

**Response**: `{ success, failed, results: [...], errors: [...] }`

Limits: 500 files, 50MB each, images only.
