# Frontend lint reconciliation

Scope: production main `54a71a7f`, issue #196. The existing regression gate is preserved. Main had 98 current diagnostics and 103 baseline allowances (five stale). PR #189's owner finished before shared public-page changes; its branch remains untouched.

## Behavioral improvements

- Archive hydration reads committed state and preserves POP/clear/scope/debounce fences. Facets use the hook's retained response instead of duplicate render-mutated refs.
- Font measurement reads the mounted DOM and caches widths for resize. Media queries use React's existing external-store API. Native listeners receive committed callbacks.
- Custom upload collection codes survive later imports. Notes, notifications, usage and journal/page loads reject superseded responses, including errors and loading completion.
- Journal image selection rejects stale collection/letter results; empty/failed collection requests settle once per activation instead of looping. Connection paths and invite validation follow current inputs; duplicate dismissal state belongs to the selected entity type.
- Dependencies, empty-array identities, callable guards, block factories, measurement globals and canvas stubs use accurate types/identities. Notification formatters have one ordinary module.

## Deliberate exceptions

Exceptions are documented beside each statement, with no project-wide rule/setting change. External request starts, stored preferences, upload acknowledgments, review owner/draft synchronization, gesture cleanup and dock transitions retain their legitimate effect lifecycle. The private per-visit promise queue remains intentionally mutable scheduling state. Legacy useAsync dynamic dependencies and co-located provider/hook hot-reload boundaries retain narrow exceptions rather than unrelated API churn. Editor history reads retain their existing explicit version signal in the preceding editor change.

## Evidence

Five new uploader/Notes/Notifications/Usage/journal tests fail original production sources for the expected bugs, then pass the fixes. Independent review checked success/error/loading ownership. A new A → B → A popup regression introduced by a draft lint change was caught and corrected before publication, with a failing/passing control. Committed-font measurement likewise has a failing original control and verifies cached resize behavior.

Focused verification: 95 public author checks, 53 independent collection/archive/dock checks, 81 admin owner checks, 38 affected admin-screen checks and 15 dialog/connection/invite/duplicate checks. Before stacking the editor change, the full frontend suite passes 1,398 tests and the production build passes. Only five editor-owned diagnostics remain at that intermediate point; the editor change reconciles them. Final stacked lint/CI evidence is recorded below and in the PR/tracker.

This reconciles the bounded lint inventory and related defects; it does not claim to eliminate every possible application race. Automated checks do not replace physical-device acceptance.

Final stack on editor commit `5badf639`: **0 ESLint diagnostics, 0 regression-gate increases, 1,419 frontend tests passing (190 files), production TypeScript/Vite build passing**. The obsolete baseline is now empty; all new diagnostics still fail the existing gate. Independent source reviews and targeted failing/passing controls precede this full run. The PR is intentionally based on `separate-line-review-owners` so editor fixes appear once in review; integrate that predecessor before retargeting this PR to main.
