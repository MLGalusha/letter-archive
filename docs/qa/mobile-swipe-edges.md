# Mobile swipe edges (#180)

## Behavior and scope

Homepage hero cards and inline reader scans can move to the mobile screen edges instead of disappearing at the page gutters. Resting card/image dimensions, reading text, navigation controls and header retain their original geometry. The homepage now has a gutter-sized space on each side of its moving card slots; its activation distance remains 20% of the original inset wrapper.

The homepage viewport extends beyond its wrapper; each slide restores the original content inset. Translation combines a percentage for the current slide with the pointer's displacement in pixels, so a wider track does not amplify dragging. The wrapper still owns the existing gesture threshold and dot layout.

The inline scan scroller extends beyond its figure and restores the inset as internal padding. The figure continues to own image dimensions through its existing container sizing. Equal extension on each side keeps the scroll center aligned with the original content center even when safe-area insets differ; the public page shell clips excess at the viewport boundary. Native snapping and explicit page selection therefore use the same center without changes to the motion hook.

## Parallel-work boundaries

- PR #179 owns scan/thumbnail synchronization, momentum, zoom and viewer gesture controllers. This change does not edit its application files or existing test files.
- Issue #178 / PR #181 owns busy-state fading and the loading line. The shared `LetterDetailPage.css` edits are confined here to the mobile gutter and carousel rules, away from pending/status rules.
- Work is isolated on `mobile-swipe-edges`. Production, other worktrees, fullscreen styling, thumbnail strip layout and loading behavior are outside this change.

## Verification

September 18, 2026, local macOS Chromium and WebKit:

- Production frontend build passed; frontend lint reported no increase over the existing baseline.
- Existing InfiniteCarousel unit suite: 21 passed.
- New edge regression suite plus existing scan paging suite: 42 passed across Chromium/WebKit.
- New coverage measures original versus updated resting bounds, hit-tests both screen edges during motion, checks exact pointer displacement, unchanged activation distance, below-threshold return, infinite wrapping and drag click suppression. It also checks first/middle/last scan centering, fullscreen entry, no document overflow, reduced motion, synthetic asymmetric safe areas and responsive widths 320–1280px.
- External font delivery is blocked in the geometry regression fixture to keep late font swaps from changing line wrapping between measurements. Image bounds allow less than one CSS pixel for decoded aspect-ratio rounding; control/card positioning remains checked. The scan fixture returns to the page top and waits for the scroll-responsive header animation before comparing bounds.

The test configuration includes the new file in regular Chromium and WebKit mocked CI. The browser regressions use mouse interaction and controlled intermediate scan scrolling; they do not certify physical finger momentum or native browser chrome.

## Manual acceptance still required

On an actual iPhone, check Safari, Home Screen and Chrome separately: slow horizontal drag, flick, reversal, cancellation, first/last scans, homepage wrapping, vertical scrolling from an image, tap-to-fullscreen and rotation. Confirm the homepage inter-card space feels right. Synthetic inset checks are geometry evidence, not notch/browser-toolbar acceptance. Issue #180 remains open for this acceptance; no deployment is implied by the local results.
