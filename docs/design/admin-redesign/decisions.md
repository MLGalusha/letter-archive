# Admin Redesign Decisions

## Accepted

### Mobile Navigation

Use a top app bar with a slide-out drawer for mobile navigation.

Do not start with both a drawer and bottom navigation. A drawer maps cleanly to the desktop sidebar and scales better as admin sections grow.

### First Implementation Scope

Start with admin shell cleanup and the `/admin` dashboard redesign.

Do not redesign every admin screen visually yet. Other admin pages should keep working while the dashboard becomes the pilot for reusable patterns.

### Backend/API Scope

Keep existing backend/API behavior intact for the first build.

### Recent Edits

Remove recent edits as a primary dashboard button.

Replace that behavior with sort/filter/saved-view affordances, especially options such as recently opened, recently edited, flagged, created date, or workflow status.

Workflow/pipeline-stage filtering should be treated as an advanced admin filter, not a primary dashboard filter. Label it as pipeline stage and make clear that the counts come from stored letter stage fields, not from live queue health.

### Saved Presets

Treat saved presets as saved dashboard views.

A saved view should preserve filters, sort state, and visible columns. It should not be only a named filter set.

Column order is part of the dashboard view model. Use a single drag-handle affordance in the column menu instead of separate up/down arrow buttons; arrow-key support remains available for keyboard users.

Column picker labels should describe the admin-facing meaning, not the internal field name. Keep persisted column IDs stable, but group and rename visible choices so count columns, workflow status columns, admin activity columns, and file-type columns are not confused with each other.

### Data Table Controls

Evolve dashboard sorting and filtering toward a Supabase-style data-table model.

The target direction is one shared table state with manager surfaces for sorting, filtering, columns, and saved views. Header and column-menu actions should not become a second sorting system.

The top sort/filter controls should become managers: concise buttons that open a menu/sheet showing active rules, adding/removing rules, and explaining scope.

The top `Sort` manager owns all dashboard sorting. Column headers should not sort in this pass; that keeps desktop and mobile behavior aligned and avoids duplicate sort paths.

Existing sort rules should be fixed ranked rows, not field dropdowns. To change a rule's field in this pass, remove the rule and add the intended field again. This keeps the manager visually clear while the sort model is still being stabilized.

Sort manager edits should be staged until `Apply sorting` is clicked. Closing the popover without applying discards draft edits, which prevents table refetches while the user is still arranging sort rules.

Until the API supports ordered server-side sort rules, only the first server-backed rule is sent to the backend. Additional rules refine the currently loaded page and must be labeled as such.

Long term, meaningful sorts and filters should be server-backed for the full filtered result set. Page-only sorting is acceptable as a temporary state, not the final design. Server-backed ranked multi-sort is a future backend slice and should apply the full ordered sort stack before pagination.

Extra-content status filters apply only to letter groups that actually have extra items. A representative letter with `extra_content_status = EMPTY` is not enough to count as "Extras: None"; the group must have non-letter items first. A future `has extras` filter is a separate content-shape filter, while the current extras status buttons are workflow/status filters for existing extra content.

### Mobile Data View

Start from a compact table/list-table approach rather than forcing desktop columns onto mobile.

Cards remain an open option, but the first design should prioritize fast scanning and direct row opening.

## Unresolved

### Collections Toggle Behavior

The dashboard currently toggles between letters and collections. The redesign needs to decide whether this remains a dashboard-level view switch or becomes part of a more general data-view switch.

Open question: when letter filters are active, should the collections view show all collections, or only collections containing letters that match the active filters?

### Desktop View Toggle

The mobile concept includes a view toggle near the table. The desktop layout also needs an equivalent control if view switching remains part of the dashboard.

Open question: should the desktop control live in the table toolbar beside sort/columns, or higher near the dashboard title/filter area?

### Mobile Bulk Actions

Open question: should mobile support the full desktop bulk action set immediately, or only selection plus essential actions first?

### Card View

Do not add a card-style dashboard view for the first redesign.

The mobile concept's card/grid-looking control should be interpreted as inspiration for the letters/collections view switch, not as a request for cards.

### Collections Integration

Keep collections separate for the first dashboard redesign.

The first build should focus on the letters dashboard and admin shell. The existing collections list/management flow should remain available, but filtered collection drill-down should not be part of the first implementation slice.

Future direction: a filtered collections dashboard could show only collections containing letters that match the active filters, with matched-letter counts and a separate explicit manage action. That is useful, but it is a product behavior change and should not block the first structure pass.

### Selection and Bulk Actions

The dashboard selection model needs a dedicated redesign pass.

The problem is broader than checkbox styling. It includes mobile horizontal scroll, sticky columns, row click behavior, selection mode, bulk toolbar hierarchy, drag/shift selection, edit mode, and accessibility. Treat this as a dashboard interaction system before promoting any table or bulk-action pattern to other admin pages.

Open question: mobile selection should use one of these models after inspection: sticky selection column with stronger boundary treatment, explicit selection mode, or a row-level control lane. Do not choose by CSS tweak alone.
