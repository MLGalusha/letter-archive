# Public API

Routes: `backend/src/routes/letters.ts`, `collections.ts`, `images.ts`, `relationships.ts`

## GET /letters

List published letters with filtering.

**Query**: `page`, `limit`, `collection`, `sort` (letterDate|sender|createdAt), `sortOrder`

**Response**: `{ letters: [...], page, limit }`

---

## GET /letters/:letterId

Single letter with pages and related items.

**Response**: Full letter object with `pages[]`, `relatedItems[]`

---

## GET /collections

All collections with letter counts.

---

## GET /collections/:code

Collection with its published letters.

---

## GET /images/:pageId

Binary image with 1-year cache.

---

## GET /relationships

Public relationship graph data.

**Response**: `{ nodes: [{ id, name, letterCount }], edges: [{ id, source, target, relationshipType, confidence }] }`

---

## GET /relationships/collection/:collectionId

Relationship graph filtered to a specific collection.

**Params**: `collectionId` UUID (validated)
**Errors**: `400` when `collectionId` is not a valid UUID

---

## GET /relationships/path/:personAId/:personBId

Find shortest connection path between two people.

**Params**: `personAId` UUID, `personBId` UUID (validated)
**Errors**: `400` when either ID is not a valid UUID

**Response**:
- Connected: `{ path: [{ id, name }], edges: [{ id, type }] }`
- Not connected: `{ path: [], edges: [], message }`

---

## GET /persons/:id

Public person profile with biography, relationships, and published letter references.

---

## GET /places/:id

Public place profile with:
- `notes` (manual/admin notes only)
- `themes` (AI-generated place themes)
- published letter references and role stats
