# Admin Workflows

Current processing and review behavior for the admin surface.

## Status Model

The app currently uses two systems in parallel:
- Legacy `workflow` state on letters (kept for compatibility)
- Two-track content statuses for transcript and metadata (primary review model)

### Legacy Workflow (`letters.workflow`)
- `UPLOADED`
- `TRANSCRIBING`
- `TRANSCRIBED`
- `METADATA_EXTRACTING`
- `METADATA_DRAFTED`
- `REVIEWED` (legacy/deprecated)

### Two-Track Content Status (`letters.transcript_status`, `letters.metadata_content_status`)
- `EMPTY` -> no content
- `AI_DRAFT` -> AI generated
- `EDITED` -> human edited
- `VERIFIED` -> human explicitly verified

`extra_content_status` uses the same enum.

## Letter Review Workflow

### Transcript
1. Transcribe letter pages (`POST /admin/letters/:letterId/transcribe-letter` or bulk).
2. AI draft is loaded.
3. Admin edits as needed.
4. Admin verifies/unverifies transcript via:
   - `POST /admin/letters/:letterId/verify-transcript`
   - `POST /admin/letters/:letterId/unverify-transcript`

### Metadata
1. Generate/regenerate metadata from transcript:
   - `POST /admin/letters/:letterId/regenerate-metadata`
2. Admin edits fields (auto-save/version snapshots).
3. Admin verifies/unverifies metadata via:
   - `POST /admin/letters/:letterId/verify-metadata`
   - `POST /admin/letters/:letterId/unverify-metadata`

### Review Mode (LetterReviewPage)
Letter review now includes a toggleable review mode:
- line-by-line transcript selection
- image overlay of selected transcript line
- compact metadata snapshot for transcript-to-metadata checking

Primary files:
- `frontend/src/pages/admin/LetterReviewPage.tsx`
- `frontend/src/pages/admin/LetterReviewPage.css`

## Sender/Recipient Sync Workflow

Manual sender/recipient edits now immediately run participant sync (single letter updates, bulk update fields, metadata restore, and resync path):
1. Normalize names.
2. Attempt strict safe match.
3. Auto-create canonical person when no safe match exists.
4. Upsert sender/recipient links in `letter_persons`.
5. Sync sender-recipient relationship graph edge where possible.

Key file:
- `backend/src/services/entities/participant-sync.ts`

## Resync Workflow

Resync still supports AI-assisted metadata repair when needed:
- `POST /admin/letters/:letterId/resync-check`
- `POST /admin/letters/:letterId/resync`

Used after identity edits or metadata drift to refresh summary/hook/link consistency.

## Entity Operations Workflow

### Rename/Merge with Undo
People and places now return undo action IDs on rename/merge:
- `PUT /admin/entities/persons/:id`
- `PUT /admin/entities/places/:id`
- `POST /admin/entities/persons/merge`
- `POST /admin/entities/places/merge`

Undo endpoints:
- `POST /admin/entities/persons/actions/:actionId/undo`
- `POST /admin/entities/places/actions/:actionId/undo`

Backed by snapshots in `audit_log`.

### Places Theme Generation
Admins can generate place themes:
- `POST /admin/entities/places/:id/themes/generate`

Themes are persisted into marked blocks in place notes and exposed on public place pages.

## Bulk Operations

Supported bulk admin operations:
- `POST /admin/letters/bulk/transcribe`
- `POST /admin/letters/bulk/extract-metadata`
- `PATCH /admin/letters/bulk/update-fields`
- `POST /admin/letters/bulk/clear-transcriptions`
- `POST /admin/letters/bulk/clear-metadata`

## Version History

Transcript and metadata edits can be snapshotted and restored:
- `GET /admin/letters/:letterId/versions`
- `POST /admin/letters/:letterId/versions`
- `POST /admin/letters/:letterId/versions/:versionNumber/restore`

Table: `letter_versions` (`field_type`, `version_number`, `content`, `source`).

## Files

| File | Purpose |
|------|---------|
| `frontend/src/pages/admin/AdminDashboard.tsx` | Admin listing + bulk actions |
| `frontend/src/pages/admin/LetterReviewPage.tsx` | Letter review, edit, verify, review mode |
| `backend/src/routes/admin/letters.ts` | Letter admin API routes |
| `backend/src/services/letter-operations.ts` | Letter update/verification/resync/version logic |
| `backend/src/services/entities/participant-sync.ts` | Sender/recipient canonical linking + relationship sync |
| `backend/src/routes/admin/entities.ts` | Entity API routes including undo and place themes |
