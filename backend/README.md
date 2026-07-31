# Backend

Node.js + Express + TypeScript API server with PostgreSQL (Drizzle ORM), OpenAI-powered AI pipeline, and Google Cloud Vision OCR.

## Quick Start

```bash
npm install
cp .env.example .env       # Add OPENAI_API_KEY for real AI, or omit for stub mode
npm run db:up               # Start PostgreSQL
npm run drizzle:migrate     # Apply migrations
npm run dev                 # API server on port 3002
npm run worker              # Background worker (separate terminal)
```

A dev admin account (`dev@localhost.test` / `dev`) is auto-seeded when `NODE_ENV !== 'production'`.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://app:app@localhost:5432/app` | PostgreSQL connection string |
| `PORT` | `3002` | API server port |
| `SITE_URL` | `http://localhost:5174` | Frontend URL (CORS) |
| `STORAGE_DIR` | `./storage` | Local file storage directory |
| `OPENAI_API_KEY` | — | OpenAI key (optional — stub mode if absent) |
| `OPENAI_MODEL` | `gpt-5.4` | Model for transcription and extraction |
| `JWT_SECRET` | `change-me-in-production` | JWT signing secret |
| `JWT_EXPIRY` | `24h` | Token expiration |
| `CORS_ORIGINS` | — | Additional allowed origins (comma-separated) |
| `LOG_DIR` | `./logs` | NDJSON log output directory |
| `LOG_RETENTION_HOURS` | `168` | Log file retention (7 days) |

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Dev server with hot reload |
| `npm run worker` | Background worker with hot reload |
| `npm run build` | Compile TypeScript |
| `npm start` | Production server |
| `npm run start:worker` | Production worker |
| `npm run admin:create` | Create admin user via CLI |
| `npm run migrate:prod` | Production migrations |
| `npm run typecheck` | Type check without emitting |
| `npm test` | Run tests (Vitest) |
| `npm run test:watch` | Tests in watch mode |
| `npm run db:up` / `db:down` | Start/stop PostgreSQL container |
| `npm run drizzle:generate` | Guarded while snapshot lineage is stale; see repository-root `docs/migrations.md` |
| `npm run drizzle:migrate` | Apply pending migrations |
| `npm run logs:query -- --hours 24` | Query recent logs |
| `npm run logs:errors` | Errors from last 24 hours |
| `npm run detect-lines` | Run the operator-controlled Kraken 7 native-layout workflow |

## Kraken 7 native layout

Kraken is an explicit operator workflow, not part of the API or background
worker process. Build the pinned Python 3.12 environment and inspect the queue
before writing anything:

```bash
bash python/setup.sh --rebuild
npm run detect-lines -- --url https://example.test --email admin@example.test --password '...' --dry-run
npm run detect-lines -- --url https://example.test --email admin@example.test --password '...' --page-id <PAGE_ID>
npm run detect-lines -- --url https://example.test --email admin@example.test --password '...' --limit 5
```

`--page-id` and `--limit` bound a mutating run. An unbounded interactive run
requires typing a page-count-specific confirmation; an unbounded non-TTY run
exits without processing. The server queue includes every source-checksummed
page that lacks a canonical `PageLayoutV2`, including pages that already have
mutable review segments. Uploads are fenced to the source revision/checksum
returned by that queue. When reviewed segments already exist, the canonical
native layout is added underneath them without replacing their geometry or
verification state.

[`python/line_finder.py`](python/line_finder.py) is the one supported detector
entry point. It uses Kraken 7's task API and emits native `PageLayoutV2`;
curved baselines, bbox-only lines, polygons, regions, direction, provider
reading order, stable identity, and model/source provenance remain canonical
instead of being reduced to axis-aligned review boxes. The old independent
Kraken 6 segmentation/recognition script and its lossy JSON output were
removed.

The remote CLI starts one versioned NDJSON Python worker for the whole run.
That worker loads the bundled model once, processes pages sequentially at
concurrency 1, returns one structured result per request, and remains usable
when one page fails. Normal completion uses an explicit shutdown handshake.
`--native-json` remains available for a strict one-shot result.

Each native result records the actual Python, Kraken, Torch, Pillow, and NumPy
versions plus OS/architecture and resolved execution device. Setup applies
[`constraints-runtime.txt`](python/constraints-runtime.txt) to the
inference-sensitive numerical stack. Those constraints pin versions while
still letting pip select the correct macOS or Linux wheel; they are
intentionally not described as a universal hashed lockfile. CI runs both
contract tests and a bounded prediction through Kraken's actual bundled BLLA
model.

The measured 66-page warm CPU soak peaked at 1,850,490,880 bytes (1.72 GiB)
RSS and averaged 10.05 seconds per page on an Apple M1. For deployment
planning, use a dedicated 2-vCPU/8-GiB worker at concurrency 1 as the
conservative starting point, then verify it with production images and memory
telemetry before changing concurrency. See the
[benchmark results](benchmarks/layout/RESULTS-2026-07-28.md) for the exact
measurement and caveats.

## API Routes

### Public

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/sitemap.xml` | Dynamic XML sitemap |
| `GET` | `/letters` | Search and filter letters |
| `GET` | `/letters/:id` | Letter detail with pages |
| `GET` | `/collections` | List collections |
| `GET` | `/collections/:id` | Collection detail with profile |
| `GET` | `/persons/:id` | Person detail with related letters |
| `GET` | `/places/:id` | Place detail with related letters |
| `GET` | `/relationships-graph` | Relationship graph data |
| `GET` | `/updates` | Blog post listings |
| `GET` | `/updates/:slug` | Blog post detail |
| `GET` | `/content-pages/:slug` | Content page (About, Support) |
| `GET` | `/images/*` | Letter page image serving |
| `GET` | `/settings/public` | Public site configuration |

### Admin (JWT-authenticated)

| Area | Endpoints |
|------|-----------|
| **Auth** | Login, logout, invite acceptance, user management |
| **Letters** | CRUD, transcript/metadata editing, verification, bulk operations, processing control |
| **Collections** | CRUD, profile generation, featured letter management |
| **Entities** | Person/place search, canonical record management, extraction review queue |
| **Relationships** | Person-to-person relationship CRUD |
| **Uploads** | Multi-file image upload with filename parsing |
| **Content** | Blog post CRUD (MDX), page block editing, image uploads |
| **Settings** | Site configuration key-value store |
| **Notifications** | Admin notification feed |
| **Usage** | OpenAI API cost and token analytics |

## Database

19 tables across four domains:

**Archive** — `collections`, `letters`, `letter_pages`, `letter_versions`, `letter_views`

**Entities** — `canonical_persons`, `canonical_places`, `letter_persons`, `letter_places`, `person_relationships`, `entity_review_queue`

**Content** — `update_posts`, `content_pages`, `site_settings`

**Admin** — `admin_users`, `admin_invites`, `admin_notifications`, `audit_log`, `api_usage_logs`

Key design decisions:
- Two independent content status tracks (transcript + metadata): `EMPTY → AI_DRAFT → EDITED → VERIFIED`
- Publication visibility decoupled from verification state
- Letters unique by `(collection_id, date_raw, type, type_sequence)`
- Person relationships enforce `person_a_id < person_b_id` ordering
- Version history on transcript and metadata changes

## Logs

Structured NDJSON logs rotate hourly. Every HTTP response includes `x-request-id` for request tracing.

```bash
npm run logs:errors                                                 # Last 24h errors
npm run logs:query -- --request-id <uuid>                           # Trace a request
npm run logs:query -- --path /admin/processing --hours 6            # Filter by route
```

## Architecture

```
src/
├── index.ts              # Server entry
├── worker.ts             # Background processing worker
├── ai/                   # OpenAI + Google Vision, prompt templates
├── auth/                 # JWT authentication
├── cli/                  # CLI tools (create-admin, migrate)
├── config/               # Environment configuration
├── db/                   # Drizzle schema + migrations
├── dto/                  # Data transfer object types
├── middleware/            # Auth, error handling, rate limiting, validation
├── pipeline/             # Processing workflows
├── routes/               # Route handlers (public + admin/)
├── schemas/              # Zod request validation schemas
├── services/             # Business logic
└── utils/                # Helpers
```
