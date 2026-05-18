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

## Selection and Bulk Actions

Selection is not just a checkbox treatment. It is a modeful dashboard interaction that affects row opening, row state, keyboard focus, range selection, drag selection, edit/copy mode, bulk processing, publishing, destructive actions, and selected-scope messaging.

Design goals:

- Normal browsing should keep row opening fast and obvious.
- Selection should make row state, selected count, and selected scope obvious.
- Page selection and all-filtered selection should read as different scopes.
- Bulk actions should be grouped by intent instead of appearing as one dense action row.
- Dangerous actions should be separated visually and behaviorally from routine actions.
- Mobile should not be forced to expose every desktop action inline.

Desktop direction:

- Desktop can keep direct table checkboxes and power-user gestures such as shift range selection and drag selection.
- The selected-row state should be visible across the row, with focus states and accessible checkbox names.
- A desktop bulk action surface can be wider and more persistent, but should still organize actions into selection scope, edit/copy, process, publish/visibility, and danger groups.

Mobile direction:

- Mobile does not need to use the exact desktop selector layout.
- The current sticky checkbox lane is a tactical fix for horizontal table scroll, not a final UX decision.
- The redesign should compare a deliberate frozen selection rail, a row-level selector that scrolls with the table, and an explicit selection mode with a compact action surface.
- A compact mobile selected-state bar with manager sheets for secondary action groups may be better than stacking every bulk action in a fixed toolbar.
- The final mobile model should feel connected to the selected row and remain usable with one thumb.

Current target:

- Desktop keeps direct checkbox selection, shift selection, drag selection, and a grouped selected-state action bar.
- Mobile moves toward explicit selection mode: after selection starts, row taps toggle selection instead of opening detail, and the mode bar owns selected count, scope, and exit/save.
- Mobile secondary action families such as processing, publishing, and danger can open manager sheets instead of living in one fixed toolbar.
- Selection scope controls should distinguish selected page, all filtered results, and manually selected rows.
- Publishing details should not imply exact selected-set counts when all-filtered selection includes unloaded rows unless exact aggregate counts are fetched.

Current toolbar structure:

- Primary row: letters/collections switch, search, filter manager, saved view action, sort.
- Active filter chips: visible on desktop and mobile, horizontally scrollable when needed.
- Filter editing panel: opened from Filters on desktop and mobile. Desktop uses an overlay manager anchored to the toolbar so opening filters does not move the table; mobile keeps the bottom sheet with fixed header/footer and a scrollable body.
- The filter manager starts with Scope controls because date and collection are the most common narrowing actions. Worklist, content, and pipeline filters follow the same shared state model.
- Collection filtering uses a compact multi-code rule list. Empty rules mean all collections, so there is no separate All button; each added code becomes its own removable active filter.

The mobile filter panel is intentionally not a second navigation system. It edits the same filter state used by the desktop dashboard.

Current filter groups:

- Visibility and review flag.
- Stored pipeline stage.
- Cleanup/data quality: missing sender, recipient, or parsed date.
- Contains: groups with extra items or specific stored content types: photos, covers, telegrams, cards, ephemera, articles, diary, or voice.
- Content status: transcript, metadata, and existing extra-content status.
- Date, collection, and search.

Current filter manager order:

1. Visibility.
2. Content status: transcript, metadata, and extras.
3. Collection code.
4. Date.
5. Content type / contains.
6. Pipeline stage.
7. Cleanup/data quality.
8. Review flag.

Desktop and mobile use the same ordered filter module tree. Desktop presents the modules in a right-side overlay manager above the table; mobile keeps the same modules in a single-column sheet.

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
