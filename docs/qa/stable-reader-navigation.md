# Stable reader navigation and keyboard contract

September 18, 2026. Follow-up to the A3 reader PR #165; addresses #152/#159.

## Ownership

Letter detail and adjacency still fetch independently with their existing abort
and stale-response guards. The page retains a presentation of the last committed
navigation until replacement adjacency resolves. Retained controls are disabled
with `aria-disabled` and guarded callbacks, preserving the actual focused node.
They cannot navigate stale destinations. A known cross-collection detail clears
unrelated old navigation; a null/failed adjacency resolves to no scrubber. Error
states clear retained context. Collection identity also comes from current detail,
so single-letter collections retain the singular Collection link. Fresh adjacency
counts override stale collection-list counts; a mismatched cache cannot enable
seeking or revive a removed sibling.

Collection detail keeps HeaderDock at the same React position in loading, error
and success branches. Its navigation hook retains only a disabled presentation
while fetching a fresh list, and keeps the actionable adjacent result empty until
that fresh request succeeds. Failure and A→B→A generation protection remain intact.

## Interaction

The shared slider commits bounded ArrowLeft/Right/Up/Down, Home and End targets.
The separate arrow buttons keep their documented wrap behavior. Missing full-list
data disables seeking while current adjacent buttons can still work. Pending
navigation blocks repeat actions and reports the prior position as loading.
Handled slider keys cannot bubble to the page's letter shortcuts. Pointer buttons
explicitly preserve focus without scrolling, including WebKit. Hidden headers and
collapsed mobile docks are inert; desktop docks remain keyboard reachable.

This follows the [WAI slider keyboard pattern](https://www.w3.org/WAI/ARIA/apg/patterns/slider/),
checked September 18, 2026. Physical mobile assistive-technology behavior remains
a separate acceptance check; the APG itself calls for touch-AT testing.

## Verification

- Shared-control unit tests: six keys, limits, >30-item window, retained focus,
  guarded pending callbacks and resumed activation.
- Existing request generation and stale/failure tests preserved.
- Browser checks in Chromium/WebKit at 390 and 1440 verify identical connected
  slider node, unchanged retained heading geometry, focus, singular collection
  link, independent detail/adjacency release, keyboard navigation, cross-collection
  single-item clearing, Back, and mobile inert versus desktop availability.
- Collection browser case independently holds its new overview and fresh list,
  preserving the same focused slider through both releases.

CI, review and delivery evidence belong in the PR. Physical iPhone/PWA/VoiceOver
and full gesture feel are not certified by desktop engine automation.
