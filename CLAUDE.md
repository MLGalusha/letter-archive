# Letter Archive

Historical letter digitization platform with AI-powered transcription. React frontend, Express backend, PostgreSQL, OpenAI.

## Essential Context

**Read first:**
- [about-this-project.md](.claude/docs/about-this-project.md) — Vision: "wise guide" AI for exploring letter stories
- [collaboration-style.md](.claude/docs/collaboration-style.md) — Ask questions proactively, plan before implementing

## Reference Docs

| Task | Doc |
|------|-----|
| UI components | [components.md](.claude/docs/components.md) |
| API endpoints | [api/](.claude/docs/api/) (split by domain) |
| Database schema | [database.md](.claude/docs/database.md) |
| Processing pipeline | [processing.md](.claude/docs/processing.md) |
| Filename parsing | [filenames.md](.claude/docs/filenames.md) |
| Frontend/backend sync | [sync.md](.claude/docs/sync.md) |

## Project Structure

```
frontend/src/
├── components/common/  → Reusable UI (import from barrel)
├── pages/              → Route pages
├── api/                → API client
└── styles/             → CSS tokens in index.css

backend/src/
├── routes/             → Express handlers
├── db/                 → Drizzle schema
└── ai/                 → OpenAI integration
```

## Key Patterns

```tsx
// UI components - always import from barrel
import { Button, Modal, Badge } from "../components/common";
```

**CSS variables** in `frontend/src/styles/index.css`:
- Colors: `--bg`, `--bg-light`, `--text`, `--text-muted`, `--border`
- Spacing: `--spacing-xs` through `--spacing-xl`
- Global button reset exists—component CSS must set backgrounds

## Commands

```bash
cd frontend && npm run dev     # localhost:5173
cd backend && npm run dev      # localhost:3000
cd backend && npm run db:push  # Push schema changes
```

## Logs & Screenshots

- Backend logs: `backend/logs/app.log` (JSON, `"level":50` = error)
- Screenshots: `~/Documents/screenshots/` (sort by newest)
