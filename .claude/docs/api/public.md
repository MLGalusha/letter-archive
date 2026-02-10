# Public API

Routes: `backend/src/routes/letters.ts`, `collections.ts`, `images.ts`

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
