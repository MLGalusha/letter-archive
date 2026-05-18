# Admin Redesign Current Work

This file tracks autonomous implementation slices for the admin dashboard redesign. It is intentionally tactical: the roadmap remains the source for phase direction, while this file records the current slice, why it is next, completion criteria, verification, and handoff notes.

## Operating Rules

- Work in small, reviewable commits with plain commit messages.
- Preserve existing backend/API behavior unless the roadmap explicitly calls for backend work.
- Prefer architecture, state ownership, and interaction correctness over visual polish.
- Update roadmap/decision docs when a meaningful checkpoint lands or a decision becomes clear.
- Pause for product-level choices, backend semantic changes, destructive behavior, or visible workflow changes not already covered by the docs.
- Log scoped and out-of-scope ideas in `idea-log.md` instead of acting on them silently.

## Current Phase

Phase 2.75/3 dependency: Selection and Bulk Actions, because responsive table completion depends on a coherent selection model.

## Current Slice

Selection and bulk-action audit.

Why this is next:

- The roadmap identifies selection and bulk actions as a dedicated unresolved interaction system, not checkbox styling.
- Mobile horizontal scrolling and selected-row affordances are coupled.
- The dashboard cannot be considered responsive-table complete while selection behavior is visually and structurally transitional.

Definition of done:

- Current selection behavior is documented across row click, checkbox click, shift selection, drag selection, select page, select all filtered, clear selection, copy/edit mode, and bulk toolbar visibility.
- Current code ownership is mapped across hooks/components.
- Risks and product-level decisions are separated from safe implementation work.
- Next implementation slices are listed with completion criteria.
- No behavior-changing UI implementation occurs before the model is clear.

Verification plan:

- Read selection and bulk-action code paths.
- Run existing focused tests.
- Use Playwright smoke checks on desktop and mobile for current behavior.
- Update roadmap/decisions if the audit clarifies the target model.

## Progress Log

- 2026-05-18: Started autonomous tracking and selection/bulk-action audit.
- 2026-05-18: Read selection state hooks, row gesture handling, filtered select-all behavior, row rendering, bulk toolbar sections, table tests, bulk toolbar tests, and responsive CSS.
- 2026-05-18: Verified current focused tests and targeted ESLint for selection/table/bulk files.
- 2026-05-18: Measured current selected-row and bulk-toolbar behavior in Playwright at 1440x900 and 390x844.
- 2026-05-18: Defined conservative target selection model that preserves current behavior and defers mobile bulk hierarchy decisions.
- 2026-05-18: Added focused hook tests for page selection, filtered selection state, shift-range checkbox selection, drag-select, and drag-deselect behavior.
- 2026-05-18: Tightened the copy/edit-to-row-selection boundary so edit-mode row clicks pass explicit row-selection options instead of a full React mouse event.
- 2026-05-18: Added focused copy/edit hook tests for row-click interception in selection mode and copy mode.
- 2026-05-18: Extracted the row selection checkbox cell so checkbox event isolation is owned by a named component instead of being embedded in the full row renderer.
- 2026-05-18: Added filtered-selection tests for select-all-filtered, pruning invalid selected IDs, and closing edit mode when pruning empties selection.
- 2026-05-18: Removed unused `somePageSelected` from the selection hook return shape.
- 2026-05-18: Added selected-detail tests for single selected letter and loaded-row publishing counts, including the current unloaded selected-ID count limitation.
- 2026-05-18: Added bulk toolbar tests for page selection, all-filtered selection, and active all-filtered clear behavior.
- 2026-05-18: Simplified bulk selection button rendering now that page/all-filtered action behavior is covered.
- 2026-05-18: Increased mobile selected-state table bottom reservation to match the bulk toolbar's mobile height envelope, preventing lower rows from sitting behind the fixed toolbar.
- 2026-05-18: Started saved dashboard views maturity pass with menu tests for default save name, apply, and delete, plus hook tests for persistence, apply, delete, blank-name ignore, and the 12-view cap.
- 2026-05-18: Normalized saved-view names in the menu so whitespace-only input uses the default name and padded names are trimmed before saving.
- 2026-05-18: Started filter manager cleanup with focused filter-panel tests for active count, clear, close, and collection input wiring.
- 2026-05-18: Added active-filter chip tests for count, labels, and removal callbacks, and simplified the active-filter hook inputs to use the existing date-filter summary instead of individual date fields.
- 2026-05-18: Simplified active-filter chip/count construction so the chip list is the single source of truth for the active-filter count.
- 2026-05-18: Tightened the active-filter chip component API so the visual chip list, clear-all control, and tests derive active state from the chip list instead of duplicate count props.
- 2026-05-18: Added toolbar-level coverage for mobile filter open/close, active search chip clearing, and letter-only control visibility when switching to Collections.
- 2026-05-18: Hardened dashboard toolbar, pagination, row flag, and bulk-action buttons with explicit button types so future form or manager-shell placement cannot accidentally submit.

## Selection Audit

### Current Behavior

- Row click opens the letter detail page when not in edit/selection mode.
- Checkbox click stops row navigation and toggles the row through `onCheckboxChange`.
- Shift-clicking a checkbox selects the range between the last clicked row and the current row.
- Drag selection starts from non-input/non-button row content. The drag mode is determined by the starting row: dragging from an unselected row selects the range, while dragging from a selected row deselects the range.
- Selection opens the bulk edit toolbar through `useDashboardCopyPasteEdit` when `selectedIds.size > 0`.
- When selected rows exist, clicking a row in edit mode toggles selection instead of navigating.
- Copy mode reuses the same bulk toolbar and changes sender/recipient cell clicks into copy/paste field edits.
- `Select page` adds all currently loaded rows to the selected set. If the full page is already selected, the same control clears selection.
- `Select all filtered` fetches all filtered IDs from the backend and marks the selection as filtered-global.
- Changing filters/sort refetches page 1 and prunes selected IDs against the filtered ID list. If pruning removes everything, the edit toolbar closes.
- Bulk publish/hide and content visibility actions mutate selected IDs but do not automatically clear selection afterward.
- Destructive clear/delete actions and saved copy edits exit edit mode after success.

### Current Code Ownership

- `useDashboardSelection` owns selected IDs, all-filtered state, page selection, clear selection, and select-all-filtered state assignment.
- `useDashboardRowSelection` owns checkbox range selection, drag selection, last clicked index, and drag suppression for row navigation.
- `useDashboardFilteredSelection` owns filter/sort-change refetching, selected-ID pruning, and fetching all filtered IDs.
- `useDashboardCopyPasteEdit` owns whether the bulk toolbar/edit mode is visible, copy mode, pending copy/paste changes, save, and edit-mode row-click interception.
- `RecentActivityRow` renders row selected state, checkbox behavior, and row mouse/click gesture wiring.
- `BulkEditToolbar` renders the bulk action region and groups Selection, Edit, Process, Publish, Danger, and completion controls.
- `BulkPublishingMenu` already uses the shared manager shell; other bulk toolbar groups are inline controls.

### Current Responsive Findings

- Desktop selected row and toolbar are structurally stable. At 1440x900, the fixed toolbar measured about 72px tall, and table bottom padding reserves space for it.
- Mobile selected row uses the same horizontally scrollable table model. The checkbox column is static and scrolls with the table, matching the accepted decision to avoid a detached sticky selection rail in this pass.
- At 390x844, the bulk toolbar measured about 206px tall after selecting one row. It preserves access to actions but consumes a large part of the viewport.
- The mobile right-side bulk action row can overflow horizontally, especially with Publish and Danger controls together.
- The selected row uses continuous row background across cells, with a left inset accent on the checkbox cell.

### Risks

- Selection and copy-edit mode are tightly coupled: changing toolbar visibility or row click behavior can break copy/paste edits.
- `Select page` doubling as "clear selection" when the page is fully selected may be efficient but is semantically overloaded.
- Bulk action visibility on mobile is dense. Making it compact will likely require choosing which actions are primary versus secondary.
- Filter/sort pruning depends on backend ID fetches and closes edit mode when the selection becomes empty; tests should cover this before deeper refactors.

### Safe Next Implementation Slices

1. Add focused tests around `useDashboardSelection` and `useDashboardRowSelection` behavior before UI changes.
2. Clarify selection model naming and return shape so page selection, filtered selection, and row gestures are easier to reason about.
3. Group table selection props into clearer row-selection and page-selection models if it reduces prop ambiguity without changing behavior.
4. Improve mobile bulk toolbar structure only after the target hierarchy is documented.

### Product-Level Choices To Avoid Making Silently

- Whether mobile bulk actions should show every action inline or collapse secondary actions into managers.
- Whether `Select page` should continue clearing all selection when the page is already selected.
- Whether row click in selection mode should toggle selection, open detail, or require explicit checkbox use.
- Whether bulk publish/hide should keep selection after success or exit edit mode like destructive actions.

## Target Selection Model

This target model is conservative. It preserves current behavior while making the system easier to verify and evolve.

### Invariants

- Row navigation remains the default when no selection/edit mode is active.
- Checkbox selection never opens a row.
- In selection/edit mode, row clicks continue to toggle selection instead of navigating.
- Shift checkbox selection continues to select a contiguous range from the last clicked row.
- Drag selection continues to select or deselect ranges based on the starting row state.
- Select-all-page and select-all-filtered remain distinct states.
- Filter/sort changes continue to prune selected IDs against backend-filtered IDs.
- Copy mode continues to use the selected/edit toolbar and sender/recipient cell interactions.
- Mobile keeps the checkbox column inside the horizontal table flow for this pass.

### Ownership Direction

- `useDashboardSelection` should own page/filter selection state and expose names that make page versus filtered selection explicit.
- `useDashboardRowSelection` should own row-level gestures only: checkbox range selection, drag selection, and row-click suppression after drag.
- `useDashboardCopyPasteEdit` should own edit toolbar visibility and copy/paste state, not page-selection semantics.
- Table components should receive a table selection model with clearly named row gesture callbacks.
- Bulk toolbar components should receive a bulk selection model with clearly named page/filter actions.

### Good-Enough Completion Criteria For This Phase

- Current selection behavior has focused tests before behavior-preserving refactors.
- Selection and row gesture props read as intentional models, not generic callback bags.
- Mobile and desktop browser checks show no selected-row/table regression.
- Any mobile bulk toolbar hierarchy change is deferred unless explicitly approved.
