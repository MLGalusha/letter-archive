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
import { mergePersons } from './services/entities.js';

await mergePersons(keepId, mergeId);
// - Merged name becomes alias of kept entity
// - All letter links transfer to kept entity
// - Merged entity is deleted
```

The merge:
1. Adds merged entity's name + aliases to kept entity's aliases
2. Reassigns all `letterPersons` from merged → kept
3. Deletes the merged entity

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

### People Page (`/admin/people`)
- Lists all canonical persons
- Shows letter count for each
- Edit canonical name
- Merge duplicates
- View linked letters

### Places Page (`/admin/places`)
- Lists all canonical places
- Edit name and type
- Merge duplicates
- View linked letters

### Entity Review Page (`/admin/entities/:type/:id`)
- View entity details
- See all linked letters
- Edit entity

## API Endpoints

See [api/admin.md](api/admin.md) for full endpoint documentation.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/entities/persons` | List all persons |
| GET | `/admin/entities/places` | List all places |
| GET | `/admin/entities/persons/:id` | Get person details |
| PATCH | `/admin/entities/persons/:id` | Update person |
| POST | `/admin/entities/persons/:id/merge` | Merge persons |
| DELETE | `/admin/entities/persons/:id` | Delete person |

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
| [services/entities.ts](../../backend/src/services/entities.ts) | Entity CRUD, matching, merge |
| [routes/admin/entities.ts](../../backend/src/routes/admin/entities.ts) | API endpoints |
| [pages/admin/PeoplePage.tsx](../../frontend/src/pages/admin/PeoplePage.tsx) | People management UI |
| [pages/admin/PlacesPage.tsx](../../frontend/src/pages/admin/PlacesPage.tsx) | Places management UI |
