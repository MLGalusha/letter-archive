# Letter Archive

A full-stack platform for preserving and exploring historical letter collections. Transforms physical letters into a searchable digital archive using AI-powered transcription, structured metadata extraction, and a human-in-the-loop verification workflow.

> This is a personal project built around a private collection of historical letters. The archive data is not included in this repository — the codebase is shared to showcase the architecture and engineering.

<!-- Screenshots: crop browser chrome before adding -->
<!-- ![Admin Review](docs/screenshots/admin-review.png) -->
<!-- ![Public Browse](docs/screenshots/public-browse.png) -->

## What It Does

**For the archivist (admin):**

- Upload scanned letter images organized by collection
- AI transcribes handwritten text from letter scans
- AI extracts structured metadata: dates, senders, recipients, locations, topics, emotional tone, and a narrative "hook" line
- Two-track verification workflow — transcript and metadata reviewed independently
- Entity management — merge duplicate people/places, track relationships across letters
- Resync system to propagate identity corrections across all derived metadata

**For the visitor (public):**

- Browse and search digitized collections
- View high-resolution scans with zoom/pan alongside verified transcriptions
- Filter by date, person, location, collection, or topic
- Explore connections — follow a person, place, or theme across letters
- Discovery navigation — jump between related entities while reading

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  React Frontend (Vite + TypeScript + React Router)      │
│  ┌───────────┐ ┌─────────────────┐ ┌────────────────────┐
│  │ Public UI │ │ Admin Dashboard │ │ Image Viewer       │
│  └───────────┘ └─────────────────┘ └────────────────────┘
└────────────────────────┬────────────────────────────────┘
                         │ REST API
┌────────────────────────┴────────────────────────────────┐
│  Express Backend (Node.js + TypeScript)                 │
│  ┌──────────┐ ┌──────────────┐ ┌──────────────────────┐ │
│  │ Routes   │ │ AI Pipeline  │ │ Processing Engine    │ │
│  └──────────┘ └──────┬───────┘ └──────────────────────┘ │
└───────────┬──────────┼──────────────────────────────────┘
            │          │
     ┌──────┴───┐  ┌───┴──────┐
     │ Postgres │  │ OpenAI   │
     │ (Drizzle)│  │ API      │
     └──────────┘  └──────────┘
```

### Tech Stack

| Layer         | Technology                                                        |
| ------------- | ----------------------------------------------------------------- |
| Frontend      | React, TypeScript, Vite, React Router                             |
| Backend       | Node.js, Express, TypeScript                                      |
| Database      | PostgreSQL with Drizzle ORM                                       |
| AI            | OpenAI structured outputs for transcription + metadata extraction |
| Image Viewing | Pan/zoom viewer for high-res letter scans                         |

## Key Engineering Decisions

**AI Pipeline with Structured Outputs** — Transcription and metadata extraction use OpenAI's structured output mode to return validated JSON matching TypeScript schemas. This ensures consistent enum values (relationship types, emotional tones, topics) without post-processing.

**Two-Track Verification** — Transcript status and metadata status are tracked independently (`EMPTY` → `AI_DRAFT` → `EDITED` → `VERIFIED`), separate from publication visibility. An archivist can verify a transcript while metadata is still in AI draft.

**Entity Resolution** — People and places extracted from letters are linked to canonical entities. When duplicates are discovered and merged, a resync system re-evaluates all affected letters using a two-model approach: one model audits what changed, another regenerates derived fields.

**Controlled Vocabularies** — Metadata fields like relationship types, emotional tones, and topics use fixed enums enforced at the AI prompt level and validated in the schema. This keeps the archive consistent and filterable without manual tagging.

**Filename-Driven Organization** — Letter images follow a structured naming convention (`{collection}-{type}-{date}-{page}.jpg`) that encodes collection, document type (letter/envelope/cover), date, and page number — parsed automatically on upload.

## Project Structure

```
letter-archive/
├── frontend/src/
│   ├── components/common/   # Reusable UI component library
│   ├── pages/               # Route pages (public + admin)
│   ├── api/                 # API client layer
│   └── styles/              # CSS custom properties design system
│
├── backend/src/
│   ├── routes/              # Express route handlers
│   ├── services/            # Business logic
│   ├── db/                  # Drizzle schema + migrations
│   ├── ai/                  # OpenAI integration + prompt templates
│   └── pipeline/            # Processing workflows
│
└── .claude/docs/            # Architecture documentation
```

## Not a Template

This repository is shared as a portfolio piece, not a reusable starter kit. The application is built around a specific private letter collection and requires:

- The original scanned letter images (not included)
- A PostgreSQL database with the archive data
- An OpenAI API key for the AI pipeline

The codebase demonstrates the architecture, AI integration patterns, and full-stack workflow — but is not designed to be cloned and run as-is.

## Documentation

See [.claude/docs/](.claude/docs/) for detailed architecture docs:

- [About This Project](.claude/docs/about-this-project.md) — Vision and goals
- [API Reference](.claude/docs/api/) — Endpoint documentation
- [Database Schema](.claude/docs/database.md) — Table structures and relationships
- [AI Integration](.claude/docs/ai.md) — Prompt design and structured outputs
- [Processing Pipeline](.claude/docs/processing.md) — Transcription and extraction workflow
- [Entity Management](.claude/docs/entities.md) — People, places, and relationship tracking
- [Components](.claude/docs/components.md) — Frontend UI component library

## Verification

Run the full local regression stack from the repo root:

```bash
./scripts/verify-all.sh
```

Useful toggles:

- `VERIFY_SKIP_TYPECHECK=1 ./scripts/verify-all.sh`
- `VERIFY_SKIP_BUILD=1 ./scripts/verify-all.sh`

Run mocked Playwright coverage separately:

```bash
cd e2e && npm run test:mocked
```

For request-level debugging after a failure, use the structured backend log queries documented in [backend/README.md](backend/README.md).

## License

MIT
