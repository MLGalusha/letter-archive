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

Phase 2.75: dashboard selection and bulk-action redesign.

## Current Slice

Docs checkpoint and first-principles UX framing before implementation.

Why this is next:

- The dashboard filter/sort model is now mature enough that selection and bulk actions can be redesigned against stable table state.
- Current selection behavior works, but it reads as a patched-on system, especially on mobile where selected state, horizontal scrolling, and bulk action placement compete for attention.
- The next pass should not start by styling checkboxes. It should define the selection goals, action hierarchy, and device-specific interaction model first.

Definition of done for this docs checkpoint:

- Roadmap, current-work, dashboard-design, and decisions docs reflect that Phase 2.75 is the next active design/implementation phase.
- Stale mobile-selection guidance is corrected: the current sticky checkbox column is a tactical fix, not a final product decision.
- The docs explicitly allow desktop and mobile selection/bulk-action UX to diverge when that better serves the workflow.
- Product-level choices that should be discussed before implementation are listed clearly.

Working assumptions for the next implementation pass:

- Preserve existing backend semantics and bulk mutation behavior unless a specific decision changes them.
- Keep code quality ahead of visual polish: state ownership, prop contracts, tests, and accessibility should come before final styling.
- Treat selection as a modeful interaction system: row opening, selecting, range selecting, dragging, editing, processing, publishing, and destructive actions all need to fit together.
- Avoid promoting any selector or bulk-action pattern to shared admin UI until it works well on both desktop and mobile.

Verification plan for the eventual implementation pass:

- Add or preserve focused tests around row selection, range selection, drag selection, select-all-page, select-all-filtered, pruning, edit mode, and bulk toolbar completion paths.
- Use browser checks at desktop and narrow mobile sizes with selected rows, horizontal table scroll, and the bulk action surface visible.
- Confirm keyboard focus and accessible names for selection controls and bulk action controls.
- Update docs at each meaningful checkpoint before committing.

## Phase 2.75 Implementation Plan

### Core Workflow Goal

Selection and bulk actions should behave like a designed admin workflow, not like table checkboxes plus a fixed button pile. At every point the admin should understand what is selected, what scope an action will affect, how to add/remove/clear selection, which actions are routine versus risky, and how to return to normal browsing.

### Desktop Success Criteria

- Normal row click opens the letter when not in selection/edit mode.
- Row checkboxes are visible, keyboard reachable, and have clear focus and checked states.
- Selected rows read as continuous selected objects across all visible cells.
- Shift-select and drag-select remain available for cleanup-heavy desktop workflows.
- Selection scope controls are distinct from mutation actions.
- Bulk actions are grouped by intent: scope, edit/copy, process, publish/visibility, and danger.
- Dangerous actions are visually separated and continue to use confirmation flows.

### Mobile Success Criteria

- Selecting a row creates an obvious mobile selection mode.
- The selected count, selected scope, and clear/exit action are always obvious.
- The selector does not feel like an accidental overlay on top of horizontally scrolling table content.
- Primary actions stay reachable without a fixed toolbar consuming a large share of the viewport.
- Secondary actions can move into manager sheets or grouped menus instead of full inline parity with desktop.
- Row opening remains clear outside selection mode.

### Target UX Direction

- Desktop keeps direct table selection: checkbox click selects, row click opens unless selection/edit mode is active, shift-select and drag-select stay available.
- Mobile should move toward explicit selection mode. Once selection exists, row taps should toggle selection by default; opening detail should require exiting selection or using a deliberate row affordance.
- The current mobile sticky checkbox lane can remain as a tactical control lane only if it is styled as a deliberate frozen selection rail with row-state continuity. If it continues to feel detached, prefer a non-sticky selector or explicit selection-mode control.
- Desktop can keep a selected-state action bar, but the bar should be calmer and grouped by action intent.
- Mobile should use a compact selected-state mode bar for count, scope, and exit/save, with grouped manager surfaces for secondary action families.

### First Code Slices

1. Add or tighten tests around existing row and toolbar behavior so the redesign has a regression boundary.
2. Refactor naming and prop contracts where needed: table selection, row gestures, selection scope, edit/copy, processing, publishing, danger, and completion should stay separate.
3. Improve desktop selected-row and bulk-toolbar hierarchy without changing backend semantics.
4. Implement the mobile selected-state mode bar and grouped action surfaces.
5. Run accessibility and browser verification before promoting any reusable pattern.

### Current Audit Notes

- `useDashboardSelection` owns selected IDs, page selection, all-filtered state, and clear/select operations.
- `useDashboardRowSelection` owns checkbox shift selection and drag selection. It still operates as a desktop-style pointer interaction and should not drive the whole mobile model by default.
- `useDashboardCopyPasteEdit` opens edit mode when there is selection and currently makes row clicks toggle selection when selected IDs or pending edits exist.
- `RecentActivityTable` already receives grouped table models, which is a good base. Selection still mixes row navigation, checkbox selection, pointer drag, and edit-mode behavior in one model.
- `BulkEditToolbar` already has grouped prop models and section components. The main remaining problem is hierarchy and responsive presentation, not basic ownership.
- `BulkSelectionControls` currently makes `Page` both a select-page and clear-selection toggle when the page is fully selected. That behavior is efficient but ambiguous and should be reconsidered before UI polish.
- Publish counts are loaded-row counts when all-filtered selection spans unloaded pages. The UI should either label that limitation or fetch exact counts before presenting scoped publishing details.

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
- 2026-05-18: Extracted the dashboard sort option/label/default-direction model from the Sort manager component and covered the pure model with focused tests.
- 2026-05-18: Added saved-view integration coverage for capturing/restoring filters, sorting, visible columns, column order, and legacy saved-view fallbacks through the dashboard state hook.
- 2026-05-18: Browser smoke testing caught and fixed stale visible Sort manager direction text so it now matches the field-aware direction label used by the accessible toggle name.
- 2026-05-18: Added backend query contract support for cleanup filters (`missing=sender,recipient,date`), content-type filters (`contentShape=extras,photos,cover,telegram,card,ephemera,article,diary,voice`), matching stats buckets, and ordered `sortRules`.
- 2026-05-18: Added backend query tests for cleanup filtering, content-type filtering, workflow enum casting, extra-content status scoping, and ranked sort SQL before pagination.
- 2026-05-18: Wired cleanup/content-type filters through dashboard state, query adapter, active chips, saved views, persisted state, filter panel sections, and select-all-filtered dependency tracking.
- 2026-05-18: Moved letter-page, aggregate extra-item, and per-content-type sorts to the server-backed Sort manager path and removed current-page secondary sort behavior for current Sort manager fields.
- 2026-05-18: Updated Phase 2.5 docs to mark cleanup/content-type filters and ranked sort complete, with missing collection and entity/historical filters deferred.
- 2026-05-18: Centralized dashboard content-type filter/sort labels in a frontend catalog and expanded the backend contract to all stored letter content types instead of a partial photos/covers/telegrams subset.
- 2026-05-18: Reframed Phase 2.75 docs around first-principles selection and bulk-action goals, with desktop and mobile allowed to diverge.
- 2026-05-18: Added regression tests for keyboard-reachable row checkboxes and the current active page-selection toggle behavior.
- 2026-05-18: Added a mobile-specific selected-state bulk surface with count/scope/exit, compact scope controls, and grouped action entry points instead of the dense desktop toolbar.
- 2026-05-18: Moved destructive bulk actions behind a Danger manager on desktop, reducing toolbar overflow and making dangerous actions a deliberate secondary surface.
- 2026-05-18: Browser-verified selected-state toolbar behavior at 1440x900 and 390x844. Mobile selected toolbar measured about 137px tall, down from the earlier 206px dense toolbar measurement.
- 2026-05-18: Fixed desktop Publish/Danger manager positioning so toolbar popovers are anchored to the viewport above the fixed toolbar instead of being clipped by the toolbar scroller. Tightened mobile selected-state bottom reservation to match the actual compact toolbar height.

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
- Mobile selection recently moved to a real sticky checkbox column with its own background and border so horizontally scrolled data columns do not slide behind the checkbox lane.
- The sticky checkbox column is a tactical stability fix, not the final Phase 2.75 UX answer. The redesign should decide whether mobile needs a deliberate frozen selection rail, an explicit selection mode, or a different row-level control pattern.
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
- Whether mobile should optimize for always-visible selection controls, maximum table readability, or a distinct selection mode that changes row behavior.
- Whether desktop should keep power-user range/drag selection while mobile uses a simpler tap-oriented model.
- Whether copy/paste edit mode belongs in the same visible bulk-action surface as processing, publishing, and destructive actions.

## Target Selection Model

This older target model is intentionally conservative and behavior-preserving. It remains useful as a regression boundary, but Phase 2.75 may replace parts of it after the first-principles UX discussion.

### Invariants

- Row navigation remains the default when no selection/edit mode is active.
- Checkbox selection never opens a row.
- In selection/edit mode, row clicks continue to toggle selection instead of navigating.
- Shift checkbox selection continues to select a contiguous range from the last clicked row.
- Drag selection continues to select or deselect ranges based on the starting row state.
- Select-all-page and select-all-filtered remain distinct states.
- Filter/sort changes continue to prune selected IDs against backend-filtered IDs.
- Copy mode continues to use the selected/edit toolbar and sender/recipient cell interactions.
- Mobile selection must feel structurally connected to the selected row. The final design may use a deliberate sticky rail, a scrolling column, or an explicit selection mode, but it should not feel like an accidental overlay on top of table content.

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
- Mobile bulk toolbar hierarchy changes should follow an approved device-specific interaction model instead of trying to fit all desktop actions into one small fixed bar.

## Current Implementation Checkpoint

What changed in this checkpoint:

- Desktop keeps the existing selected-state action bar, but destructive actions now open from a Danger manager instead of rendering three destructive buttons inline.
- Mobile now renders a dedicated selected-state surface: selected count, scope text, clear/save, page/all-filtered scope actions, and compact entry points for Edit, Process, Publishing, and Danger.
- Process and Danger actions use mobile manager sheets. Publishing already used the shared manager surface and remains available from the compact action row.
- Existing row selection, shift selection, drag selection, edit mode, select-all-filtered, and bulk mutation semantics were preserved.

Verification:

- Focused selection suite passed: `dashboard-selection-hooks`, `dashboard-filtered-selection`, `dashboard-copy-paste-edit`, `dashboard-selection-details`, `BulkEditToolbar`, and `DashboardSections`.
- Frontend production build passed.
- Browser checks covered desktop and mobile selected rows, mobile Process sheet opening, desktop toolbar fit, and mobile sticky checkbox lane with the new compact toolbar.

Known follow-ups:

- The selected scope model still needs a clearer final decision for `Select page` toggling into clear-selection behavior.
- Publish counts remain loaded-row counts when all-filtered selection includes unloaded rows.
- Mobile row taps in selection mode still rely on the existing edit-mode row-click behavior; a deeper mobile selection-mode pass should make that interaction explicit.

## First-Principles UX Questions For Phase 2.75

### Selection Goals

- Make it obvious which rows are selected and how many selected items an action will affect.
- Keep ordinary row opening fast when the user is browsing.
- Make selection entry and exit deliberate enough that destructive bulk actions are not reached accidentally.
- Preserve efficient desktop workflows for admins doing lots of cleanup work.
- Make mobile selection usable with one thumb, narrow width, and horizontal table scrolling.

### Bulk Action Goals

- Separate selection scope controls from mutation actions.
- Separate routine actions from processing actions and dangerous actions.
- Make selected-page versus selected-filtered scope explicit before a large operation.
- Keep the highest-frequency actions reachable without forcing every action to be visible at once.
- Avoid using one dense toolbar as the only answer for desktop and mobile.

### Device Direction To Explore

- Desktop can support direct checkboxes, keyboard focus, shift selection, drag selection, and a wider action bar because the table has enough space and pointer precision.
- Mobile may need a different interaction model: a selection mode, a deliberate frozen lane, row-level checkmarks, or a compact mode bar with manager sheets for secondary actions.
- The mobile design should prioritize clarity and controlled action hierarchy over full parity in one visible surface.
- Desktop and mobile should share state and mutation semantics, but they do not need identical layout or control density.
