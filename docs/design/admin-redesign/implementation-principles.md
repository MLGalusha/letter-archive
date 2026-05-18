# Admin Redesign Implementation Principles

This file is for agents working on the admin redesign. Read it before editing dashboard UI code.

## Priority Order

1. Preserve behavior.
2. Improve code ownership and state boundaries.
3. Improve responsive structure.
4. Improve visual polish.

Visual improvements should follow from better structure. If a visual issue takes repeated CSS offsets, duplicated markup, or special-case conditionals to fix, stop and inspect the ownership model first.

## Current Product Direction

- The admin dashboard at `/admin` is the pilot surface.
- Code quality matters more than quick visual wins.
- Keep backend/API behavior stable unless the roadmap explicitly calls for backend work.
- Mobile uses top app bar plus drawer, not bottom navigation.
- The dashboard uses table scanning on mobile; do not introduce card-style letter views in this pass.
- Collections remain separate for now; do not build filtered collection drill-down unless the roadmap changes.

## Dashboard Ownership Model

- `AdminDashboard.tsx` should stay close to page orchestration.
- Dashboard state should live in focused hooks.
- Query translation should stay centralized so fetch, select-all-filtered, processing, and saved views do not drift.
- Table components should render table structure and local interaction affordances, not own mutation workflows.
- Bulk mutation flows should stay in action hooks and dedicated toolbar sections.
- Saved dashboard views should preserve filters, sort, and visible columns.

## File Size And Extraction

Small files are acceptable only when they represent a stable concept or ownership boundary.

Good reasons to extract:

- A repeated UI pattern has one source of truth.
- A component has a clear domain name and testable responsibility.
- A hook owns a specific state machine or side effect.
- Prop lists become clearer when grouped into a model.

Bad reasons to extract:

- Hiding complexity without simplifying ownership.
- Creating a wrapper around a few lines of markup that has no reusable concept.
- Splitting files before understanding the interaction model.

## Selection And Bulk Actions

Selection is now a dedicated roadmap phase. Do not treat it as checkbox styling.

Before changing selection UI:

- Inspect row click, checkbox click, shift selection, drag selection, edit mode, select-all-page, and select-all-filtered behavior.
- Decide the mobile interaction model before editing sticky-column CSS.
- Keep selected state, selected counts, and bulk actions synchronized.
- Preserve keyboard and focus behavior.

Selection redesign should make mobile horizontal scroll and selected rows feel like one system.

## Responsive Work

For each meaningful dashboard UI change:

- Verify desktop around `1440x900`.
- Verify narrow mobile around `390x844`.
- Check the smallest relevant scroll container, not only the full page.
- Use DOM measurements when the issue is geometry.
- Confirm long labels, counts, badges, and selected states do not overlap or resize stable controls.

## Roadmap Discipline

Update `roadmap.md` when:

- A phase starts, completes, or changes order.
- A new risk or dependency appears.
- A meaningful implementation checkpoint lands.
- A deferred feature needs to remain visible.

Update `decisions.md` when:

- A product behavior decision is accepted.
- An unresolved question becomes clear enough to record.
- A design direction is intentionally rejected.

Prefer small checkpoint commits after coherent slices. Do not wait for a huge redesign batch if a structural slice is complete and verified.

## Autonomy Rules

When Mason asks for autonomous progress:

- Continue through the roadmap in the documented order.
- Prefer structural cleanup and interaction correctness over cosmetic changes.
- Make conservative decisions that match the roadmap and existing code patterns.
- Pause for user input only when a choice changes product behavior, backend semantics, destructive behavior, or a visible workflow in a way the roadmap has not already approved.
- Commit verified checkpoints with plain commit messages.
