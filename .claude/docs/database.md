# Database Schema

Location: `backend/src/db/schema.ts`

## Tables

### collections
```
id, collection_code (unique 3-digit), title, description, created_at
```

### letters
**Identity:** `id`, `collection_id`, `date_raw`, `letter_date`, `date_confidence`, `type`, `type_sequence`

**State:** `workflow`, `visibility`, `transcript_status`, `metadata_content_status`

**Content:** `transcription_text`, `sender`, `recipient`, `location_written`, `hook`, `summary`, `tags[]`

**Tracking:** `reviewed_at`, `deleted_at`, timestamps

### letter_pages
```
id, letter_id, page_number, storage_path, original_filename, checksum_sha256
```

### letter_versions
```
id, letter_id, field_type ('transcript'|'metadata'), version_number, content (jsonb), source ('ai'|'human')
```

## Enums

**letter_type:** L, P, E, V, A, D, C, N, T

**workflow_state:** UPLOADED → TRANSCRIBING → TRANSCRIBED → METADATA_EXTRACTING → METADATA_DRAFTED → REVIEWED

**visibility_state:** PUBLISHED, HIDDEN

**content_status:** EMPTY → AI_DRAFT → EDITED → VERIFIED

**job_status:** PENDING, RUNNING, SUCCESS, FAILED

## Key Constraints

- Unique identity: `(collection_id, date_raw, type, type_sequence)`
- Published requires `reviewed_at` set
- Pages cascade delete with letter
- Versions cascade delete with letter

## Common Queries

```typescript
// Letter with pages
db.query.letters.findFirst({
  where: eq(letters.id, letterId),
  with: { collection: true, pages: { orderBy: asc(p.pageNumber) } },
});

// Published only
db.query.letters.findMany({
  where: and(eq(letters.visibility, 'PUBLISHED'), isNull(letters.deletedAt)),
});
```

## Commands

```bash
npm run db:push     # Push schema (dev)
npm run db:generate # Generate migration
npm run db:migrate  # Run migrations
```
