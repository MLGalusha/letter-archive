# Admin Redesign Roadmap

## Phase 0 - Design Grounding

Status: active

Goals:

- Capture current direction and decisions.
- Identify the minimum set of product decisions needed before implementation.
- Define the first implementation slice.

Deliverables:

- Design space folder.
- Dashboard design notes.
- Decision log.

## Phase 1 - Admin Shell Cleanup

Status: completed

Goals:

- Make the admin shell responsive by design instead of treating mobile as a squeezed desktop layout.
- Use a desktop sidebar on larger screens.
- Use a mobile top app bar and slide-out drawer on small screens.
- Avoid reserving collapsed sidebar width on mobile.

Out of scope:

- Full visual redesign of every admin page.
- Backend/API changes.

## Phase 2 - Dashboard Structure

Status: active

Goals:

- Break the dashboard into clearer pieces: page orchestration, toolbar, filters, data view, table/list rendering, bulk action bar, and dialogs.
- Keep shared state for filters, sorting, selection, pagination, and saved views.
- Preserve existing data behavior while improving component boundaries.
- Focus on the letters dashboard first. Keep collections available but do not implement filtered collection drill-down in this phase.

Progress:

- Dashboard controls moved out of the global admin header and into the dashboard surface.
- Recent edits removed as a primary dashboard control.
- Mobile table now uses a compact column set instead of rendering the full desktop table.
- Dashboard toolbar split into primary controls, active filter chips, and a filter editing panel.
- Mobile filter editing is now collapsed behind a Filters button; desktop keeps the filter panel visible.
- Dashboard toolbar render/state glue extracted into `AdminDashboard/DashboardToolbar.tsx` so `AdminDashboard.tsx` can stay closer to page orchestration.
- Saved views now persist filters, sort, and visible columns locally.
- Saved-view menu and filter panel are split into focused toolbar subcomponents.
- Saved-view persistence and save/apply/delete behavior moved into a dedicated hook.
- Last opened is now the real default letters sort, not just a toolbar option.
- Floating selection and bulk-action toolbar moved into `AdminDashboard/BulkEditToolbar.tsx`, leaving the page component closer to orchestration.
- Filter panel markup now uses grouped sections for visibility, content status, date, and collection controls.
- Active filter chip calculation and rendering split out of `DashboardToolbar.tsx`.
- Dashboard confirmation and metadata identity dialogs moved into `AdminDashboard/DashboardDialogs.tsx`.
- Row shift-click and drag selection behavior moved into `useDashboardRowSelection`.
- Delete, clear, and publish/hide bulk mutation workflows moved into `useDashboardBulkActions`.
- Processing status polling and pause/resume/abort controls moved into `useDashboardProcessingControls`.
- Transcription and metadata start flows, including confirmation modal state, moved into `useDashboardProcessingActions`.
- Copy/paste edit-mode state, pending field updates, and edit-mode row click behavior moved into `useDashboardCopyPasteEdit`.
- Dashboard filter/sort query construction centralized in `buildDashboardLetterQuery` so fetch, select-all, and selection-pruning use the same API parameters.
- Letter fetching, pagination, stats normalization, loading/error state, and computed-column client sorting moved into `useDashboardLettersData`.
- Mobile table sizing refined so compact date, collection, visibility, last-opened, checkbox, and flag columns fit without clipped headers or stray ellipses.
- Filter panel option rendering now uses shared visibility/content status definitions with pressed states, and the mobile date/collection controls use a tighter two-column row.
- Saved dashboard view state capture/apply wiring moved into `useDashboardSavedViewState`.
- Filter-change refetching, selection pruning, and select-all-filtered behavior moved into `useDashboardFilteredSelection`.
- Optimistic flag/unflag row mutation moved into `useDashboardFlagActions`.
- Date parsing and date filter button labeling moved into dashboard utils with focused tests.
- Dashboard sort control and mobile date filter control moved into dedicated components so toolbar controls are easier to reason about independently.
- Recent activity table header behavior moved into `SortableTableHeader`, and row rendering moved into `RecentActivityRow`.
- File-type table columns are now centralized with shared column definitions instead of repeated cover/photo/telegram column logic.
- Dashboard toolbar controls are split into view toggle, search field, mobile filter trigger, sort control, saved views, active chips, and filter panel sections.
- Filter panel internals are split into date, visibility, and content-status sections backed by shared filter definitions and filter stats typing.
- Bulk edit toolbar internals are split into selection, copy, processing, and publishing sections, keeping the main bulk toolbar focused on layout and coordination.
- Transcription and metadata confirmation modals now share `ProcessingConfirmDialog`.
- Recent activity column toggling and pagination are split out of the table component, leaving the table focused on header and row composition.
- Dashboard filter state now has a first controller boundary: the toolbar and filter panel consume the filter hook result as one model instead of long repeated filter prop lists.
- Persisted dashboard state and saved dashboard views now consume the same filter controller, reducing repeated setter lists and making future filter additions less brittle.
- Letter fetching, filtered selection pruning/select-all, and processing start actions now consume the same filter controller instead of each receiving duplicate filter prop lists.
- Dashboard filter-to-query translation is centralized in filter adapter helpers, so letter queries and processing actions derive API fields from the same source.
- Dashboard dialogs now consume grouped bulk-action and processing-action models instead of a long modal prop list from the page component.
- Bulk edit toolbar destructive actions are split into their own control component, matching the existing selection, copy, processing, and publishing sections.
- Recent activity table header composition and sortable column definitions are split into a table-header component, leaving the table focused on header/row/pagination structure.
- Recent activity table props are grouped into column, sorting, selection, copy-edit, formatting, pagination, and row-action models to clarify table ownership.
- Shared dashboard manager surfaces now own outside-click dismissal through the trigger/surface boundary, so Sort, Saved views, Columns, and Publishing no longer duplicate document-level close listeners.
- Column settings initialization no longer reads from a ref during render, keeping the touched dashboard column hook compatible with the React Compiler lint rules.
- Column manager wiring now separates trigger toggling from explicit close behavior, matching the shared manager surface contract and avoiding accidental state inversion.
- Sort add-rule state now reflects the current single-picker design instead of carrying the older generic multi-picker registry shape.
- Active-filter summary construction now has one source of truth: the chip list drives the displayed count, clear-all visibility, and component state.
- Toolbar-level tests now cover mobile filter open/close wiring, active search-chip clearing, and hiding letter-only controls when switching to Collections.
- Saved dashboard view integration now has coverage for capturing/restoring filters, sorting, visible columns, column order, and legacy saved-view fallbacks through the dashboard state hook.
- Dashboard sort option metadata, default directions, equality checks, and button summaries are split into a pure sort model with focused tests.
- Filter panel UI is grouped into worklist, content, refine, and advanced sections while keeping one shared filter controller for desktop and mobile.
- Mobile filter sheet now has explicit header, scroll-body, and footer ownership so the filter list scrolls independently without the Done action overlapping content.

Out of scope:

- Rewriting unrelated admin pages.
- Changing processing semantics.
- Card-style letter views.
- Filtered collections drill-down.

## Phase 2.5 - Dashboard Filter Model Review

Status: completed

Goals:

- Audit the current data shapes and API query support before adding more filters.
- Compare likely admin workflows against archive-app patterns: broad search, high-value structured filters, advanced filters, active chips, and saved views.
- Move toward a Supabase-style data-table model: column-aware sorting/filtering shortcuts, active chips, saved views, and a top-level manager surface for complex edits.
- Present proposed filters with what each would do, why it would be useful, and whether it should be primary or advanced.
- Let Mason decide which filters to add or skip before implementation.
- Define how selected filters interact with saved dashboard views, mobile filter sheets, active chips, select-all-filtered behavior, and backend query parameters.
- Review the dashboard sort/filter model so top controls, column headers, and column menus are shortcuts into one shared state instead of competing systems.

Candidate filter categories:

- Workflow filters: needs review, missing transcript, transcript confirmed, metadata failed/complete, processing state.
- Data-completeness filters: missing sender, missing recipient, missing date, missing collection, missing metadata.
- Historical/entity filters: sender, recipient, mentioned person, place, date range.
- Contains/content-type filters: extra items, photos, covers, telegrams, cards, ephemera, articles, diary, voice, flagged.

Target data-table control model:

- Top controls should read as managers: `Filters`, `Sort`, `Columns`, and `Views`.
- Active chips summarize the current rules and provide quick removal.
- Desktop column headers/menus can provide fast column-local actions such as sort ascending, sort descending, clear sort, filter this value/status, hide column, and eventually pin/reorder if the table needs it.
- Mobile should use the manager/sheet pattern first, because horizontal header interactions are less discoverable and harder to hit.
- The implementation should keep one source of truth for filter, sort, column visibility, and column order state so saved views and select-all-filtered behavior do not drift.

Resolved audit findings:

- The admin letters API supports collection, visibility, search, date components, date ranges, transcript status, metadata status, workflow, flagged, extra-content status, cleanup filters, content-type filters, and ordered server-side sort rules.
- The frontend dashboard exposes collection, visibility, search, date, transcript status, metadata status, cleanup, content-type filters, saved views, visible columns, and a shared sort stack.
- Flagged, workflow, extra-content status, cleanup, and content-type filters are now wired through backend query support, frontend query construction, active filter chips, saved dashboard views, persisted dashboard state, stats normalization, select-all-filtered, and the desktop/mobile filter panel.
- Cleanup filters are missing sender, missing recipient, and missing parsed date. Missing collection was not added because `letters.collection_id` is required and there is not currently a meaningful uncategorized letter state.
- Contains/content-type filters are aggregate extra items plus photos, covers, telegrams, cards, ephemera, articles, diary, and voice. They use server-side grouped item/page existence, not current-page row data.
- Entity-style filters such as mentioned person, place, topic, tone, and relationship exist in public archive search patterns, but are not currently wired into the admin letters endpoint.

Progress:

- Added approved low-risk filters to the letters dashboard: flagged, workflow, and extra-content status.
- Wired the new filters through API query construction, active filter chips, saved dashboard views, persisted dashboard state, stats normalization, select-all-filtered, and the desktop/mobile filter panel.
- Expanded admin letters stats with exact workflow buckets so workflow filters can show useful counts.
- Reframed workflow filters as advanced stored pipeline-stage filters with clearer labels, because they are not the same as live queue/running worker state.
- Added cleanup/data-quality filters: missing sender, missing recipient, and missing parsed date.
- Added content-type filters backed by actual grouped item/page existence: extra items, photos, covers, telegrams, cards, ephemera, articles, diary, and voice.
- Added stats buckets for cleanup and content-type filters so filter controls use the same contract as the query.

Sort-model questions:

- What should the `Sort` manager UI look like: compact menu, side panel, or mobile bottom sheet?
- Should column headers open a column menu with sort/filter actions instead of cycling sort directly on click?
- Should server-backed multi-sort be added before we expose true multi-sort in the UI?
- How should sort rules be reordered, removed, and restored in saved dashboard views?
- Which page-only sorts should remain visible after server-backed count sorts are implemented?

Resolved sort audit findings:

- The backend now accepts ordered `sortRules` while keeping the legacy one-field `sort`/`sortOrder` params as fallback compatibility.
- The dashboard sends the full ranked Sort manager stack to the API.
- Count sorts for letters, aggregate extras, and each exposed content type are now applied server-side before pagination.
- Column-header sorting created a duplicate-feeling sort path and should be removed in favor of one Supabase-style sort manager.

Sort-model decision:

- Short term: make the toolbar `Sort` manager the only dashboard sorting surface.
- Short term: support adding, removing, reordering, and toggling sort rules in that manager.
- Short term: send the full ordered rule stack to the API for all currently exposed dashboard sort fields.
- Short term: keep sort popover edits as a draft until the user clicks `Apply sorting`, so arranging rules does not refetch/reorder the table mid-edit.
- Target direction: replace the dropdown-feeling sort control with a Supabase-style `Sort` manager that shows ordered sort rules.
- Target direction: keep Sort manager fields server-backed across the full filtered result set.

Progress:

- Replaced the dropdown-feeling primary sort control with a Supabase-style `Sort` manager button/popover.
- Removed column-header sorting so there is one sorting surface across desktop and mobile.
- Added ordered sort rules with drag ranking, column selection, ascending toggles, and removal.
- Replaced native browser sort-field selects with an in-app menu and renamed the add control to `Add sort rule`.
- Existing sort rules now render as fixed ranked rows instead of nested field dropdowns; the field picker only appears when adding another rule.
- Sort manager now has an apply-step interaction: draft rule edits are staged in the popover and committed through `Apply sorting`.
- Replaced page-only secondary sorting with backend ranked multi-sort for the current Sort manager fields.
- Preserved the older `sort`/`sortOrder` request shape as a fallback while adding `sortRules` for ordered rules.
- Removed stale table-header sort affordance styling so column headers no longer look like a second sorting path.

Exit criteria:

- A narrowed filter set is approved before implementation. Completed for cleanup/content-type filters.
- Each accepted filter has a clear source of truth and query strategy. Completed through the admin letters API query contract.
- Saved dashboard views include any new accepted filter state. Completed.
- The accepted sort model has one shared state, clear mobile behavior, and no duplicate-feeling controls. Completed for the current dashboard Sort manager.

Deferred filter slice:

- Missing collection remains deferred until there is a real uncategorized/missing-collection state. `letters.collection_id` is required today.
- Column-local filter actions should be considered after the filter manager state is stable. Examples: filter this sender, filter this recipient, filter this collection, filter this status, show blank values, or show nonblank values.
- Entity/historical filters such as sender, recipient, mentioned person, place, topic, tone, and relationship remain deferred because they need picker/index/query decisions beyond the cleanup-filter contract.

Deferred sort slice:

- Future sort work should focus on any new sort fields introduced by later entity/workflow redesigns. Current dashboard Sort manager fields are server-backed.
- Integration-level pagination tests would still be useful if this query grows more complex, but focused backend SQL-contract tests now cover ranked rule construction and count-sort placement before pagination.

Deferred processing redesign note:

- The broader transcription/metadata pipeline needs its own redesign after the dashboard pass. Current stored workflow stages can show counts for `TRANSCRIBING` or `METADATA_EXTRACTING` even when nothing is actively queued or running, which makes dashboard filters and processing status feel contradictory.
- That redesign should separate durable letter content status, live queue/job status, retry/error state, and admin actions instead of using one mixed workflow concept for everything.

## Phase 2.6 - Extra Content Data Model Correction

Status: completed

Why this exists:

- The dashboard extras status filter exposed a deeper data-contract issue: `extra_content_status` exists on every representative letter, but it is only meaningful for letter groups that actually have extra items such as covers, telegrams, photos, or ephemera.
- The table's `Extras` column counts actual non-letter items, while the filter stats count status values. Those two concepts must agree or the UI will confidently show wrong cleanup/workflow counts.
- The admin letter detail page and extra-content edit controls also depend on this distinction, so the correction should be made at the API/query boundary instead of as a frontend display patch.

Goals:

- Define the dashboard meaning clearly: extra-content status filters apply only to groups that have extra items.
- Make `Extras > None` mean "has extra items, but no extra-content transcript/status yet", not "the representative letter has `extra_content_status = EMPTY`".
- Keep `Extra items` as a separate Contains filter for showing every group with non-letter items regardless of status.
- Preserve the existing detail/review page behavior unless the audit finds a direct inconsistency.
- Add focused backend coverage so status counts and filtering cannot drift from actual extra-item existence again.

Current audit findings:

- `backend/src/services/letter-queries.ts` computes dashboard extra-content status counts from representative letter status only, so groups with no extra items are currently included in `extraContent.empty`.
- The same endpoint filters by `extra_content_status` after selecting representative rows, but does not require the group to have extra items.
- Returned table rows already compute `extrasCount` from related non-letter pages for the current page, which is why the visible table can contradict the filter counts.
- Collection stats already use non-letter item counts for extra content, so the backend has a precedent for treating item existence separately from extra-content transcript status.
- Public letter detail display already keys visible extra-content sections from `extraContentItems` or actual transcript text, so this checkpoint does not require a detail-page rendering change.
- Admin letter review still needs a later workflow/design pass for when and how extra-content edit controls appear, but the dashboard count/filter bug can be corrected independently.

Implementation direction:

- Add a group-level `has_extras`/extra-item existence calculation to the admin letters query.
- Scope extra-content status stats to groups where `has_extras = true`.
- Scope `extraContentStatus` filtering to groups where `has_extras = true`.
- Keep this as a targeted query contract correction; the broader admin API redesign belongs in a later phase.

Progress:

- Dashboard admin letters stats now calculate group-level extra-item existence from non-letter pages in the same collection/date/type-sequence group.
- Extra-content status counts now include only groups with actual extra item pages.
- Extra-content status filtering now requires `has_extras = true`, so filtering by `None`, `Draft`, `Edited`, or `Done` cannot return groups with zero extras.
- Added focused backend regression coverage for the extra-content status query contract.

Exit criteria:

- A collection with no extra items does not inflate `Extras > None`.
- Filtering by any extra-content status never returns groups with zero extras.
- Tests cover both dashboard stats and filtered results for extra-content status.
- Roadmap/decision notes explain why this is not the same as a future `has extras` filter.

## Phase 2.75 - Dashboard Selection and Bulk Action Redesign

Status: active

Why this exists:

- The current checkbox/selection UI feels bolted onto the table instead of designed as part of the table interaction model.
- Mobile horizontal scrolling currently leaves the checkbox column feeling detached from the rest of the row, especially when the table content moves underneath or beside it.
- Selection affects row opening, drag/shift selection, select-all-page, select-all-filtered, edit mode, copy/paste, bulk processing, publishing, destructive actions, and mobile action placement. This is a larger UX/system redesign, not just visual checkbox styling.

Goals:

- Redesign selection as a first-class table state with clear normal, hover, focused, selected, partial-selected, disabled/loading, and edit-mode states.
- Define whether mobile keeps a sticky selection column, moves selection into a row action/control lane, or uses an explicit selection mode that changes row behavior.
- Make the mobile table scroll model and selection model feel like one system, not two overlapping layers.
- Redesign bulk actions so selected state, count, page selection, filtered selection, processing actions, publishing actions, and destructive actions have a clear hierarchy.
- Preserve existing backend behavior and bulk-action semantics unless a specific follow-up decision changes them.
- Improve accessibility: keyboard reachable checkboxes/actions, visible focus states, accurate selected counts, and predictable row click vs selection behavior.

Code-quality goals:

- Keep selection state ownership in hooks, not scattered table row conditionals.
- Keep table rendering focused on structure and state display; mutation workflows stay in action hooks.
- Prefer grouped models for table, selection, and bulk toolbar props over long prop lists.
- Avoid styling fixes that rely on fragile sticky offsets or duplicated mobile/desktop markup unless there is a documented structural reason.

Investigation tasks:

- Inspect current row selection, drag selection, shift selection, edit mode, and bulk toolbar ownership.
- Measure rendered mobile table geometry with the sticky selection column enabled.
- Decide a mobile selection interaction model before editing CSS: sticky column, selection mode, or row-level control lane.
- Identify which bulk actions are primary, secondary, dangerous, and processing-related.

Current audit findings:

- Selection state is centralized reasonably well in `useDashboardSelection` and `useDashboardRowSelection`, but rendered checkbox behavior is not accessible yet because row checkboxes are `readOnly` and removed from tab order.
- Row click opens the letter, while checkbox click selects and row mouse drag can select ranges. This is powerful on desktop but needs clearer visual boundaries and mobile behavior.
- The table currently has duplicate checkbox styling rules in `AdminDashboard.css`, which makes the checkbox visual system harder to reason about.
- Mobile horizontal scroll pins the checkbox column at `x=0` while the table content scrolls left, so the selection column reads as detached from the row instead of part of a deliberate frozen lane.
- The bulk toolbar is already split into selection, copy, processing, publishing, and destructive sections, but the visual hierarchy still reads as one dense fixed bar.

Current implementation direction:

- Desktop can keep direct checkbox and range-selection power behavior, but it needs clearer selected-row visuals, focus states, and checkbox accessibility.
- Mobile should not keep the current detached sticky checkbox treatment. Prefer either a deliberate frozen selection rail with boundary treatment and row-state continuity, or remove sticky selection on mobile and let the selection column scroll with the table. Choose the simpler stable model first unless inspection proves selection becomes too hard to access.
- Bulk actions should be restyled around hierarchy before extracting reusable patterns: selection summary first, common actions next, dangerous actions visually separated.

Progress:

- Removed the mobile sticky checkbox column so selection moves with the horizontally scrolling table instead of detaching from it.
- Made row checkboxes real focusable controls instead of read-only, pointer-disabled inputs handled only by the table cell.
- Consolidated duplicate checkbox CSS into one row checkbox visual model with hover, checked, and focus-visible states.
- Changed the mobile bulk toolbar into compact stacked action rows with row-level horizontal overflow, reducing the selected-state toolbar footprint.
- Fixed a table header/body ordering mismatch where flag, transcript, metadata, and visibility headers could appear over the wrong cells.
- Added selected-row continuity across the row cells with a clear selection rail on the checkbox cell.
- Grouped the bulk toolbar into selection, edit, processing, publishing, and danger sections so the action hierarchy is visible before deeper visual polish.
- Tightened the table selection contract so row checkboxes pass a small selection intent instead of leaking raw React mouse events through the table model.
- Grouped `BulkEditToolbar` props by toolbar section so the component API matches the selection, edit, processing, publishing, danger, and completion ownership boundaries.
- Refined the bulk toolbar into a named bulk-actions region with reusable labeled sections, a clearer selected-state emphasis, and mobile behavior where selection stays full-width while action groups scroll independently.
- Added focused toolbar tests for section labeling, clear-selection completion, and pending-edit save completion.
- Added explicit accessible names/state for the column configuration trigger and icon-only review-flag header.

Likely implementation slices:

- Selection interaction model and table selection visuals.
- Mobile table/selection scroll behavior. (Mostly complete for the current pass; keep watching during responsive table polish.)
- Bulk action toolbar hierarchy and responsive placement. (Structurally complete for the current pass; deeper visual styling can happen with the broader dashboard style pass.)
- Accessibility and keyboard/focus pass. (In progress: table controls now expose clearer names; keyboard row-opening and deeper range-selection behavior still need a later decision.)
- Focused tests for selection pruning, select-all-filtered, and row click/selection behavior.

Exit criteria:

- Selection does not feel visually detached on mobile horizontal scroll.
- Selected rows and selected counts are obvious without overwhelming the table.
- Bulk actions are grouped by intent and danger level.
- Row opening, checkbox selection, drag/shift selection, and edit mode have predictable behavior on desktop and mobile.
- Browser verification covers desktop, narrow mobile, selected rows, bulk toolbar visible, and horizontal table scroll.

## Phase 2.8 - Dashboard Column Configuration

Status: completed

Why this exists:

- The dashboard can toggle columns on and off, but the user cannot choose column order.
- Mobile horizontal scrolling makes column order much more important because only a small slice of the table is visible at a time.
- Current column order is hardcoded separately in header rendering and row rendering, so reordering needs a shared column model rather than a menu-only tweak.

Goals:

- Add user-controlled column ordering while preserving column visibility.
- Keep checkbox/selection controls first and outside user reorder for now.
- Persist column order locally and include it in saved dashboard views.
- Render table headers and row cells from one shared ordered column model so header/body order cannot drift.
- Use one clear reorder handle in the column menu, with keyboard arrow support as the accessible fallback.

Current audit findings:

- `ALL_COLUMNS` defines available columns, but render order is currently hardcoded in `RecentActivityTableHeader` and `RecentActivityRow`.
- `useDashboardColumns` owns visibility as a `Set<ColumnId>` and persists visibility under `adminDashboardColumns`.
- Saved views persist visible columns, but not column order.
- No drag-and-drop library is installed; header dragging would also conflict with sorting and mobile horizontal scroll.

Likely implementation slices:

- Add `columnOrder` state and persistence migration in `useDashboardColumns`.
- Expose ordered columns, reorder-handle controls, and reset-order controls.
- Update the column menu to show ordered columns with one reorder affordance per row.
- Refactor table header and row rendering to consume the same ordered column list.
- Update saved dashboard views and tests for column order.

Progress:

- Added persisted `columnOrder` alongside visible columns, with migration for older saved column settings.
- Added a single grip-style reorder handle and reset control to the column menu.
- Updated saved dashboard views to capture and restore column order.
- Refactored table header and row rendering to consume one shared ordered column list, preventing header/body drift.
- Browser-verified that moving a column updates both header and row order together and persists to local storage.
- Refined the column menu so the grip is the only drag start, but the full row is the dragged/drop target object. This matches the sort manager interaction and keeps checkbox toggling separate from reordering.
- Audited the selectable column labels. The column picker now keeps stable internal IDs and clearer labels without fixed group headers, because user-controlled reordering makes persistent section labels misleading.

Column naming decisions:

- Keep all current columns for now. The issue was mainly ambiguous naming, not proven redundancy.
- `letters` means grouped letter-page count, so expose it as `Letter pages`.
- `extras` means related non-letter content count, so expose it as `Extra items`.
- `photos` means related photo count, so expose it as `Photo items`.
- `type_*` columns mean file-type counts, so expose them as `Letter files`, `Photo files`, `Telegram files`, etc.
- `created` is shown as `Uploaded` because it reflects record creation/upload timing in the admin workflow.
- `flag` is shown as `Review flag` in the column picker to make the manual admin purpose clearer.

## Phase 3 - Dashboard Responsive UI

Status: active

Goals:

- Implement the desktop dashboard layout based primarily on the stronger desktop concept.
- Implement the mobile dashboard based on compact scanning, top toolbar controls, active filter chips, and drawer/sheet controls.
- Add a matching desktop control for any mobile-only view toggle that survives design review.
- Revisit mobile table behavior so readability wins over forced column compression.
- Turn top-level filter/sort controls into manager buttons/sheets rather than permanent form controls when the rule set becomes complex.
- Redesign selector/dropdown UI as one dashboard manager system instead of many unrelated popovers.

Mobile table direction:

- Keep table scanning on mobile, but allow horizontal scrolling instead of squeezing every column until labels/content become hard to read.
- Decide which columns should remain always-visible or sticky on mobile, likely selection/date or selection/title-equivalent, and which columns can scroll horizontally.
- Use sensible minimum widths for date, collection, visibility, last opened, and status columns so values remain readable.
- Preserve active filters, saved views, sorting, and visible-column controls with the horizontally scrollable table model.
- Treat this as a responsive-table design pass, not a card-view replacement.

## Phase 3.25 - Dashboard Selector and Manager Redesign

Status: active

Why this exists:

- The current dropdowns/popovers are transitional. They work in places, but they do not yet feel like one designed admin system.
- Sort, columns, saved views, date selection, filters, and publish/bulk menus all use slightly different structures, spacing, labels, scrolling behavior, and apply/reset semantics.
- Mobile needs a different interaction surface than desktop. Small dropdowns are cramped for touch and often become awkward when rows can be reordered, toggled, or applied.
- Polishing each dropdown one by one would likely create five slightly different systems. The better path is one shared selector/manager pattern proven on the dashboard first.

Goals:

- Define a shared desktop manager pattern: trigger button, popover shell, compact header/title, content rows, active state, empty state, reset/apply/cancel actions, and outside-click/escape behavior.
- Define a shared mobile manager pattern: sheet or full-width panel, larger touch targets, clear title, scroll ownership, sticky action row when needed, and predictable close/apply behavior.
- Apply the pattern first to dashboard Sort and Columns because they are the most complex managers and already have staged edits/reordering.
- Bring Saved views, date selection, filter editing, and publish/bulk menus toward the same structure after Sort/Columns prove the pattern.
- Avoid turning every selector into a permanent large panel. Desktop can still use compact popovers when the task is short.
- Keep code quality first: shared shell/components only after repeated structure is clear, not before the pattern has proven itself.

Candidate manager surfaces:

- Sort manager: ordered rules, direction toggles, add rule menu, apply/reset.
- Columns manager: visibility toggles, reorder handles, reset order, mobile-friendly touch behavior.
- Saved views menu: save/apply/delete views, eventually include current view dirty state.
- Date selector: specific/range modes, clear/apply behavior, mobile sheet layout.
- Filter manager/sheet: primary filters, advanced filters, active chips, clear/apply behavior.
- Publish/bulk menus: grouped actions that should not feel like one-off dropdowns.

Implementation direction:

- Do not chase visual polish by isolated CSS tweaks to individual dropdowns.
- First document the manager invariants and owner tree: trigger owner, overlay owner, scroll owner, action owner, row owner.
- Then refactor one complex manager, likely Columns or Sort, into the target structure.
- After the first manager works in desktop and mobile, reuse the structure for the others.

Exit criteria:

- Sort and Columns use the same manager shell conventions on desktop and mobile.
- Mobile manager surfaces are touch-friendly and do not rely on cramped native dropdown behavior.
- Apply/cancel/reset semantics are clear and consistent where staged edits exist.
- The dashboard does not contain competing one-off dropdown styles for equivalent tasks.
- Roadmap/decision notes explain which surfaces still use transitional dropdowns and why.

Phase 3.25 progress:

- Added a shared `DashboardManagerSurface` shell with a named dialog, compact header, close action, scrollable body, optional footer/action area, and Escape-to-close behavior.
- Migrated the Sort manager onto the shared shell as the first proving surface.
- Changed the Sort manager's mobile behavior from a cramped anchored popover to a bottom sheet with clear header/body/footer ownership.
- Migrated the Columns manager onto the same shell, keeping its table-header trigger while sharing dialog, close, body, footer, and mobile sheet conventions with Sort.
- Migrated Saved views onto the same manager shell so save/apply/delete view behavior no longer uses a separate one-off popover structure.
- Migrated the bulk Publishing menu onto the same shell, keeping its dark toolbar styling while sharing the dialog/header/close/body conventions.
- Restored the mobile manager placement rule: Sort, Saved views, Columns, and Publishing use the shared bottom-sheet manager pattern on mobile unless a future surface has a documented reason to opt out.
- Made the Sort manager's nested add-rule picker open upward from the mobile sheet footer, so bottom-sheet managers do not rely on off-screen downward dropdown behavior.
- Moved Sort manager draft initialization into the open interaction instead of synchronizing state from an effect, preserving staged-edit behavior while satisfying the local ESLint/React Compiler rule.
- Reworked the Date filter from a nested dropdown inside Filters into an inline filter-panel section, removing the date dropdown ref/outside-click state and making mobile filter scrolling simpler.
- Fixed Sort manager visible direction text so it uses the same field-aware label as the accessible toggle name, avoiding mismatches such as a newest-first sort displaying as "ascending."

Related responsive UI progress:

- Letters/collections view switch is visible on both desktop and mobile.
- Mobile uses top app bar plus dashboard-level controls instead of a bottom nav.
- Sort is a first-class dashboard control and includes Last opened, replacing the need for Recent edits as a primary action.
- Mobile filters now open as a focused bottom sheet with backdrop and close behavior instead of expanding the dashboard stack inline.
- Mobile table now favors horizontal scroll with readable minimum column widths instead of hiding most columns and compressing the remaining ones.
- The desktop filter panel now uses a responsive section grid so wider filter groups, such as pipeline stage, content status, and date, can span enough space without label/button collisions.
- Selection and bulk actions have a documented audit and conservative target model before deeper UI changes.
- Selection behavior now has focused coverage for page selection, select-all-filtered, filtered pruning, shift range selection, drag select/deselect, copy-mode row interception, selected-letter details, and bulk toolbar selection actions.
- Row checkbox event isolation is owned by a dedicated component, making the table row renderer less responsible for selection mechanics.
- Mobile selected-state table layout now reserves enough bottom space for the fixed bulk toolbar so lower rows do not sit behind it.

Target responsive direction:

- Desktop can support both toolbar managers and column-local shortcuts.
- Mobile should prioritize top-level `Filters`, `Sort`, `Columns`, and `Views` managers because table header interactions are less reliable while horizontally scrolling.
- Active chips should remain visible enough to explain the current data set without making the toolbar tall or noisy.

Dependency:

- Finish or intentionally defer Phase 2.75 before calling the dashboard responsive table pass complete, because selection and horizontal scroll are coupled.

## Phase 4 - Reusable Admin Patterns

Status: pending

Goals:

- Extract reusable patterns only after they prove useful in the dashboard.
- Candidate patterns: admin toolbar, filter manager, sort manager, active chips, column manager, saved view menu, compact data table, bulk action bar, confirmation dialogs.
- Only promote the redesigned selection/bulk-action model into reusable patterns after it works on the dashboard.

## Phase 5 - Broader Admin Rollout

Status: pending

Goals:

- Apply proven shell and component patterns to Content, Processing, Notes, Upload, Settings, and related pages.
- Redesign each page only after its workflow and desired layout are clear.

## Phase 6 - Processing Pipeline Redesign

Status: pending

Why this exists:

- The current transcription/metadata pipeline mixes durable letter workflow stage, content completeness, live queue state, and admin action state.
- This causes confusing UI states, including stored `TRANSCRIBING`/`METADATA_EXTRACTING` counts when the live queue may have nothing actively running.

Goals:

- Audit backend processing state, job queue state, worker status, letter content statuses, and admin processing actions.
- Define separate source-of-truth fields for durable letter state versus live job/queue state.
- Redesign the Processing page and related dashboard status/filter language around those separate concepts.
- Preserve data integrity and avoid changing processing semantics until the state model is explicitly designed.
