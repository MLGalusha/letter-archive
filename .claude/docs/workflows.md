# Admin Workflows

Verification and processing workflows for the admin dashboard.

## Two-Track Verification

Letters have separate verification tracks for transcription and metadata.

### Transcription Track
| Status | Meaning |
|--------|---------|
| `PENDING` | Not yet transcribed |
| `AI_GENERATED` | AI transcription complete, needs review |
| `VERIFIED` | Human-reviewed and confirmed |

### Metadata Track
| Status | Meaning |
|--------|---------|
| `PENDING` | Not yet extracted |
| `AI_GENERATED` | AI extraction complete, needs review |
| `VERIFIED` | Human-reviewed and confirmed |

### Combined Workflow Status
| Status | When |
|--------|------|
| `PENDING` | Both tracks pending |
| `PROCESSING` | Either track in progress |
| `REVIEW_NEEDED` | Either track is AI_GENERATED |
| `VERIFIED` | Both tracks verified |

A letter can only be published when both tracks are `VERIFIED`.

## Letter Processing Pipeline

### 1. Upload
```
Images uploaded → Letter record created → PENDING status
```

### 2. Transcription
```
PENDING → (AI processes) → AI_GENERATED → (human reviews) → VERIFIED
```

Transcription uses GPT-5.2 vision model. See [ai.md](ai.md).

### 3. Metadata Extraction
```
Requires: transcription exists
PENDING → (AI extracts) → AI_GENERATED → (human reviews) → VERIFIED
```

V2 extraction includes: sender, recipient, date, emotional tone, relationship, topics, quotes, entities.

### 4. Publication
```
Requires: transcript VERIFIED + metadata VERIFIED
visibility: DRAFT → PUBLISHED
```

## Resync Feature

Ensures metadata consistency when identities change.

### When to Use
- After editing sender/recipient names
- When linked persons are missing
- When summary/hook uses generic terms

### How It Works

**Step 1: Audit (GPT-4o-mini)**
Fast check for issues:
- Summary says "the sender" instead of actual name
- No linked person for sender/recipient role
- Missing relationship type

**Step 2: Regenerate (GPT-5.2)**
Fixes identified issues:
- Rewrites summary/hook with actual names
- Creates linked person records
- Infers relationship type

### Triggering Resync

From Letter Review page:
1. Click "Resync" button
2. System audits current metadata
3. Shows what will be updated
4. Confirm to apply changes

API:
```
POST /admin/letters/:id/resync
```

## Bulk Operations

### Transcribe Selected
Transcribes multiple letters at once.

- From selection: Uses `POST /admin/letters/bulk/transcribe`
- Skips letters already transcribed

### Extract Metadata
Extracts metadata for multiple letters.

- Requires transcription to exist
- From selection: Uses `POST /admin/letters/bulk/extract-metadata`
- Skips letters without transcriptions

### Reset Transcriptions
Clears transcription data to re-run.

- Requires selection (destructive)
- Sets transcript status back to PENDING
- Clears transcription text

### Clear Metadata
Clears all metadata fields.

- Requires selection (destructive)
- Sets metadata status back to PENDING
- Clears extracted fields

### Delete
Soft-deletes selected letters.

- Requires selection
- Sets `deleted_at` timestamp
- Can be restored by clearing `deleted_at`

## Version History

Changes to transcription and metadata are versioned.

### letter_versions table
```sql
letter_id       UUID
field_type      'transcript' | 'metadata'
version_number  INTEGER (1, 2, 3...)
content         JSONB
source          'ai' | 'human'
created_at      TIMESTAMP
```

### Viewing History
From Letter Review page, click version history icon to see:
- All previous versions
- Who made each change (AI vs human)
- Timestamp of each version

### Rollback
Select a previous version to restore it. Creates a new version with the old content.

## Admin Dashboard Filters

### Quick Filters
| Filter | Shows |
|--------|-------|
| All | Everything not deleted |
| Pending | Not yet processed |
| Review | AI-generated, needs human review |
| Verified | Both tracks verified |
| Published | Visible to public |

### Column Visibility
Toggle columns: Date, Sender, Recipient, Transcript, Metadata, Visibility, Created, Updated

### Collection Filter
Filter by collection code to see only letters from one collection.

## Files

| File | Purpose |
|------|---------|
| [AdminDashboard.tsx](../../frontend/src/pages/admin/AdminDashboard.tsx) | Main dashboard with filters and bulk ops |
| [LetterReviewPage.tsx](../../frontend/src/pages/admin/LetterReviewPage.tsx) | Individual letter review |
| [routes/admin/letters.ts](../../backend/src/routes/admin/letters.ts) | Letter endpoints including resync |
| [pipeline/processor.ts](../../backend/src/pipeline/processor.ts) | Background processing |
