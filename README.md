# Voices That Remain

A full-stack platform that turns boxes of handwritten historical letters into a searchable, browsable digital archive. AI handles transcription and metadata extraction; humans verify and curate.

**[voicesthatremain.com](https://voicesthatremain.com)**

## What It Does

**For the archivist (admin):**

- Upload scanned letter images — filenames encode collection, date, document type, and page number, parsed automatically
- AI transcribes handwritten text from multi-page scans using vision models
- AI extracts structured metadata: dates, senders, recipients, locations, topics, emotional tone, and a narrative hook
- Two independent verification tracks — transcript accuracy and metadata correctness reviewed separately
- Entity management with canonical person/place registries and a letter-scoped extraction review queue
- Collection profiles with AI-generated narratives, reading paths, and correspondent summaries
- Blog editor (MDX) for publishing journal entries and project updates
- Block-based page editor for About, Support, and Contact pages (9 section types)
- OpenAI usage dashboard with per-call token and cost tracking

**For the visitor (public):**

- Browse collections with rich profile cards, highlight images, and curated reading paths
- Read letters with a high-res lightbox (zoom/pan), reading-mode transcript, and original-formatting view
- Search and filter by date, person, location, collection, topic, transcript status, and verification state
- Explore an interactive relationship graph connecting people across the archive
- Read journal entries and project updates

## Architecture

```
                          ┌──────────────────────────────┐
                          │     React + Vite Frontend     │
                          │  Public UI  ·  Admin Dashboard │
                          └──────────────┬───────────────┘
                                         │ REST
┌──────────┐  ┌──────────────────────────┴────────────────────────┐  ┌───────────┐
│ Google    │  │            Express Backend (TypeScript)           │  │  OpenAI   │
│ Cloud     │◄─┤  Routes · Services · Pipeline · Auth · Middleware │─►│  API      │
│ Storage   │  └──────────┬──────────────────────────┬────────────┘  │ (Vision + │
└──────────┘              │                          │               │ Structured│
                          │                   ┌──────┴──────┐       │ Outputs)  │
                   ┌──────┴──────┐            │  Background │       └───────────┘
                   │  PostgreSQL │            │   Worker    │
                   │  (Drizzle)  │            └─────────────┘
                   └─────────────┘
```

## Engineering Highlights

**AI Pipeline with Structured Outputs** — Transcription uses OpenAI's vision API to read handwritten text from scans. Metadata extraction uses structured output mode to return validated JSON matching TypeScript schemas — enforcing controlled vocabularies for emotional tone, topics, and relationship types without post-processing. A guillemet tagging system (`«SENDER:name»`, `«RECIPIENT:name»`) marks identity references in summaries and hooks so they can be linked to canonical entities.

**Two-Track Verification** — Transcript status and metadata status advance independently (`EMPTY → AI_DRAFT → EDITED → VERIFIED`), decoupled from publication visibility. An archivist can verify a transcript while metadata is still in draft, or vice versa.

**Filename-Driven Ingest** — Images follow a structured naming convention (`{collection}-{date}-{type}{seq}-{page}.ext`) that encodes collection, document type (letter, telegram, cover, photo, ephemera), date, and page number. The upload pipeline parses filenames, creates collection/letter/page records, and routes documents into the appropriate processing workflow automatically.

**Block-Based Content System** — Public pages (About, Support) use a JSON block schema with 9 section types (hero, richtext, cards, stats, steps, CTA, quote, two-column, contact) rendered by a shared `BlockRenderer` and edited inline through the admin UI.

**Entity Extraction Review** — AI suggests person and place entities from letter text. Suggestions enter a review queue where an admin confirms, rejects, or links them to existing canonical records. The canonical registry tracks biographical details and hooks for each person.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19, TypeScript, Vite, React Router |
| Rich Text | TipTap (inline tag editor), MDXEditor (blog posts) |
| Data Viz | D3 (relationship graph), Recharts (usage analytics) |
| Backend | Node.js, Express, TypeScript |
| Database | PostgreSQL 16, Drizzle ORM |
| AI | OpenAI (vision + structured outputs), Google Cloud Vision (OCR) |
| Image Processing | Sharp |
| Auth | JWT + bcrypt |
| Validation | Zod |
| Testing | Vitest (unit), Playwright (E2E + accessibility via axe-core) |
| Deployment | Google Cloud Run, Cloud Build, Artifact Registry |

## Project Structure

```
voices-that-remain/
├── backend/src/
│   ├── routes/            # Express route handlers (public + admin)
│   │   └── admin/         # Admin API with letter, entity, collection management
│   ├── services/          # Business logic and external integrations
│   ├── pipeline/          # Processing workflows (transcription, metadata, entities)
│   ├── ai/                # OpenAI + Google Vision integration, prompt templates
│   ├── db/                # Drizzle schema (19 tables), migrations
│   ├── schemas/           # Zod request validation
│   ├── auth/              # JWT authentication
│   └── middleware/        # Error handling, rate limiting, validation
│
├── frontend/src/
│   ├── pages/             # Public pages + admin dashboard
│   ├── components/        # UI component library (common, search, viewers, editors)
│   ├── api/               # API client layer
│   ├── hooks/             # Custom React hooks
│   ├── contexts/          # React context providers
│   └── styles/            # CSS custom properties design system
│
├── e2e/                   # Playwright tests (live + mocked configurations)
├── deploy/                # Cloud Run service manifests
└── scripts/               # Utility and verification scripts
```

## AI Pipeline

Letters move through a multi-stage processing pipeline:

```
Upload → Transcription → Metadata Extraction → Entity Extraction → Review
```

1. **Transcription** — Vision model reads handwritten text from each page image. Multi-page letters are transcribed page-by-page and concatenated. Extra content (telegrams, envelopes, covers) goes through a separate check to determine if it contains transcribable text.

2. **Metadata Extraction** — Structured output model extracts dates, senders, recipients, locations, topics, emotional tone, a narrative hook, and a summary. Uses controlled enum vocabularies enforced at the prompt level. Identity references in free-text fields are tagged with guillemet markers for downstream entity linking.

3. **Entity Extraction** — Mentioned people and places are matched against canonical registries or queued for admin review as new entity candidates.

4. **Collection Profiles** — AI generates collection-level narratives, correspondent summaries, and reading path suggestions from the aggregated letter metadata.

All AI stages run in a background worker process. Without an OpenAI API key, the system operates in stub mode with mock responses for development and testing.

## Database

19 tables organized across four domains:

- **Archive** — `collections`, `letters`, `letter_pages`, `letter_versions`, `letter_views`
- **Entities** — `canonical_persons`, `canonical_places`, `letter_persons`, `letter_places`, `person_relationships`, `entity_review_queue`
- **Content** — `update_posts`, `content_pages`, `site_settings`
- **Admin** — `admin_users`, `admin_invites`, `admin_notifications`, `audit_log`, `api_usage_logs`

## Testing

- **Unit tests** — Vitest across both backend and frontend
- **E2E tests** — Playwright with two configurations: live (against running servers) and mocked (no database required, runs in CI)
- **Accessibility** — axe-core integration in E2E specs
- **CI** — Smoke E2E suite on pull requests; full suite available via manual dispatch

## Development

Monorepo with three packages — no root `package.json`. Each runs independently.

```bash
# Backend (terminal 1)
cd backend && npm run dev          # API on port 3002

# Worker (terminal 2)
cd backend && npm run worker       # Background processing

# Frontend (terminal 3)
cd frontend && npm run dev         # Vite on port 5174
```

Postgres runs natively on port 5432. A dev admin account (`dev@localhost.test` / `dev`) is auto-seeded in non-production environments.

| Task | Command |
|------|---------|
| Run backend tests | `cd backend && npm test` |
| Run frontend tests | `cd frontend && npm test` |
| Run E2E tests | `cd e2e && npx playwright test` |
| Typecheck backend | `cd backend && npm run typecheck` |
| Generate migration | `cd backend && npm run drizzle:generate` |
| Apply migration | `cd backend && npm run drizzle:migrate` |
| Full verification | `./scripts/verify-all.sh` |

Without an `OPENAI_API_KEY`, the AI pipeline runs in stub mode with mock responses.

## License

MIT
