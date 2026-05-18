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

Out of scope:

- Rewriting unrelated admin pages.
- Changing processing semantics.
- Card-style letter views.
- Filtered collections drill-down.

## Phase 2.5 - Dashboard Filter Model Review

Status: active

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
- Content-shape filters: has extras, has photos, has cover, has telegram, flagged.

Target data-table control model:

- Top controls should read as managers: `Filters`, `Sort`, `Columns`, and `Views`.
- Active chips summarize the current rules and provide quick removal.
- Desktop column headers/menus can provide fast column-local actions such as sort ascending, sort descending, clear sort, filter this value/status, hide column, and eventually pin/reorder if the table needs it.
- Mobile should use the manager/sheet pattern first, because horizontal header interactions are less discoverable and harder to hit.
- The implementation should keep one source of truth for filter, sort, column visibility, and column order state so saved views and select-all-filtered behavior do not drift.

Current audit findings:

- The admin letters API already supports collection, visibility, search, date components, date ranges, transcript status, metadata status, workflow, flagged, extra content status, and one server sort at a time.
- The frontend dashboard currently exposes collection, visibility, search, date, transcript status, metadata status, saved views, visible columns, and a shared sort stack.
- The frontend API type already has `flagged`, but the dashboard filter adapter does not expose it yet.
- The backend supports `extraContentStatus`, but the frontend API type and dashboard state do not expose it yet.
- The API stats response includes flagged and extra-content status counts, but the dashboard normalized stats currently only maps flagged, transcript, and metadata counts.
- Data-completeness filters such as missing sender, missing recipient, and missing date are not supported by the admin letters API yet and would require backend query additions.
- Entity-style filters such as mentioned person, place, topic, tone, and relationship exist in public archive search patterns, but are not currently wired into the admin letters endpoint.
- Content-shape filters such as has photos, has extras, has cover, or has telegram are visible in row count/column data but are not currently query filters.

Progress:

- Added approved low-risk filters to the letters dashboard: flagged, workflow, and extra-content status.
- Wired the new filters through API query construction, active filter chips, saved dashboard views, persisted dashboard state, stats normalization, select-all-filtered, and the desktop/mobile filter panel.
- Expanded admin letters stats with exact workflow buckets so workflow filters can show useful counts.
- Reframed workflow filters as advanced stored pipeline-stage filters with clearer labels, because they are not the same as live queue/running worker state.

Sort-model questions:

- What should the `Sort` manager UI look like: compact menu, side panel, or mobile bottom sheet?
- Should column headers open a column menu with sort/filter actions instead of cycling sort directly on click?
- Should server-backed multi-sort be added before we expose true multi-sort in the UI?
- How should sort rules be reordered, removed, and restored in saved dashboard views?
- Which page-only sorts should remain visible after server-backed count sorts are implemented?

Sort audit findings:

- The backend only supports one server-side sort field and direction per admin letters request.
- The dashboard sort state can hold multiple sort columns, but only the last server-sort column is sent to the API.
- Count sorts for letters, extras, and photos are applied client-side after the paginated server response, which means they only sort the current page rather than the full filtered result set.
- The toolbar sort is currently the primary server sort selector; column headers can create a broader sort stack, which risks feeling like duplicate sorting unless the UI labels the relationship clearly.

Sort-model decision:

- Short term: treat the toolbar dropdown as the primary server sort for the full filtered result set.
- Short term: treat count-column header sorts for letters, extras, and photos as page-level secondary sorts until the backend supports those sorts server-side.
- Short term: keep server-sortable column headers wired to the same primary server sort state, but label the sort scope so the toolbar and headers do not read as unrelated competing systems.
- Target direction: replace the dropdown-feeling sort control with a `Sort` manager that shows ordered sort rules and lets desktop column headers/menus act as shortcuts into the same rules.
- Target direction: avoid exposing true multi-sort until the API can apply it server-side across the full filtered result set.

Progress:

- Dashboard sort UI now labels the dropdown as `Primary sort`, exposes page-level count sorts separately, and lets admins clear page sorts without clearing the primary server sort.
- Sortable column headers now advertise whether they affect the full filtered result set or only the currently loaded page.

Exit criteria:

- A narrowed filter set is approved before implementation.
- Each accepted filter has a clear source of truth and query strategy.
- Saved dashboard views include any new accepted filter state.
- The accepted sort model has one shared state, clear mobile behavior, and no duplicate-feeling controls.

Deferred filter slice:

- Missing sender, missing recipient, and missing date should be implemented after this dashboard UI pass as cleanup filters with explicit backend query support.
- Has photos, has extras, has cover, and has telegram should be implemented after this dashboard UI pass as content-shape filters backed by server-side grouped letter counts/types, not current-page client data.
- These deferred filters should be planned before broader admin rollout so they can reuse the finished dashboard filter model instead of creating another one-off filter pattern.
- Column-local filter actions should be considered after the filter manager state is stable. Examples: filter this sender, filter this recipient, filter this collection, filter this status, show blank values, or show nonblank values.

Deferred sort slice:

- Add server-backed multi-sort only after the admin letters API accepts ordered sort rules instead of one `sort`/`sortOrder` pair.
- Move letters/extras/photos count sorting to the backend so those columns can sort the full filtered result set instead of only the current page.
- Replace the temporary primary-sort dropdown with a `Sort` manager once server-side sort behavior is clear enough to avoid misleading UI.

Deferred processing redesign note:

- The broader transcription/metadata pipeline needs its own redesign after the dashboard pass. Current stored workflow stages can show counts for `TRANSCRIBING` or `METADATA_EXTRACTING` even when nothing is actively queued or running, which makes dashboard filters and processing status feel contradictory.
- That redesign should separate durable letter content status, live queue/job status, retry/error state, and admin actions instead of using one mixed workflow concept for everything.

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

Likely implementation slices:

- Selection interaction model and table selection visuals.
- Mobile table/selection scroll behavior.
- Bulk action toolbar hierarchy and responsive placement.
- Accessibility and keyboard/focus pass.
- Focused tests for selection pruning, select-all-filtered, and row click/selection behavior.

Exit criteria:

- Selection does not feel visually detached on mobile horizontal scroll.
- Selected rows and selected counts are obvious without overwhelming the table.
- Bulk actions are grouped by intent and danger level.
- Row opening, checkbox selection, drag/shift selection, and edit mode have predictable behavior on desktop and mobile.
- Browser verification covers desktop, narrow mobile, selected rows, bulk toolbar visible, and horizontal table scroll.

## Phase 2.8 - Dashboard Column Configuration

Status: active

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

## Phase 3 - Dashboard Responsive UI

Status: active

Goals:

- Implement the desktop dashboard layout based primarily on the stronger desktop concept.
- Implement the mobile dashboard based on compact scanning, top toolbar controls, active filter chips, and drawer/sheet controls.
- Add a matching desktop control for any mobile-only view toggle that survives design review.
- Revisit mobile table behavior so readability wins over forced column compression.
- Turn top-level filter/sort controls into manager buttons/sheets rather than permanent form controls when the rule set becomes complex.

Mobile table direction:

- Keep table scanning on mobile, but allow horizontal scrolling instead of squeezing every column until labels/content become hard to read.
- Decide which columns should remain always-visible or sticky on mobile, likely selection/date or selection/title-equivalent, and which columns can scroll horizontally.
- Use sensible minimum widths for date, collection, visibility, last opened, and status columns so values remain readable.
- Preserve active filters, saved views, sorting, and visible-column controls with the horizontally scrollable table model.
- Treat this as a responsive-table design pass, not a card-view replacement.

Progress:

- Letters/collections view switch is visible on both desktop and mobile.
- Mobile uses top app bar plus dashboard-level controls instead of a bottom nav.
- Sort is a first-class dashboard control and includes Last opened, replacing the need for Recent edits as a primary action.
- Mobile filters now open as a focused bottom sheet with backdrop and close behavior instead of expanding the dashboard stack inline.
- Mobile table now favors horizontal scroll with readable minimum column widths instead of hiding most columns and compressing the remaining ones.

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
