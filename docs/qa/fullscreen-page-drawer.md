# Fullscreen page drawer (F2)

User selected F2 on September 18, 2026, explicitly requesting a redesigned mobile
swipe and a Close control clear of the notch/battery area. Baseline main/frontend:
`bde98e713a6b1e13c878fc3cb449693927068415`. Related #157 and physical-device #149/#150.
N1/N2 end-of-letter navigation is outside this change.

## Ownership and invariants

The public modal owns all four safe-area insets and its dynamic viewport height.
Its title/Close row is normal flow. The viewer owns a grid with one image stage,
an optional page drawer, and a reserved toolbar. Drawer scroll is native and local:
horizontal below the image on phones, vertical beside it at 760px and above.
Opening Pages resizes the image stage; it never covers text in the scan. Controls
have at least 44px targets. Escape, isolation, focus trap and return to the actual
opener reuse the existing dialog lifecycle. Admin panels retain their original
controls and saved view; public fullscreen must not write their localStorage state.

The carousel carriage owns fit-page translation. A stable fitted surface inside it
owns zoom/pan; URL/retry-specific images remain inside that surface. Replacing a
rendition cannot reset its transform. Existing measured rendition selection,
active-first admission, bounded neighbor preloading and retries remain in place.
Pages uses the existing PreviewImage with a small drawer-specific preload margin
and 200px renditions, mounted only after the drawer opens. No new image queue.

## Gesture contract

- Fit: follow horizontal movement after 8px of clear intent. Recent velocity can
  commit a short flick; pausing removes stale velocity. A small release returns.
- Settling is interruptible: a new finger starts from the rendered carriage offset
  and cancels the old completion. Remaining travel determines settling duration.
- Zoomed: single-finger movement pans, never pages. Pinch takes ownership from a
  partial swipe. Double-tap/click zooms; direct manipulation interrupts a running
  zoom at its visible transform. Explicit +/- and Fit provide alternatives.
- Page selection by arrows, keyboard, drawer or swipe resets to Fit. Buttons wrap
  consistently with the existing reader. Drawer buttons keep native Tab/Enter;
  its scroll keys do not also run global scan navigation.
- Touch cancellation, page changes, content changes, viewport/drawer resizing and
  unmount cancel gesture work. Reduced motion removes settle/zoom interpolation.

## Before/after evidence

A Chromium CDP inset regression reproduced Close at y=12 despite a 59px top safe
inset; expected y>=59. This is CSS geometry injection, not an iPhone simulation.
A unit gesture regression reproduced a second drag being ignored during settling:
the transform stayed at its -390px target instead of returning with the new drag.
Both regressions were written before the implementation. A third regression
showed two fingers moving together left the scan stationary; the pinch handler
now tracks the previous midpoint as well as distance.

Existing focus checks caught missing explicit keyboard tab stops in WebKit after
the new controls were introduced; restoring explicit tab stops preserves the prior
viewer contract. Zoom retry tests retain source-owned remounts while asserting the
transform surface stays connected. Delayed-upgrade browser coverage keeps the
clear preview visible and verifies no scale/width change when the new tier loads.
Tests additionally cover mixed portrait/envelope ratios, narrow and short screens,
local/bounded drawer loading, rapid swipe takeover, pan/pinch isolation, reduced
motion, focus/scroll restoration, and panel image request behavior.

Exact commands/results, review, final CI and release revision belong in the PR.
Screenshots/probes are local under `output/playwright/fullscreen-page-drawer/`.

## Primary-source research

- [WebKit: designing for safe areas](https://webkit.org/blog/7929/designing-websites-for-iphone-x/):
  viewport-fit cover requires important controls to respect inset values. Apply
  them once to the modal's content bounds, including landscape left/right edges.
- [MDN touch-action](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/touch-action):
  gesture ownership must be declared before the gesture; the app's pan/pinch stage
  retains touch-action none, while the separate drawer uses native scrolling.
- [MDN pinch zoom](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events/Pinch_zoom_gestures):
  cancellation and multi-contact ownership need explicit cleanup. This change
  retains the existing native touch handlers rather than mixing another event stack.
- [MDN CSS transitions](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@starting-style):
  initial insertion differs from an existing element's style change. Keep the
  transform surface stable; do not add entry animation to conceal rendition remounts.

These sources establish browser mechanisms. F2 and the gesture thresholds are
product choices validated by our cases, not universal prescribed values.

## Physical acceptance still required

On the user's phone, separately check Safari, installed Home Screen/PWA and Chrome:
Close below the battery/notch in portrait and landscape; expanded/collapsed browser
controls; first/repeat open; slow/failed images; short flick, long drag, reversal,
pinch takeover, zoomed pan, Pages strip; changing page at zoom; closing at a nonzero
reading position; VoiceOver controls. Desktop WebKit, CDP insets and synthetic
touches cannot certify native toolbar or perceived touch smoothness.
