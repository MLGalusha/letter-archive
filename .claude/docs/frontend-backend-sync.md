# Frontend-Backend Sync Points

Quick reference for values that must match between frontend and backend. When adding new options, update BOTH sides.

---

## GET /admin/letters Query Parameters

### Sort Fields

| Field | Frontend | Backend | Status |
|-------|----------|---------|--------|
| `createdAt` | AdminDashboard.tsx | letters.ts:37 | OK |
| `letterDate` | AdminDashboard.tsx | letters.ts:37 | OK |
| `sender` | AdminDashboard.tsx | letters.ts:37 | OK |
| `recipient` | AdminDashboard.tsx | letters.ts:37 | OK |
| `workflow` | AdminDashboard.tsx | letters.ts:37 | OK |
| `visibility` | AdminDashboard.tsx | letters.ts:37 | OK |
| `collection` | AdminDashboard.tsx:1172 | letters.ts:37 | OK |

**Frontend locations**:
- `frontend/src/api/letters.ts` - `SortField` type (line 33)
- `frontend/src/pages/admin/AdminDashboard.tsx` - `handleSort()`, table headers, and type cast (line 187)

**Backend location**: `backend/src/routes/admin/letters.ts` - Zod schema line 37, `getSortExpression()` lines 159-175

### Workflow States

| State | Frontend | Backend | Status |
|-------|----------|---------|--------|
| `UPLOADED` | AdminDashboard.tsx | letters.ts:31-32 | OK |
| `TRANSCRIBING` | AdminDashboard.tsx | letters.ts:31-32 | OK |
| `TRANSCRIBED` | AdminDashboard.tsx | letters.ts:31-32 | OK |
| `METADATA_EXTRACTING` | AdminDashboard.tsx | letters.ts:31-32 | OK |
| `METADATA_DRAFTED` | AdminDashboard.tsx | letters.ts:31-32 | OK |
| `REVIEWED` | AdminDashboard.tsx | letters.ts:31-32 | OK |

**Frontend location**: `frontend/src/pages/admin/AdminDashboard.tsx` - `WorkflowState` type
**Backend location**: `backend/src/routes/admin/letters.ts` - Zod enum, `backend/src/db/schema.ts` - DB enum

### Visibility States

| State | Frontend | Backend | Status |
|-------|----------|---------|--------|
| `PUBLISHED` | AdminDashboard.tsx | letters.ts:20 | OK |
| `HIDDEN` | AdminDashboard.tsx | letters.ts:20 | OK |

---

## API Response Types

### Admin Letters Response

Frontend expects (`frontend/src/api/admin.ts`):
```typescript
{
  letters: AdminLetter[];
  pagination: { page, limit, total, totalPages };
  stats: { total, uploaded, transcribed, metadataReady, reviewed, published, hidden };
}
```

Backend returns (`backend/src/routes/admin/letters.ts`):
- Same structure, verified OK

---

## Icon Names

All icon names must exist in `frontend/src/components/common/Icon.tsx`.

Current icons: `upload`, `edit`, `check`, `delete`, `back`, `plus`, `save`, `process`, `arrow-left`, `arrow-right`, `close`, `confirm`, `eye`, `eye-off`, `reset`, `clear`, `select-all`, `folder`, `file`, `logout`

---

## How to Use This Doc

1. **Before adding a new sort field**: Check this doc, add to both frontend and backend
2. **Before adding a new workflow state**: Update DB schema, backend enum, frontend type
3. **When you see a validation error**: Check if the value exists in both frontend and backend

---

## Known Issues

None currently.

---

## Related Docs

- [api-contracts.md](api-contracts.md) - Full API documentation
- [database-schema.md](database-schema.md) - DB enums and schema