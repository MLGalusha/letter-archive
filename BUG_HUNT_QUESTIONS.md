# Bug Hunt - Questions Needing User Input

Items discovered during bug hunting that need clarification or decisions.

---

## 1. Public Letters Route - Unbounded Query (Performance)
**File:** `backend/src/routes/letters.ts:82-91`
**Issue:** The GET /letters endpoint loads ALL letters into memory before grouping and paginating in JS. For large collections this is a performance problem.
**Why it needs input:** Fixing this requires rewriting the query to use SQL-level DISTINCT ON + pagination (like the admin route in letter-queries.ts already does). This is a significant refactor of the public API's grouping/workflow-filter logic. Want me to proceed with this, or is the current dataset small enough that it's not urgent?

## 2. Default OpenAI Model - `gpt-5.4`
**File:** `backend/src/config/env.ts:9`
**Issue:** Default is `gpt-5.4`. Is this the correct model you're using? If the env var isn't set, all AI calls would use this default.
**Action needed:** Confirm this is the intended default model, or tell me what it should be.

## 3. Admin Routes - No Authentication Middleware
**File:** `backend/src/routes/admin/index.ts`
**Issue:** No auth middleware protects admin routes. Anyone can access `/admin/*` endpoints.
**Why it needs input:** Is auth handled elsewhere (e.g., reverse proxy, separate middleware not visible in these files)? Or is this a known TODO? If you want me to add auth middleware, what auth mechanism do you use?

## 4. Database Connection Pool Not Configured
**File:** `backend/src/db/index.ts`
**Issue:** The postgres client uses default pool settings (no max connections, idle timeout, etc.). Under load this could exhaust connections.
**Why it needs input:** Do you want me to add pool configuration? What's your expected concurrent load?

## 5. Missing Graceful Shutdown Handlers
**File:** `backend/src/index.ts`
**Issue:** No SIGTERM/SIGINT handlers to close the database connection pool on server shutdown. Could leak connections.
**Why it needs input:** Want me to add shutdown handlers?

## 6. Duplicate Migration Prefixes
**Files:** `0001_aberrant_ender_wiggin.sql` and `0001_add_gin_indexes_and_triggers.sql` (also `0008_last_lake.sql` and `0008_add_biography_fields.sql`)
**Issue:** Duplicate migration number prefixes could cause non-deterministic ordering.
**Why it needs input:** Are these managed by Drizzle Kit? If so, renaming could break the migration history. Need to understand your migration workflow.

## 7. Person Relationships Table - Missing CHECK Constraint
**File:** `backend/src/db/schema.ts:419-453`
**Issue:** The schema comment says "Always store with personAId < personBId" but no DB constraint enforces this. Duplicate bidirectional relationships could be created.
**Why it needs input:** Adding a CHECK constraint requires a migration. Want me to create one?

## 8. Fire-and-Forget Promises in Processing Queue
**Files:** `backend/src/services/processing-queue.ts:567,616,662` and `backend/src/services/letter-operations.ts:305,404`
**Issue:** `processLettersAsync()` is called without `await` - intentionally runs in the background. But if it throws an unhandled rejection, the process could crash.
**Why it needs input:** This appears intentional for background processing. Should I add `.catch()` handlers to prevent unhandled rejections, or is there a global handler in place?

