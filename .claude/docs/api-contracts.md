# API Contracts

## Overview

The backend exposes a REST API built with Express. Public endpoints are unauthenticated; admin endpoints require authentication (implementation pending).

## Location

- Route files: `backend/src/routes/`
- Public: `letters.ts`, `collections.ts`, `images.ts`
- Admin: `admin/letters.ts`, `admin/uploads.ts`

---

## Public Endpoints

### GET /letters

List published letters with filtering and pagination.

**Query Parameters**:

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | number | 1 | Page number |
| `limit` | number | 20 | Items per page |
| `collection` | string | - | Filter by collection code |
| `visibility` | string | - | Filter by visibility (usually not used for public) |
| `workflow` | string | - | Filter by workflow state |
| `sort` | string | `createdAt` | Sort field: `letterDate`, `sender`, `workflow`, `visibility`, `createdAt` |
| `sortOrder` | string | `desc` | Sort direction: `asc` or `desc` |

**Response**:

```json
{
  "letters": [
    {
      "id": "uuid",
      "collectionCode": "003",
      "type": "L",
      "dateRaw": "18860314",
      "letterDate": "1886-03-14",
      "sender": "John Smith",
      "recipient": "Jane Doe",
      "locationWritten": "New York",
      "hook": "A poignant letter about...",
      "summary": "Full summary...",
      "visibility": "PUBLISHED",
      "workflow": "REVIEWED",
      "pages": [{ "id": "uuid", "pageNumber": 1 }],
      "relatedItems": [
        { "id": "uuid", "type": "C", "pages": [...] }
      ]
    }
  ],
  "page": 1,
  "limit": 20
}
```

**Notes**:
- Workflow filter applies to the PRIMARY letter of each group (L-type if exists)
- Related items (C, E, P types) are included with each primary letter

---

### GET /letters/:letterId

Get a single published letter with pages and related items.

**Response**:

```json
{
  "id": "uuid",
  "collectionCode": "003",
  "type": "L",
  "dateRaw": "18860314",
  "letterDate": "1886-03-14",
  "sender": "John Smith",
  "recipient": "Jane Doe",
  "locationWritten": "New York",
  "hook": "...",
  "summary": "...",
  "transcriptionText": "Full transcript...",
  "visibility": "PUBLISHED",
  "workflow": "REVIEWED",
  "pages": [
    { "id": "uuid", "pageNumber": 1, "type": "L" }
  ],
  "relatedItems": [
    {
      "id": "uuid",
      "type": "C",
      "pages": [...]
    }
  ]
}
```

**Error Responses**:
- `404`: Letter not found or not published

---

### GET /collections

List all collections with published letter counts.

**Response**:

```json
[
  {
    "id": "uuid",
    "collectionCode": "003",
    "name": "Smith Family Letters",
    "description": "Letters from the Smith family archive",
    "letterCount": 42
  }
]
```

---

### GET /collections/next-number

Get the next available collection number.

**Response**:

```json
{
  "nextCollectionNumber": 7
}
```

---

### GET /collections/:code

Get a collection with its published letters.

**Response**:

```json
{
  "id": "uuid",
  "collectionCode": "003",
  "name": "Smith Family Letters",
  "description": "...",
  "letterCount": 42,
  "letters": [
    { "id": "uuid", "sender": "...", ... }
  ]
}
```

**Error Responses**:
- `404`: Collection not found

---

### GET /images/:pageId

Serve an image file by page ID.

**Response**:
- Binary image data with appropriate `Content-Type`
- `Cache-Control: public, max-age=31536000` (1 year)

**Error Responses**:
- `404`: Page not found or file missing from disk

---

## Admin Endpoints

All admin endpoints are prefixed with `/admin`.

### Processing Controls

#### GET /admin/processing/status

Get current processing status.

**Response**:

```json
{
  "isRunning": true,
  "isPaused": false,
  "shouldAbort": false,
  "currentJob": { "letterId": "uuid", "type": "transcription" },
  "completed": 5,
  "failed": 1,
  "total": 20,
  "errors": ["uuid: Error message"],
  "lastCompletedAt": 1699999999999
}
```

---

#### POST /admin/processing/start-transcription

Start batch transcription processing.

**Request Body** (optional):

```json
{
  "collectionCode": "003"
}
```

**Response**:

```json
{
  "message": "Processing started",
  "total": 15
}
```

**Notes**:
- Only processes L-type letters with `workflow='UPLOADED'` and at least one page
- Runs asynchronously in background

---

#### POST /admin/processing/start-metadata

Start batch metadata extraction.

**Request Body** (optional):

```json
{
  "collectionCode": "003"
}
```

**Response**:

```json
{
  "message": "Processing started",
  "total": 10
}
```

**Notes**:
- Only processes L-type letters with `workflow='TRANSCRIBED'` and confirmed transcript

---

#### POST /admin/processing/pause

Pause current processing.

**Response**:

```json
{
  "message": "Processing paused"
}
```

---

#### POST /admin/processing/resume

Resume paused processing.

**Response**:

```json
{
  "message": "Processing resumed"
}
```

---

#### POST /admin/processing/abort

Abort current processing and revert in-progress job.

**Response**:

```json
{
  "message": "Processing aborted"
}
```

---

### Bulk Operations

#### POST /admin/letters/bulk/transcribe

Queue multiple letters for transcription.

**Request Body**:

```json
{
  "letterIds": ["uuid1", "uuid2", "uuid3"]
}
```

**Response**:

```json
{
  "queued": 3,
  "skipped": 0
}
```

---

#### POST /admin/letters/bulk/extract-metadata

Queue multiple letters for metadata extraction.

**Request Body**:

```json
{
  "letterIds": ["uuid1", "uuid2"]
}
```

**Response**:

```json
{
  "queued": 2,
  "skipped": 0
}
```

---

#### POST /admin/letters/bulk/reset-transcriptions

Reset transcriptions and clear all metadata.

**Request Body**:

```json
{
  "letterIds": ["uuid1", "uuid2"]
}
```

**Response**:

```json
{
  "message": "Transcriptions reset",
  "updated": 2
}
```

**Notes**:
- Sets workflow to `UPLOADED`
- Clears transcription text and confirmation
- Clears all metadata fields

---

#### POST /admin/letters/bulk/clear-metadata

Clear metadata but keep transcription.

**Request Body**:

```json
{
  "letterIds": ["uuid1", "uuid2"]
}
```

**Response**:

```json
{
  "message": "Metadata cleared",
  "updated": 2
}
```

**Notes**:
- Sets workflow to `TRANSCRIBED`
- Clears metadata fields only

---

### Letter List (Admin)

#### GET /admin/letters

List all letters with server-side filtering, pagination, and stats.

**Query Parameters**:

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | number | 1 | Page number |
| `limit` | number | 50 | Items per page (max 100) |
| `collection` | string | - | Filter by collection code |
| `visibility` | `PUBLISHED` \| `HIDDEN` | - | Filter by visibility |
| `workflow` | string | - | Filter by workflow state(s), comma-separated |
| `search` | string | - | Search in sender, recipient, summary, hook |
| `sort` | string | `createdAt` | Sort field: `letterDate`, `sender`, `recipient`, `workflow`, `visibility`, `collection`, `createdAt` |
| `sortOrder` | string | `desc` | Sort direction: `asc` or `desc` |

**Response**:

```json
{
  "letters": [
    {
      "id": "uuid",
      "collectionCode": "003",
      "type": "L",
      "dateRaw": "18860314",
      "letterDate": "1886-03-14",
      "metadata": {
        "sender": "John Smith",
        "recipient": "Jane Doe",
        "hook": "A poignant letter..."
      },
      "visibility": "HIDDEN",
      "workflowState": "METADATA_DRAFTED",
      "images": [...],
      "createdAt": "2024-01-15T10:30:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 847,
    "totalPages": 17
  },
  "stats": {
    "total": 2341,
    "uploaded": 423,
    "transcribed": 892,
    "metadataReady": 156,
    "reviewed": 870,
    "published": 1200,
    "hidden": 1141
  }
}
```

**Notes**:
- Stats reflect the entire collection (or all letters if no collection filter), unaffected by other filters
- Search uses case-insensitive ILIKE matching
- Workflow filter accepts multiple states: `?workflow=UPLOADED,TRANSCRIBED`

---

### Single Letter Operations

#### GET /admin/letters/:letterId

Get a letter (any visibility/workflow state).

**Response**: Same as public GET /letters/:letterId but includes all states.

---

#### PUT /admin/letters/:letterId

Update letter fields.

**Request Body**:

```json
{
  "transcriptionText": "Updated transcript...",
  "sender": "John Smith",
  "recipient": "Jane Doe",
  "locationWritten": "Boston",
  "hook": "One-line hook",
  "summary": "Longer summary",
  "extractedDate": "1886-03-14",
  "extractedDateConfidence": "exact",
  "tags": ["family", "business"],
  "visibility": "PUBLISHED",
  "notes": "Admin notes"
}
```

All fields are optional.

**Response**: Updated letter object.

**Notes**:
- Adding transcription to UPLOADED letter auto-transitions to TRANSCRIBED
- Adding metadata to TRANSCRIBED letter auto-transitions to METADATA_DRAFTED
- Setting visibility to PUBLISHED sets reviewedAt

---

#### POST /admin/letters/:letterId/confirm-transcript

Confirm transcript is correct, triggering metadata extraction.

**Response**: Updated letter object.

**Error Responses**:
- `400`: Letter not in TRANSCRIBED state

---

#### POST /admin/letters/:letterId/review

Mark letter as reviewed (admin sign-off).

**Response**: Updated letter object with `workflow='REVIEWED'`.

---

#### POST /admin/letters/:letterId/process

Re-enqueue letter for processing.

**Response**:

```json
{
  "message": "Letter enqueued for processing",
  "letterId": "uuid"
}
```

---

#### DELETE /admin/letters/:letterId

Soft delete a letter.

**Response**:

```json
{
  "message": "Letter deleted successfully",
  "letterId": "uuid"
}
```

---

### File Uploads

#### POST /admin/uploads

Upload letter images.

**Request**: `multipart/form-data` with `files` field.

**Query Parameters**:

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `force` | boolean | false | Overwrite existing files |

**Response**:

```json
{
  "success": 5,
  "failed": 1,
  "results": [
    {
      "filename": "003-18860314-L01-01.jpg",
      "letterId": "uuid",
      "pageId": "uuid",
      "collectionCode": "003",
      "storagePath": "003/uuid.jpg",
      "alreadyExists": false
    }
  ],
  "errors": [
    {
      "filename": "invalid.jpg",
      "error": "Invalid filename format"
    }
  ]
}
```

**Limits**:
- Max 500 files per request
- Max 50MB per file
- Only image files accepted

---

## Error Response Format

All errors follow this format:

```json
{
  "error": "Error message",
  "details": [...] // Optional, for validation errors
}
```

Common HTTP status codes:
- `400`: Bad request / validation error
- `404`: Resource not found
- `500`: Server error

---

## Related Docs

- [frontend-architecture.md](frontend-architecture.md) - How frontend consumes these endpoints
- [processing-pipeline.md](processing-pipeline.md) - AI processing workflow
- [filename-conventions.md](filename-conventions.md) - Upload filename format
