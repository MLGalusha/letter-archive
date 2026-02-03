# Letter Archive Backend

Local Node.js/Express/TypeScript backend for the letter-archive application with PostgreSQL, Drizzle ORM, and OpenAI-powered transcription pipeline.

## Prerequisites

- Node.js 20.x
- Docker (for PostgreSQL)
- npm

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy environment file
cp .env.example .env
# Edit .env if needed (add OPENAI_API_KEY for real transcription)

# 3. Start PostgreSQL
npm run db:up

# 4. Generate and apply migrations
npm run drizzle:generate
npm run drizzle:migrate

# 5. Start the server
npm run dev

# 6. (In a separate terminal) Start the worker
npm run worker
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://app:app@localhost:5432/app` | PostgreSQL connection string |
| `PORT` | `3001` | Server port |
| `STORAGE_DIR` | `./storage` | Local storage directory for uploaded files |
| `OPENAI_API_KEY` | (none) | OpenAI API key (optional - stub mode if not set) |
| `OPENAI_MODEL` | `gpt-4o` | OpenAI model for transcription/extraction |

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start development server with hot reload |
| `npm run worker` | Start background worker for processing |
| `npm run build` | Build TypeScript to JavaScript |
| `npm run start` | Run production build |
| `npm run typecheck` | Run TypeScript type checking |
| `npm run db:up` | Start PostgreSQL container |
| `npm run db:down` | Stop PostgreSQL container |
| `npm run drizzle:generate` | Generate migration from schema changes |
| `npm run drizzle:migrate` | Apply migrations to database |

## API Endpoints

### Public

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/letters` | List letters (with filtering) |
| `GET` | `/letters/:letterId` | Get single letter with pages |

### Admin

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/admin/uploads` | Upload letter images |
| `POST` | `/admin/letters/:letterId/process` | Re-queue letter for processing |

## File Upload

### Filename Format

Files must follow the pattern: `{collectionCode}-{dateRaw}-{type}{typeSequence}-{pageNumber}.{ext}`

Examples:
- `003-18860314-L01-01.jpg` → Collection 003, March 14 1886, Letter 1, Page 1
- `003-18XX0706-L02-03.jpg` → Collection 003, Unknown year July 6, Letter 2, Page 3
- `003-18XXXXXX-C01-01.jpg` → Collection 003, Unknown date, Card 1, Page 1

### Components

| Component | Format | Description |
|-----------|--------|-------------|
| `collectionCode` | 3 digits | Collection identifier (e.g., `003`) |
| `dateRaw` | 8 chars | Date in YYYYMMDD format, X for unknown digits |
| `type` | L/C/E | Letter, Card, or Extra |
| `typeSequence` | 2 digits | Sequence number within type (e.g., `01`) |
| `pageNumber` | 2 digits | Page number within the letter (e.g., `01`) |

### Date Confidence

- All digits: `date_confidence = 'exact'`, `letter_date` is parsed
- Contains X: `date_confidence = 'unknown'`, `letter_date` is NULL

### Upload Example

```bash
curl -X POST http://localhost:3001/admin/uploads \
  -F "files=@003-18860314-L01-01.jpg" \
  -F "files=@003-18860314-L01-02.jpg"
```

Response:
```json
{
  "success": 2,
  "failed": 0,
  "results": [
    {
      "filename": "003-18860314-L01-01.jpg",
      "letterId": "uuid...",
      "pageId": "uuid...",
      "collectionCode": "003",
      "storagePath": "./storage/collections/003/18860314/L01/003-18860314-L01-01.jpg",
      "alreadyExists": false
    }
  ]
}
```

## Processing Pipeline

### Workflow States

1. `UPLOADED` → Initial state after file upload
2. `TRANSCRIBING` → Transcription in progress
3. `TRANSCRIBED` → Transcription complete
4. `METADATA_EXTRACTING` → Metadata extraction in progress
5. `METADATA_DRAFTED` → Metadata extracted, ready for review
6. `REVIEWED` → Admin has reviewed/edited

### Automatic Processing

- **L-type letters** are automatically processed by the background worker
- **C-type (cards)** and **E-type (extras)** are stored but not transcribed

### Stub Mode

If `OPENAI_API_KEY` is not set, the system runs in stub mode:
- Transcription returns placeholder text
- Metadata extraction returns placeholder values
- Pipeline still functions for development/testing

## Storage

Files are stored at:
```
storage/collections/{collectionCode}/{dateRaw}/{type}{typeSequence}/{originalFilename}
```

Example:
```
storage/collections/003/18860314/L01/003-18860314-L01-01.jpg
```

## Database Schema

### Tables

- **collections**: Collection metadata
- **letters**: Letter records with transcription and metadata
- **letter_pages**: Individual page records with storage paths

### Key Constraints

- Letters are unique by: `(collection_id, date_raw, type, type_sequence)`
- Pages are unique by: `(letter_id, page_number)`
- Published letters require review: `visibility <> 'PUBLISHED' OR reviewed_at IS NOT NULL`

## Development

### Editing Schema

1. Edit `src/db/schema.ts`
2. Generate migration: `npm run drizzle:generate`
3. Apply migration: `npm run drizzle:migrate`

### Type Checking

```bash
npm run typecheck
```

## Architecture

```
src/
├── index.ts           # Server entry point
├── worker.ts          # Background worker
├── config/
│   └── env.ts         # Environment configuration
├── db/
│   ├── schema.ts      # Drizzle schema
│   └── migrations/    # Generated migrations
├── routes/
│   ├── health.ts
│   ├── letters.ts
│   └── admin/
│       ├── uploads.ts
│       └── letters.ts
├── services/
│   ├── filename-parser.ts
│   ├── storage.ts
│   ├── collections.ts
│   ├── letters.ts
│   ├── letter-pages.ts
│   └── upload.ts
├── ai/
│   ├── openai.ts      # OpenAI adapter
│   └── prompts.ts     # Transcription/extraction prompts
├── pipeline/
│   ├── processor.ts
│   ├── transcription.ts
│   └── metadata.ts
└── middleware/
    ├── error-handler.ts
    └── validate.ts
```
