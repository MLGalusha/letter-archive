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

Out of scope:

- Rewriting unrelated admin pages.
- Changing processing semantics.
- Card-style letter views.
- Filtered collections drill-down.

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
