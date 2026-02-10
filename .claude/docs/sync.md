# Frontend-Backend Sync

Values that must match on both sides. When adding new options, update BOTH.

## Sort Fields

| Field | Frontend | Backend |
|-------|----------|---------|
| createdAt | AdminDashboard.tsx | admin/letters.ts:37 |
| letterDate | AdminDashboard.tsx | admin/letters.ts:37 |
| sender | AdminDashboard.tsx | admin/letters.ts:37 |
| recipient | AdminDashboard.tsx | admin/letters.ts:37 |
| workflow | AdminDashboard.tsx | admin/letters.ts:37 |
| visibility | AdminDashboard.tsx | admin/letters.ts:37 |
| collection | AdminDashboard.tsx | admin/letters.ts:37 |

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

`upload`, `edit`, `check`, `delete`, `back`, `plus`, `save`, `process`, `arrow-left`, `arrow-right`, `close`, `confirm`, `eye`, `eye-off`, `reset`, `clear`, `select-all`, `folder`, `file`, `logout`
