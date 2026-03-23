# Codebase Refactoring Plan

This document contains all refactoring targets for the Letter Archive project. Each section describes the problem, affected files, and the expected outcome. All refactoring is non-UI — no visual changes, no new features. The goal is to split monoliths, extract reusable patterns, standardize conventions, and make the codebase easier to extend.

**Important constraints:**
- Do NOT change any UI behavior or visual output
- Do NOT add new features
- Do NOT modify database schema
- Do NOT touch migration files
- All existing tests must continue to pass after refactoring
- `.js` extensions are required in all backend imports (ESM with NodeNext resolution)
- Backend logging uses Pino: `log.info({ key }, 'message')` — object first, string second
- Run `npm test` in both `backend/` and `frontend/` after changes to verify nothing breaks

---

## Backend Refactoring

### 1. Split `letter-operations.ts` (1,741 lines → ~6 files)

**File:** `backend/src/services/letter-operations.ts`

**Problem:** Monolithic service with 28+ exported functions covering bulk operations, verification, versions, regeneration, linked entities, and AI notes. Too large to reason about or extend.

**Target structure:**
```
backend/src/services/letter/
  index.ts              — Re-exports everything for backward compatibility
  bulk-operations.ts    — bulkTranscribe, bulkExtractMetadata, bulkClearTranscriptions, bulkClearMetadata, bulkUpdateFields
  verification.ts       — verifyTranscript, unverifyTranscript, verifyMetadata, unverifyMetadata, verifyExtraContent, unverifyExtraContent
  versions.ts           — getVersions, createVersion, restoreVersion
  regeneration.ts       — regenerateTranscription, transcribeLetterOnly, transcribeExtras, updateExtraContent
  linked-entities.ts    — addLinkedPerson, removeLinkedPerson, updateLinkedPerson, addLinkedPlace, removeLinkedPlace, updateLinkedPlace
  ai-notes.ts           — updateAiNotes
```

**Keep in the original file (or a shared module):** Helper functions used across multiple sub-modules like `normalizeRelationshipType()`, `getDocumentTypeFromCode()`, and any shared imports/types.

**The `index.ts` barrel file must re-export everything** so that existing imports like `import { verifyTranscript } from '../services/letter-operations.js'` continue to work. You can either:
- Keep `letter-operations.ts` as a barrel that imports from the `letter/` directory
- Or update all import paths across the codebase

Either approach is fine, but all existing imports must resolve.

---

### 2. Split `admin/letters.ts` (1,666 lines → ~6 files)

**File:** `backend/src/routes/admin/letters.ts`

**Problem:** 40+ route handlers in a single file covering listing, processing queue, bulk operations, single letter CRUD, extra content, linked entities, and verification.

**Target structure:**
```
backend/src/routes/admin/letters/
  index.ts          — Main router that mounts sub-routers
  list.ts           — GET /letters, letter detail, letter stats
  processing.ts     — All /processing/* endpoints (pause, resume, cancel, status, queue)
  bulk.ts           — All /letters/bulk/* endpoints
  content.ts        — Transcript, metadata, extra content update endpoints
  entities.ts       — Linked person/place CRUD endpoints
  verification.ts   — Verify/unverify transcript, metadata, extra content
```

**The `index.ts` must export a single router** that mounts all sub-routers, so the parent `admin/index.ts` can continue to do `router.use('/letters', lettersRouter)` without changes.

**Pattern for sub-routers:**
```typescript
// In list.ts
import { Router } from 'express';
const router = Router();
router.get('/', async (req, res, next) => { /* ... */ });
export default router;

// In index.ts
import listRouter from './list.js';
import processingRouter from './processing.js';
const router = Router();
router.use('/', listRouter);
router.use('/processing', processingRouter);
export default router;
```

---

### 3. Split `prompts.ts` (1,415 lines → ~8 files)

**File:** `backend/src/ai/prompts.ts`

**Problem:** All AI system prompts and prompt builders in one file. Pure text — easy to split.

**Target structure:**
```
backend/src/ai/prompts/
  index.ts              — Re-exports everything
  transcription.ts      — TRANSCRIPTION_SYSTEM_PROMPT, buildTranscriptionPrompt
  metadata.ts           — METADATA_SYSTEM_PROMPT, buildMetadataPrompt
  metadata-v2.ts        — METADATA_V2_SYSTEM_PROMPT, buildMetadataV2Prompt
  entities.ts           — ENTITY_EXTRACTION_SYSTEM_PROMPT, buildEntityExtractionPrompt
  biography.ts          — BIOGRAPHY_SYSTEM_PROMPT, buildBiographyPrompt
  collection.ts         — COLLECTION_ANALYSIS_SYSTEM_PROMPT
  metadata-update.ts    — METADATA_UPDATE_SYSTEM_PROMPT, buildMetadataUpdatePrompt
  entity-resolution.ts  — ENTITY_RESOLUTION_SYSTEM_PROMPT (if exists)
```

**The `index.ts` must re-export all** so existing imports from `'../ai/prompts.js'` continue to work.

---

### 4. Replace `console.log` with Pino logger

**File:** `backend/src/pipeline/processor.ts`

**Problem:** 3 `console.log` calls instead of Pino logger. Inconsistent with rest of codebase.

**Fix:**
```typescript
import { createLogger } from '../utils/logger.js';
const log = createLogger({ module: 'processor' });

// Replace:
//   console.log('Skipping processing for non-letter type: ...')
// With:
//   log.debug({ letterType: letter.type }, 'Skipping non-letter type');

// Replace:
//   console.log('Processing letter ...')
// With:
//   log.info({ letterId, workflow: letter.workflow }, 'Processing letter');
```

---

### 5. Fix hardcoded `'admin'` user strings

**File:** `backend/src/services/letter-operations.ts` (lines ~666, ~912, ~957, ~1460)

**Problem:** 4 places hardcode `'admin'` instead of using the actual authenticated user. Each has a TODO comment.

**Fix:** Each of these functions should accept an optional `userId` parameter (string) that defaults to `'admin'`. Update the call sites in routes to pass `req.user!.userId` (the auth middleware sets `req.user`).

Example:
```typescript
// Before:
export async function verifyTranscript(letterId: string) {
  // ...
  transcriptVerifiedBy: 'admin', // TODO: Use actual user when auth is implemented
}

// After:
export async function verifyTranscript(letterId: string, userId: string = 'admin') {
  // ...
  transcriptVerifiedBy: userId,
}
```

Then in the route handler:
```typescript
const result = await verifyTranscript(letterId, req.user!.userId);
```

Search for all 4 TODO comments containing "Use actual user when auth is implemented" and fix each one.

---

### 6. Extract constants from magic numbers

**Create:** `backend/src/constants/` directory with:

**`backend/src/constants/pagination.ts`:**
```typescript
export const PAGINATION = {
  MAX_LIMIT: 100,
  DEFAULT_LIMIT: 50,
  QUEUE_BATCH_SIZE: 50,
  ENTITY_PAGE_SIZE: 20,
};
```

**`backend/src/constants/timing.ts`:**
```typescript
export const TIMING = {
  RECENT_CUTOFF_MS: 48 * 60 * 60 * 1000,  // 48 hours
  JOB_RECOVERY_WINDOW_MS: 60 * 60 * 1000,  // 1 hour
};
```

Then replace the hardcoded values in:
- `services/letter-queries.ts` (limit defaults)
- `services/processing-queue.ts` (limit values, recovery window)
- `services/entities/persons.ts` (page size)
- `services/letter-operations.ts` (recent cutoff)

---

### 7. Standardize error handling in routes

**Problem:** Some routes use `next(error)`, others use `res.status(400).json()`. Should be consistent.

**Create:** `backend/src/utils/response-helpers.ts`
```typescript
export class AppError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(404, message);
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad request') {
    super(400, message);
  }
}
```

Then ensure the existing error-handling middleware in `index.ts` catches `AppError` and formats consistently. Update routes to throw these instead of manually writing `res.status().json()`.

**Don't change every route at once** — focus on the routes being split (admin/letters) during the split process.

---

## Frontend Refactoring

### 8. Create `useAsync()` hook (eliminates duplication in 24+ files)

**Create:** `frontend/src/hooks/useAsync.ts`

```typescript
import { useState, useEffect, useCallback } from 'react';

interface UseAsyncResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useAsync<T>(
  fn: () => Promise<T>,
  deps: React.DependencyList = []
): UseAsyncResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fn();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, deps);

  useEffect(() => {
    execute();
  }, [execute]);

  return { data, loading, error, refetch: execute };
}
```

**Do NOT migrate all 24 files.** Just create the hook and migrate 2-3 simple pages as proof of concept (e.g., `AboutPage.tsx`, `CollectionsPage.tsx`). The rest can be migrated incrementally.

---

### 9. Create `useTooltip()` hook (eliminates duplication in 5+ files)

**Create:** `frontend/src/hooks/useTooltip.ts`

```typescript
import { useState, useEffect, useRef, useCallback } from 'react';

interface UseTooltipResult {
  show: boolean;
  position: { x: number; y: number };
  ref: React.RefObject<HTMLDivElement>;
  showAt: (x: number, y: number) => void;
  close: () => void;
}

export function useTooltip(autoDismissMs = 3000): UseTooltipResult {
  const [show, setShow] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const ref = useRef<HTMLDivElement>(null);

  const showAt = useCallback((x: number, y: number) => {
    setPosition({ x, y });
    setShow(true);
  }, []);

  const close = useCallback(() => setShow(false), []);

  useEffect(() => {
    if (!show) return;
    const timer = setTimeout(close, autoDismissMs);
    return () => clearTimeout(timer);
  }, [show, autoDismissMs, close]);

  useEffect(() => {
    if (!show) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        close();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [show, close]);

  return { show, position, ref, showAt, close };
}
```

**Migrate:** Replace the 3 tooltip state patterns in `LetterReviewPage.tsx` with this hook.

---

### 10. Extract `LineReviewMode` utilities

**File:** `frontend/src/components/LineReviewMode/LineReviewMode.tsx` (1,499 lines)

**Problem:** Utility functions defined inside the component that should be standalone.

**Create:** `frontend/src/components/LineReviewMode/lineReviewUtils.ts`

Extract these functions (they are pure functions, no React dependencies):
- `splitTranscriptByPage`
- `reconstructTranscript`
- `computeLineInputHeight`
- `measureRenderedTextWidth`
- `normalizeReviewLineText`
- `mergeEditedTextWithOriginalSpacing`

Then import them back into `LineReviewMode.tsx`. This makes them independently testable.

---

### 11. Extract `AdminDashboard` hooks

**File:** `frontend/src/pages/admin/AdminDashboard.tsx` (1,759 lines)

**Problem:** 40+ state variables for filters, sorting, column visibility, and selection all in one component.

**Create these hooks in `frontend/src/pages/admin/AdminDashboard/`:**

**`useDashboardFilters.ts`:**
Encapsulate: searchQuery, visibilityFilter, transcriptStatusFilters, metadataStatusFilters, collectionFilter, yearFilter, monthFilter, dayFilter, dateFromFilter, dateToFilter, and all their setters. Include the filter reset function.

**`useDashboardSort.ts`:**
Encapsulate: sortColumns state, the addSort/removeSort/toggleSort logic.

**`useDashboardColumns.ts`:**
Encapsulate: column visibility state, localStorage persistence, the known/visible column sets logic. This is already partially extracted to `dashboard-utils.ts` — move the remaining state management here.

**`useDashboardSelection.ts`:**
Encapsulate: selectedLetters set, selectAll/deselectAll/toggleSelection, bulk operation handlers.

**Then refactor `AdminDashboard.tsx`** to import and compose these hooks. The component should primarily be a layout/rendering component that delegates state to hooks.

---

### 12. Extract `LetterReviewPage` hooks

**File:** `frontend/src/pages/admin/LetterReviewPage.tsx` (1,688 lines)

**Create these hooks in `frontend/src/pages/admin/LetterReview/`:**

**`useTranscriptEditing.ts`:**
Encapsulate: isTranscriptEditing, originalTranscriptText, hasTranscriptChanges, transcript tooltip state, and the start/save/cancel editing functions.

**`useMetadataEditing.ts`:**
Encapsulate: All metadata field states (sender, recipient, date, etc.), the dirty tracking, and metadata save/cancel logic.

**`useAutoSave.ts`:**
Encapsulate: The debounce timer, auto-save trigger, and the timeout/cleanup logic.

**`useTranscriptFontSize.ts`:**
Encapsulate: Font size calculation with ResizeObserver.

**After extracting hooks, consider creating a `LetterReviewContext`** to replace the 43-prop interface on `MetadataSection`. The context would provide letter data and update functions, so subsections can consume what they need without prop drilling.

---

## Verification

After all refactoring:

1. Run `cd backend && npm test` — all tests must pass
2. Run `cd frontend && npm test` — all tests must pass
3. Run `cd backend && npm run typecheck` — no type errors
4. Manually verify the app works: `npm run dev` in backend, `npm run dev` in frontend, navigate key pages

No behavioral changes should be observable. This is purely structural.
