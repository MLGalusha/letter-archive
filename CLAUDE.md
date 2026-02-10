# Letter Archive

Historical letter digitization platform with AI-powered transcription. React frontend, Express backend, PostgreSQL, OpenAI.

## Active Plan

**Plan file:** `.claude/plans/active.md`

**Instructions:**
1. If the plan file has content, read it and execute the plan
2. After completing the plan, clear the file (leave it empty) so it's ready for the next plan
3. If the user asks to create a plan, write it to this file

**Documentation rule:** After implementing new features, update or create relevant docs in `.claude/docs/`. Keep docs current with the codebase.

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
| AI integration | [ai.md](.claude/docs/ai.md) |
| Entity management | [entities.md](.claude/docs/entities.md) |
| Admin workflows | [workflows.md](.claude/docs/workflows.md) |
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
