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

Status: pending

Goals:

- Audit the current data shapes and API query support before adding more filters.
- Compare likely admin workflows against archive-app patterns: broad search, high-value structured filters, advanced filters, active chips, and saved views.
- Present proposed filters with what each would do, why it would be useful, and whether it should be primary or advanced.
- Let Mason decide which filters to add or skip before implementation.
- Define how selected filters interact with saved dashboard views, mobile filter sheets, active chips, select-all-filtered behavior, and backend query parameters.
- Review the dashboard sort model so the toolbar sort control and sortable column headers are not two competing systems.

Candidate filter categories:

- Workflow filters: needs review, missing transcript, transcript confirmed, metadata failed/complete, processing state.
- Data-completeness filters: missing sender, missing recipient, missing date, missing collection, missing metadata.
- Historical/entity filters: sender, recipient, mentioned person, place, date range.
- Content-shape filters: has extras, has photos, has cover, has telegram, flagged.

Sort-model questions:

- Should the toolbar sort be the primary/simple sort while column headers remain desktop power controls?
- Should mobile expose only the toolbar sort, or also keep header sorting?
- How should the toolbar label multi-sort states created from column headers: custom sort, primary sort plus count, or another pattern?
- Should choosing a toolbar sort replace the existing sort stack, while column headers can build a multi-sort stack?
- How should saved dashboard views describe and restore multi-sort state?

Exit criteria:

- A narrowed filter set is approved before implementation.
- Each accepted filter has a clear source of truth and query strategy.
- Saved dashboard views include any new accepted filter state.
- The accepted sort model has one shared state, clear mobile behavior, and no duplicate-feeling controls.

## Phase 3 - Dashboard Responsive UI

Status: active

Goals:

- Implement the desktop dashboard layout based primarily on the stronger desktop concept.
- Implement the mobile dashboard based on compact scanning, top toolbar controls, active filter chips, and drawer/sheet controls.
- Add a matching desktop control for any mobile-only view toggle that survives design review.

Progress:

- Letters/collections view switch is visible on both desktop and mobile.
- Mobile uses top app bar plus dashboard-level controls instead of a bottom nav.
- Sort is a first-class dashboard control and includes Last opened, replacing the need for Recent edits as a primary action.
- Mobile filters now open as a focused bottom sheet with backdrop and close behavior instead of expanding the dashboard stack inline.

## Phase 4 - Reusable Admin Patterns

Status: pending

Goals:

- Extract reusable patterns only after they prove useful in the dashboard.
- Candidate patterns: admin toolbar, filter drawer, active chips, sort menu, saved view menu, compact data table, bulk action bar, confirmation dialogs.

## Phase 5 - Broader Admin Rollout

Status: pending

Goals:

- Apply proven shell and component patterns to Content, Processing, Notes, Upload, Settings, and related pages.
- Redesign each page only after its workflow and desired layout are clear.
