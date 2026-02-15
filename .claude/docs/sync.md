# Frontend-Backend Sync

Values that must match on both sides. When adding new options, update BOTH.

## Sort Fields

| Field | Frontend | Backend |
|-------|----------|---------|
| createdAt | AdminDashboard | admin letters query schema |
| letterDate | AdminDashboard | admin letters query schema |
| sender | AdminDashboard | admin letters query schema |
| recipient | AdminDashboard | admin letters query schema |
| workflow | AdminDashboard | admin letters query schema |
| visibility | AdminDashboard | admin letters query schema |
| collection | AdminDashboard | admin letters query schema |

**Files:** `frontend/src/api/letters.ts` (SortField type), `backend/src/routes/admin/letters.ts` (Zod schema)

## Workflow States

`UPLOADED`, `TRANSCRIBING`, `TRANSCRIBED`, `METADATA_EXTRACTING`, `METADATA_DRAFTED`, `REVIEWED`

**Note:** REVIEWED is deprecated. Use two-track content status instead.

## Visibility States

`PUBLISHED`, `HIDDEN`

## Content Status (Two-Track)

`EMPTY` → `AI_DRAFT` → `EDITED` → `VERIFIED`

**Files:** `frontend/src/types/Letter.ts`, `backend/src/db/schema.ts`

## Icon Names

Must exist in `frontend/src/components/common/Icon.tsx`:

`upload`, `edit`, `check`, `delete`, `back`, `plus`, `minus`, `save`, `process`, `arrow-left`, `arrow-right`, `arrows-horizontal`, `close`, `confirm`, `eye`, `eye-off`, `reset`, `clear`, `select-all`, `folder`, `file`, `logout`, `refresh`, `chevron-down`, `chevron-right`, `down`, `right`, `lock`, `unlock`, `zoom-in`, `zoom-out`, `person`, `place`, `relationships`, `columns`, `more`
