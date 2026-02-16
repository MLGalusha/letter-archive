# Database Schema

Location: `backend/src/db/schema.ts`

## Tables

### collections
```
id, collection_code (unique 3-digit), title, description, created_at
```

### letters
**Identity:** `id`, `collection_id`, `date_raw`, `letter_date`, `date_confidence`, `type`, `type_sequence`

**State:** `workflow`, `visibility`, `transcript_status`, `metadata_content_status`, `extra_content_status`

**Content:** `transcription_text`, `sender`, `recipient`, `location_written`, `hook`, `summary`, `tags[]`, `extra_content_transcript`, `ai_notes`

**V2 metadata:** `emotional_tone`, `sender_recipient_relationship`, `primary_topics[]`, `metadata_v2_json`, `entity_extraction_json`

**Tracking:** `reviewed_at`, `deleted_at`, timestamps

### letter_pages
```
id, letter_id, page_number, storage_path, original_filename, checksum_sha256
```

### letter_versions
```
id, letter_id, field_type ('transcript'|'metadata'), version_number, content (jsonb), source ('ai'|'human')
```

### canonical_persons
```
id, canonical_name, aliases[], notes, biography, biography_status, biography_verified_at, biography_verified_by, created_at, updated_at
```
Unique individuals across all letters. Has trigram index for fuzzy matching.

### canonical_places
```
id, canonical_name, aliases[], place_type, notes, created_at, updated_at
```
Unique locations. `place_type`: city, region, country, street, landmark, other.

### letter_persons
```
id, letter_id, person_id, role, name_as_written, relationship_to_sender, confidence (0-100), context, created_at
```
Links letters to people. `role`: sender, recipient, mentioned.

### letter_places
```
id, letter_id, place_id, role, name_as_written, confidence (0-100), context, created_at
```
Links letters to places. `role`: written_from, mentioned, destination.

### person_relationships
```
id, person_a_id, person_b_id, relationship_type, notes, discovered_in_letter_id, confidence, confirmed_by, confirmed_at, created_at, updated_at
```
Bidirectional relationship graph between canonical people.

### audit_log
```
id, timestamp, user_id, action, entity_type, entity_id, changes (jsonb), created_at
```
Used for admin action history including rename/merge undo snapshots.

## Enums

**letter_type:** L, P, E, V, A, D, C, N, T

**workflow_state:** UPLOADED → TRANSCRIBING → TRANSCRIBED → METADATA_EXTRACTING → METADATA_DRAFTED → REVIEWED

**visibility_state:** PUBLISHED, HIDDEN

**content_status:** EMPTY → AI_DRAFT → EDITED → VERIFIED

**job_status:** PENDING, RUNNING, SUCCESS, FAILED

**person_role:** sender, recipient, mentioned

**place_role:** written_from, mentioned, destination

**place_type:** city, region, country, street, landmark, other

**emotional_tone:** joyful, hopeful, neutral, anxious, sad, angry, desperate

**relationship_type:** spouse, fiancé/fiancée, romantic-partner, parent, child, sibling, grandparent, grandchild, aunt/uncle, nephew/niece, cousin, in-law, friend, acquaintance, business-associate, employer, employee, unknown

## Key Constraints

- Unique identity: `(collection_id, date_raw, type, type_sequence)`
- Published requires `reviewed_at` set
- Pages cascade delete with letter
- Versions cascade delete with letter

## Common Queries

```typescript
// Letter with pages and entities
db.query.letters.findFirst({
  where: eq(letters.id, letterId),
  with: {
    collection: true,
    pages: { orderBy: asc(p.pageNumber) },
    persons: { with: { person: true } },
    places: { with: { place: true } },
  },
});

// Published only
db.query.letters.findMany({
  where: and(eq(letters.visibility, 'PUBLISHED'), isNull(letters.deletedAt)),
});

// Find persons by fuzzy name match
db.execute(sql`
  SELECT id, canonical_name, similarity(canonical_name, ${name}) as score
  FROM canonical_persons
  WHERE similarity(canonical_name, ${name}) > 0.5
  ORDER BY score DESC
`);
```

## Commands

```bash
npm run drizzle:generate # Generate migration
npm run drizzle:migrate  # Run migrations
```
