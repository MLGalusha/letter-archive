# Entity Management

System for tracking people and places across letters with deduplication and linking.

## Concepts

### Canonical Entities
Unique, deduplicated records for people and places that appear across multiple letters.

- **Canonical Person**: A unique individual (e.g., "Jimmie Galusha")
- **Canonical Place**: A unique location (e.g., "Chicago, Illinois")

Each canonical entity has:
- `canonicalName` - primary display name
- `aliases[]` - alternate names/spellings that refer to the same entity
- `notes` - optional admin notes

### Letter-Entity Links
Junction tables connecting letters to the entities they mention.

- **Letter Person**: Links a letter to a person with a role
- **Letter Place**: Links a letter to a place with a role

## Person Roles

| Role | Description |
|------|-------------|
| `sender` | Author of the letter |
| `recipient` | Person the letter is addressed to |
| `mentioned` | Person referenced in the letter content |

## Place Roles

| Role | Description |
|------|-------------|
| `written_from` | Where the letter was written |
| `mentioned` | Place referenced in content |
| `destination` | Where recipient is located |

## Place Types

Optional classification: `city`, `state`, `country`, `address`, `region`, `other`

## Fuzzy Matching

Uses PostgreSQL trigram similarity (`pg_trgm`) for entity matching.

```typescript
import { findMatchingPersons } from './services/entities.js';

const matches = await findMatchingPersons('James Galusha');
// Returns matches with similarity scores:
// [{ entityId: '...', canonicalName: 'Jimmie Galusha', similarity: 85 }]
```

**Thresholds:**
- `>= 85%`: Auto-link without review
- `>= 50%`: Suggest for review
- `< 50%`: Create new entity

Matching checks both `canonicalName` and `aliases[]`.

## Merge Logic

When two entities are duplicates, merge them:

```typescript
import { mergePersons, bulkMergePersons } from './services/entities.js';

// Merge a single entity
await mergePersons(keepId, mergeId);
// - Merged name becomes alias of kept entity
// - All letter links transfer to kept entity
// - Merged entity is deleted

// Bulk merge multiple entities
await bulkMergePersons(keepId, [mergeId1, mergeId2, mergeId3]);
// - All merged entities' names/aliases become aliases of kept entity
// - All letter links transfer to kept entity
// - All merged entities are deleted
```

The merge:
1. Adds merged entity's name + aliases to kept entity's aliases
2. Reassigns all `letterPersons` from merged → kept
3. Deletes the merged entity

## Duplicate Suggestions

AI-powered duplicate detection using trigram similarity:

```typescript
import { findPotentialDuplicatePersons } from './services/entities.js';

const suggestions = await findPotentialDuplicatePersons(20);
// Returns pairs of entities with 50-99% similarity
// [{ entityAId, entityAName, entityBId, entityBName, similarity }]
```

**UI Features:**
- Collapsible "Potential Duplicates" section on People/Places pages
- Dismiss suggestions (stored in localStorage)
- Click "Merge" to open side-by-side comparison modal
- Comparison shows detailed stats for both entities
- Swap which entity to keep with radio buttons

## Database Tables

### canonical_persons
```sql
id              UUID PRIMARY KEY
canonical_name  TEXT NOT NULL
aliases         TEXT[]
notes           TEXT
created_at      TIMESTAMP
updated_at      TIMESTAMP
```

### canonical_places
```sql
id              UUID PRIMARY KEY
canonical_name  TEXT NOT NULL
aliases         TEXT[]
place_type      place_type_enum
notes           TEXT
created_at      TIMESTAMP
updated_at      TIMESTAMP
```

### letter_persons
```sql
id          UUID PRIMARY KEY
letter_id   UUID REFERENCES letters
person_id   UUID REFERENCES canonical_persons
role        person_role_enum (sender, recipient, mentioned)
confidence  INTEGER (0-100)
context     TEXT
created_at  TIMESTAMP
```

### letter_places
```sql
id          UUID PRIMARY KEY
letter_id   UUID REFERENCES letters
place_id    UUID REFERENCES canonical_places
role        place_role_enum (written_from, mentioned, destination)
confidence  INTEGER (0-100)
context     TEXT
created_at  TIMESTAMP
```

## Admin Pages

### People Page (`/admin/entities/people`)
- Lists all canonical persons
- Shows letter count for each
- Edit canonical name and aliases
- Single merge (search for entity to merge)
- Bulk selection with checkboxes
- Bulk merge (select master, merge all others)
- Duplicate suggestions section (collapsible)
- Side-by-side comparison modal before merging
- Biography generation and verification

### Places Page (`/admin/entities/places`)
- Lists all canonical places
- Edit name, type, and aliases
- Single merge (search for entity to merge)
- Bulk selection with checkboxes
- Bulk merge (select master, merge all others)
- Duplicate suggestions section (collapsible)
- Side-by-side comparison modal before merging

### Entity Review Page (`/admin/entities/:type/:id`)
- View entity details
- See all linked letters
- Edit entity

## API Endpoints

See [api/admin.md](api/admin.md) for full endpoint documentation.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/entities/suggestions` | Get duplicate suggestions (entityType=person\|place) |
| GET | `/admin/entities/persons` | List all persons |
| GET | `/admin/entities/places` | List all places |
| GET | `/admin/entities/persons/:id` | Get person details |
| GET | `/admin/entities/persons/:id/merge-details` | Get detailed stats for merge comparison |
| GET | `/admin/entities/places/:id/merge-details` | Get detailed stats for merge comparison |
| PUT | `/admin/entities/persons/:id` | Update person |
| POST | `/admin/entities/persons/merge` | Merge two persons |
| POST | `/admin/entities/persons/bulk-merge` | Bulk merge multiple persons |
| POST | `/admin/entities/places/merge` | Merge two places |
| POST | `/admin/entities/places/bulk-merge` | Bulk merge multiple places |

## Workflow

### During Metadata Extraction
1. AI extracts entities from letter text
2. System fuzzy-matches against existing entities
3. High-confidence matches auto-link
4. Low-confidence matches queue for review

### During Resync
When sender/recipient names are updated:
1. Check if linked person exists for role
2. If not, create canonical person and link it
3. Resync ensures sender/recipient are always linked

## Files

| File | Purpose |
|------|---------|
| [services/entities.ts](../../backend/src/services/entities.ts) | Compatibility barrel that re-exports entity service modules |
| [services/entities/matching.ts](../../backend/src/services/entities/matching.ts) | Fuzzy matching for people/places |
| [services/entities/persons.ts](../../backend/src/services/entities/persons.ts) | Person CRUD, stats, duplicate suggestions, merge details |
| [services/entities/places.ts](../../backend/src/services/entities/places.ts) | Place CRUD, stats, duplicate suggestions, merge details |
| [services/entities/junctions.ts](../../backend/src/services/entities/junctions.ts) | Letter-person/place link CRUD + enriched letter lookups |
| [services/entities/review-queue.ts](../../backend/src/services/entities/review-queue.ts) | Entity review queue CRUD and stats |
| [services/entities/relationships.ts](../../backend/src/services/entities/relationships.ts) | Person relationship CRUD and query helpers |
| [services/entities/extraction.ts](../../backend/src/services/entities/extraction.ts) | Entity extraction processing/orchestration helpers |
| [routes/admin/entities.ts](../../backend/src/routes/admin/entities.ts) | API endpoints |
| [pages/admin/PeoplePage.tsx](../../frontend/src/pages/admin/PeoplePage.tsx) | People management UI |
| [pages/admin/PlacesPage.tsx](../../frontend/src/pages/admin/PlacesPage.tsx) | Places management UI |
| [components/DuplicateSuggestions](../../frontend/src/components/DuplicateSuggestions/) | Collapsible duplicate suggestions panel |
| [components/MergeComparison](../../frontend/src/components/MergeComparison/) | Side-by-side merge comparison modal |
| [components/BulkMergeModal](../../frontend/src/components/BulkMergeModal/) | Bulk merge selection modal |
