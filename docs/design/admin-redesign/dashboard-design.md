# Dashboard Design Notes

## Design Direction

Use the desktop concept image as the stronger structural reference. Treat the mobile concept image as inspiration for specific ideas, not as a strict responsive counterpart.

The dashboard should feel like an operational admin tool: dense, scannable, quiet, and direct. Avoid turning the page into a marketing-style layout.

## Desktop Concept

Recommended structure:

1. Admin shell/sidebar.
2. Dashboard-level toolbar.
3. Primary filters: status, collection, date range, search.
4. Advanced filters: sender, recipient, collection details, transcript, metadata, visibility.
5. Table toolbar: result count, saved view/preset, sort, view switch if needed, column controls.
6. Data table.
7. Pagination.
8. Selection-driven bulk action bar.

Notes:

- Recent edits should not be a primary button.
- Saved presets should become saved views.
- Column controls are desktop-first.
- Sort should cover "Last opened" and "Recently edited" so separate recent-history UI is not needed.

## Mobile Concept

Recommended structure:

1. Top app bar with brand/title, search, and menu button.
2. Toolbar row with filters, saved view, and sort.
3. Active filter chips.
4. Compact table/list-table.
5. Pagination or load-more controls.
6. Selection-driven action bar when rows are selected.

Default mobile visible fields:

- Date
- Collection
- Visibility
- Last opened
- Flag/action

Implemented first pass: the mobile letters table uses this compact field set and keeps selection/flag controls available.

Fields such as sender, recipient, transcript status, metadata status, created date, and page/extras counts can appear in an expanded row, detail mode, or alternate density later.

Current toolbar structure:

- Primary row: letters/collections switch, search, filter manager, saved view action, sort.
- Active filter chips: visible on desktop and mobile, horizontally scrollable when needed.
- Filter editing panel: opened from Filters on desktop and mobile. Desktop keeps the panel inline but height-capped with its own scroll owner so the table remains visible; mobile uses a bottom sheet with fixed header/footer and a scrollable body.

The mobile filter panel is intentionally not a second navigation system. It edits the same filter state used by the desktop dashboard.

Current filter groups:

- Visibility and review flag.
- Stored pipeline stage.
- Cleanup/data quality: missing sender, recipient, or parsed date.
- Contains: groups with extra items or specific stored content types: photos, covers, telegrams, cards, ephemera, articles, diary, or voice.
- Content status: transcript, metadata, and existing extra-content status.
- Date, collection, and search.

Saved views are local dashboard presets for now. They save filters, sort, and visible columns without changing backend/API behavior. If they become multi-user or cross-device later, promote the same shape to an API-backed model.

Default letters sort is Last opened descending. This keeps recent activity discoverable through sorting instead of a separate Recent edits button.

The Sort manager stores ordered rules and sends the full ranked stack to the backend before pagination. Count sorts for letter pages, aggregate extra items, and each stored content type are server-backed dashboard sorts now, not current-page refinements.

## Letters vs Collections

The current dashboard has a letters/collections toggle. The redesign should not hide this on mobile only. If the toggle remains, desktop needs an equivalent visible control.

For the first implementation, keep collections separate from the redesigned letters dashboard. Do not add card view.

Open behavior question: when filters are active, collections could either:

- Ignore letter filters and behave as a pure collection list.
- Show only collections containing matching letters.
- Show all collections but include matched-letter counts.

The third option may be the most useful, but it may require API or client aggregation work and should not be assumed for the first build.

If filtered collections are added later, primary row click should drill into the matching letters for that collection, while a separate explicit "Manage" action should open collection-level editing. This keeps browsing letters separate from managing collection metadata.

## First Build Bias

Prioritize code shape:

- Clear component boundaries.
- One filter/sort model shared by desktop and mobile views.
- Presentation components that can differ between desktop and mobile without duplicating business logic.
- Reusable shell behavior for future admin screens.
- Letters dashboard first; collections remain a separate management/list workflow for now.
