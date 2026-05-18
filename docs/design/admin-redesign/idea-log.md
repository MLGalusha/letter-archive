# Admin Redesign Idea Log

This log captures ideas that come up during implementation. Entries may be in-scope, adjacent, or explicitly out-of-scope. Logging an idea does not mean it was implemented.

Each entry should include:

- Idea
- Why it is relevant
- What triggered it
- Scope recommendation

## Ideas

### Frontend Full-Suite Timing Failures Need Reliability Cleanup

Idea:

- Track the two observed Vitest timeout failures as test reliability debt instead of treating them as dashboard filter regressions.

Why it is relevant:

- The full frontend suite timed out under load in `HomePage.test.tsx` and `AdminDashboardPage.test.tsx`, but each failing file passed when rerun individually immediately afterward.
- That pattern points to test timing, async waiting, or full-suite resource contention rather than the new dashboard filter query contract.

What triggered it:

- After adding server-backed cleanup/content-type filters and ranked sort, the focused backend tests, backend typecheck, full backend tests, focused dashboard tests, frontend build, and individual reruns all passed.
- Only the full frontend suite showed two timeout failures:
  - `src/pages/__tests__/HomePage.test.tsx > appends later archive pages from the load-more control`
  - `src/pages/admin/__tests__/AdminDashboardPage.test.tsx > opens the sender and recipient modal when exactly one letter is selected`

Scope recommendation:

- Handle in a focused test-reliability pass, not inside the filter UI slice.
- Prefer making the tests wait for explicit UI/data conditions and reducing shared timing assumptions over raising global timeouts.
- Re-run the full frontend suite after the reliability cleanup to confirm the failures are gone under suite load.

### Mobile Bulk Actions As Primary Row Plus Action Managers

Idea:

- On mobile, treat bulk actions as a compact selection mode surface with a persistent primary row for count, page/all selection, and close/save, plus secondary action groups opened through manager buttons such as Edit, Process, Publish, and Danger.

Why it is relevant:

- The current mobile bulk toolbar stacks to roughly a quarter of the viewport after selecting a single row and still allows horizontal overflow in the right-side action group.
- Selection is a mode, and mobile users need the selected count and exit/save controls more than they need every destructive or processing action visible at once.

What triggered it:

- Playwright measurement at 390x844 showed `.edit-toolbar-content` around 206px tall, with the Publish/Danger row extending beyond the viewport width.
- The dashboard manager shell work already created a usable pattern for high-touch grouped actions such as Publishing.

Scope recommendation:

- In scope for the selection/bulk redesign if we decide mobile should prioritize a compact mode bar.
- Do not implement automatically until the selection model is documented, because it changes visible workflow hierarchy.

### Publish Counts Need A Clear Scope For Select-All-Filtered

Idea:

- Make bulk publishing counts explicitly correct for the selected scope. If all filtered rows are selected across pages, either fetch aggregate counts for all selected IDs or label the current counts as page-loaded counts.

Why it is relevant:

- Bulk publish/hide actions operate on `selectedIds`, including IDs returned by select-all-filtered.
- The current `useDashboardSelectionDetails` publish counts are derived from `filteredLetters`, which is the loaded page data, so counts can underrepresent the selected set when selection spans unloaded pages.

What triggered it:

- During selection audit, `selectAllFiltered` was confirmed to fetch all filtered IDs, while `publishCounts` filters only the current `filteredLetters` array.

Scope recommendation:

- Treat as a correctness follow-up in the selection/bulk phase.
- Do not silently change UI copy or backend queries without deciding whether counts should be exact across all selected IDs or explicitly scoped to loaded rows.

### Saved Views Need Current/Dirty State Before Update-In-Place

Idea:

- Track which saved dashboard view is currently applied and whether the current dashboard state has drifted from that saved state. That would enable clear actions such as "Update view" or "Save as new" without guessing.

Why it is relevant:

- Saved views already preserve filters, sort, visible columns, and column order. As the dashboard view model matures, users will expect to know whether they are looking at a named saved view or an edited variant.

What triggered it:

- Hook-level saved-view tests made the current lifecycle explicit: create, apply, delete, and cap at 12. There is no identity or dirty-state tracking after apply.

Scope recommendation:

- Good candidate for the saved views maturity pass.
- Do not implement automatically until the desired user-facing behavior is decided, especially whether updating an existing saved view should be allowed or whether the system should stay save-as-new only.

### Saved View Persistence Needs A Versioned Shape

Idea:

- Split the latest in-memory `DashboardViewState` type from the looser persisted saved-view shape that can be missing fields added by later dashboard releases.
- Add a small normalizer/migration function that turns persisted saved-view state into the current dashboard view state before applying it.

Why it is relevant:

- The runtime already backfills missing `extraContentStatusFilters`, `workflowFilters`, `flaggedFilter`, and `columnOrder` when applying old saved views.
- The TypeScript type currently says saved-view state always has the newest fields, which makes tests and future migrations more awkward than the runtime behavior really is.

What triggered it:

- While adding saved-view integration tests, I had to cast a legacy saved-view state with missing newer fields even though that legacy case is intentionally supported by `useDashboardSavedViewState`.

Scope recommendation:

- Good code-quality follow-up if saved views keep growing.
- Do not expand it into backend/API saved views yet; this is only about making local persisted state migration explicit and typed.

### Missing Collection Filter Needs A Real Data State

Idea:

- If admins need a "missing collection" cleanup workflow later, model it as an explicit import/triage state instead of pretending nullable collection data exists on letters.

Why it is relevant:

- Phase 2.5 added missing sender, missing recipient, and missing date filters. Missing collection was part of the candidate list, but `letters.collection_id` is required and every letter belongs to a collection today.

What triggered it:

- While adding backend cleanup filters, the schema showed `collection_id` is `notNull()`, so a dashboard filter named "Missing collection" would either never return rows or would have to mean something else.

Scope recommendation:

- Defer until upload/import workflows define an uncategorized or needs-collection-review state.
- Do not add a dashboard filter until that state has clear backend semantics and real rows can enter it.
