# Letter Archive

Historical letter preservation and exploration platform. Full-stack app with React frontend, Express backend, PostgreSQL database, and OpenAI-powered transcription.

## Documentation for Claude Agents

**Start here** - read relevant docs in `.claude/docs/` before exploring the codebase:

| Doc | When to Read |
|-----|--------------|
| [reusable-components.md](.claude/docs/reusable-components.md) | Working with UI components (Button, Modal, Badge, etc.) |
| [frontend-architecture.md](.claude/docs/frontend-architecture.md) | Understanding page structure and connections |
| [api-contracts.md](.claude/docs/api-contracts.md) | Making or modifying API calls |
| [filename-conventions.md](.claude/docs/filename-conventions.md) | File upload/parsing logic |
| [processing-pipeline.md](.claude/docs/processing-pipeline.md) | AI transcription/metadata workflow |
| [database-schema.md](.claude/docs/database-schema.md) | Database operations and schema |

## Self-Updating Documentation

**Important**: When you modify code that is documented in a doc file, update that doc at the end of your changes. This keeps documentation in sync with the codebase.

| If you modify... | Update this doc |
|------------------|-----------------|
| `frontend/src/components/common/*` | `reusable-components.md` |
| Add/remove a page or change routes | `frontend-architecture.md` |
| Add/modify an API endpoint | `api-contracts.md` |
| Change filename parsing logic | `filename-conventions.md` |
| Modify processing/transcription logic | `processing-pipeline.md` |
| Change database schema | `database-schema.md` |

## Adding New Documentation

When a feature or pattern is complex enough to warrant documentation:

1. Create `.claude/docs/{feature-name}.md` (use kebab-case)
2. Use this template:

```markdown
# {Feature Name}

## Overview
Brief description of what this feature does.

## Location
Key files:
- `path/to/main/file.ts`
- `path/to/related/file.ts`

## How It Works
Explanation of the pattern/architecture.

## Usage Examples
Code snippets or scenarios.

## Related Docs
- [related-doc.md](.claude/docs/related-doc.md)
```

3. Add to the table above in this file
4. Add to `.claude/docs/README.md`

### Future Doc Ideas

These patterns may warrant documentation as they grow:
- `logging.md` - Pino logger patterns, request context
- `state-management.md` - React state patterns (useState, Context)
- `error-handling.md` - Toast system, backend error codes
- `upload-workflow.md` - Complex UploadLetterPage state machine
- `dto-transformations.md` - Backend → Frontend type mapping

## Common Commands

```bash
# Frontend
cd frontend && npm run dev     # Dev server (localhost:5173)
cd frontend && npm run build   # Production build

# Backend
cd backend && npm run dev      # Dev server with watch (localhost:3000)
cd backend && npm run build    # Compile TypeScript

# Database
cd backend && npm run db:push  # Push schema changes to database
cd backend && npm run db:studio # Open Drizzle Studio
```

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite, React Router
- **Backend**: Express, TypeScript, Drizzle ORM
- **Database**: PostgreSQL
- **AI**: OpenAI API (transcription, metadata extraction)

## Backend Conventions

See [backend/CLAUDE.md](backend/CLAUDE.md) for backend-specific patterns and conventions.
