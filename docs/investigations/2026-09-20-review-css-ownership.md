# Review CSS ownership: independent review and browser evidence

Issue: [#198](https://github.com/MLGalusha/letter-archive/issues/198). Review covers the uncommitted `isolate-review-css` changes on 2026-09-20.

## Review outcome

No remaining actionable diff finding after these corrections:

- The public `LetterDisplay` component is no longer imported by a live route. Its proposed section changes and legacy-component test were removed from this issue; the current public reader uses different section classes.
- Renaming bespoke review confirmations initially removed inherited centered text and mobile column actions. The review stylesheet now owns both explicitly, preserving the previous behavior.

Checked renamed selectors across review components, stylesheets, unit tests, and E2E callers. The common E2E `.confirm-dialog` selector remains valid for Dashboard bulk confirmations. No current Dashboard JSX consumer uses the removed `filter-section`, `filter-group`, `sort-option`, or `dropdown-container` classes. Shared portions of comma-separated rules remain present.

## Browser method

Chromium through Playwright CLI, separate Vite server `127.0.0.1:4187`, with mocked API/authentication/event-stream responses and a fixture letter/image. Baseline dialog comparison used the prior CSS branch at `4186` with the same fixture. Checks used 1280 × 900 and 390 × 844 viewports.

Loaded review and Dashboard routes, then public Home/Collections routes in the same document. Where no public/admin navigation link exists, the harness dispatched a browser history navigation event to preserve lazy-loaded styles. Additional controlled checks moved the actual loaded stylesheets to the end of the document head in either order. No backend mutation was submitted; confirmations were cancelled and review dialogs dismissed.

## Measured results

| Live control | Desktop evidence | Narrow evidence |
| --- | --- | --- |
| Public archive refine filters | Section gap 4.8 px; group gap 3.2 px. Unchanged with Dashboard or SearchBar styles last. | Group width 131.109 px; same gap/direction; no document overflow. |
| Collections sort options | Flex layout, 156.813 × 35.672 px; padding 8 px 11.2 px. Unchanged with Dashboard or Collections styles last. | Same option geometry; no document overflow. |
| Review sender/recipient row | Flex row, 16 px gap, two 338.797 × 76 px fields. Unchanged with shared Form styles last. | Column, 16 px gap, 308 × 76 px fields; no document overflow. |
| Review topic Dropdown | Opens and dismisses; wrapper stays 338.797 px wide when Dashboard or Dropdown styles are last. | Review form remains within viewport. |
| Dashboard Transcribe confirmation | Shared actions centered, CSS max-width 400 px, rendered outer width 464 px including padding. Same with review or Modal styles last. | 342 px outer width at x=24; centered column actions. |
| Review metadata regeneration | 464 px wide, centered text, row actions. | 358 px wide at x=16, centered text, column actions; inputs 294 px wide. |
| Review transcription regeneration | 464 px wide, centered text, row actions, matching prior branch. | 404 px wide at x=-7, centered text, column actions, matching prior branch. |

The transcription dialog's narrow overflow is **pre-existing** (`min-width: 340px` plus padding), retained by this CSS ownership change. It is not claimed as corrected here.

## Browser negative controls

Temporarily substituting the prior Dashboard stylesheet in the same live public DOM reproduced both reported leaks, then restoring the new stylesheet fixed them:

- Archive refine: section/group gaps **4 / 8 px → 4.8 / 3.2 px**; label font weight **600 → 700**.
- Collections sort: **grid → flex**; padding **6.72 px 7.2 px → 8 px 11.2 px**.

These controls were browser-only substitutions; repository source was not modified by the reviewer.

## Limits

This is targeted style/layout and interaction evidence, not a full visual sweep, backend acceptance, physical-device or Safari validation. Unchanged legacy/public card code was excluded after correcting the import inventory. Functional unit tests, lint, build/type checks, and final-head CI are separate coordinator-owned evidence.
