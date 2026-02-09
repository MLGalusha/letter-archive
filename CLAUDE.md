# Letter Archive

Historical letter preservation and exploration platform. Full-stack app with React frontend, Express backend, PostgreSQL database, and OpenAI-powered transcription.

## Before You Start

**Read these first:**

| Document | Why |
|----------|-----|
| [about-this-project.md](.claude/docs/about-this-project.md) | Understand what we're building and why—the vision of a "wise guide" AI that helps visitors explore letter stories |
| [collaboration-style.md](.claude/docs/collaboration-style.md) | **How we work together.** Ask questions proactively. Plan before implementing. Challenge ideas. We build this together. |

## Quick Reference

Before exploring the codebase manually, **check if a doc already covers it**:

| I need to... | Read this first |
|--------------|-----------------|
| Use or modify Button, Modal, Badge, Icon, Dropdown | [reusable-components.md](.claude/docs/reusable-components.md) |
| Understand how pages connect or add a new page | [frontend-architecture.md](.claude/docs/frontend-architecture.md) |
| Make API calls or add/modify endpoints | [api-contracts.md](.claude/docs/api-contracts.md) |
| Work with file upload or filename parsing | [filename-conventions.md](.claude/docs/filename-conventions.md) |
| Understand transcription or metadata extraction | [processing-pipeline.md](.claude/docs/processing-pipeline.md) |
| Query the database or modify schema | [database-schema.md](.claude/docs/database-schema.md) |
| Work with backend code patterns | [backend/CLAUDE.md](backend/CLAUDE.md) |
| **Check if frontend/backend values match** | [frontend-backend-sync.md](.claude/docs/frontend-backend-sync.md) |

**Why this matters**: These docs contain the exact patterns, props, CSS classes, and conventions used in this codebase. Reading them first saves exploration time and ensures consistency.

## Key Patterns

### UI Components
All reusable components are in `frontend/src/components/common/`. Import from the barrel file:
```tsx
import { Button, IconButton, Modal, Badge, Icon } from "../components/common";
```

### CSS Variables
The app uses CSS custom properties defined in `frontend/src/styles/index.css`:
- Colors: `--bg`, `--bg-light`, `--text`, `--text-muted`, `--border`, `--highlight`
- Spacing: `--spacing-xs`, `--spacing-sm`, `--spacing-md`, `--spacing-lg`, `--spacing-xl`
- Radius: `--radius-sm`, `--radius-md`, `--radius-lg`

### Global CSS Reset
There's a global button reset in `frontend/src/styles/index.css` that sets `background: none` on all buttons. Component CSS must explicitly set backgrounds to override this.

## Project Structure

```
frontend/
├── src/
│   ├── components/common/    # Reusable UI components
│   ├── pages/               # Route pages
│   ├── api/                 # API client functions
│   ├── contexts/            # React Context providers
│   └── styles/              # Global CSS
backend/
├── src/
│   ├── routes/              # Express route handlers
│   ├── services/            # Business logic
│   ├── db/                  # Drizzle schema and queries
│   └── ai/                  # OpenAI integration
```

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

## Self-Updating Documentation

When you modify code that is documented, update the relevant doc:

| If you modify... | Update this doc |
|------------------|-----------------|
| `frontend/src/components/common/*` | `reusable-components.md` |
| Add/remove a page or change routes | `frontend-architecture.md` |
| Add/modify an API endpoint | `api-contracts.md` |
| Change filename parsing logic | `filename-conventions.md` |
| Modify processing/transcription logic | `processing-pipeline.md` |
| Change database schema | `database-schema.md` |
| Add sort fields, workflow states, or other shared enums | `frontend-backend-sync.md` |
| Change collaboration guidelines or working style | `collaboration-style.md` |
| Update project goals or vision | `about-this-project.md` |

## Adding New Documentation

When a feature or pattern is complex enough to warrant documentation:

1. Create `.claude/docs/{feature-name}.md` (use kebab-case)
2. Add to the Quick Reference table above
3. Add to `.claude/docs/README.md`

### Future Doc Ideas

These patterns may warrant documentation as they grow:
- `logging.md` - Pino logger patterns, request context
- `state-management.md` - React state patterns (useState, Context)
- `error-handling.md` - Toast system, backend error codes
- `upload-workflow.md` - Complex UploadLetterPage state machine

## Debugging & Logs

### Backend Logs
Logs are written to `backend/logs/app.log` in JSON format. To check recent errors:

```bash
# Read last 50 lines of log
tail -50 backend/logs/app.log

# Or read the full log file with the Read tool
Read file_path="backend/logs/app.log"
```

When debugging errors:
1. Read the log file to see recent requests and errors
2. Look for `"level":50` (error) or `"level":40` (warn) entries
3. Check the `err` field for stack traces

### Log Levels
- 10: trace
- 20: debug
- 30: info
- 40: warn
- 50: error
- 60: fatal

## Screenshots

When the user references images/screenshots (e.g., "I'm showing you 2 images", "here are 3 screenshots"):

1. Go to `~/Documents/screenshots/`
2. List files sorted by modification time (newest first)
3. Read the N most recent images where N = the number mentioned

```bash
ls -t ~/Documents/screenshots/ | head -2
```
