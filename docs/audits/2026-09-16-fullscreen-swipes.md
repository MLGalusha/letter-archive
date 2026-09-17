# Fullscreen fit-view swipes (#23)

Initial base: PR113 `280f7061` (image scheduler/retry candidate). Its later rebases were reported patch-equivalent; retry and resolution logic is retained. Scope: LetterViewer fit-view navigation, separate from public page swipes (#21).

## Observed problem

The old release handler immediately changed the image index and removed the drag offset. In Chromium at390×844, a150px drag showed the first image at `translateX(-150px)`; immediately after release the source was already the second image at zero offset. There was no committed swipe carriage animation. Snap-back also removed its transition condition when its target offset reached zero.

A second finger started pinch handling without clearing an existing swipe. Moved pan gestures also retained their timestamp as if they were taps, which could trigger a false double-tap when the next gesture began nearby.

## Bounded change

- `useViewerSwipe` owns only fit-view directional lock, displacement and completion. It uses the same20px/1.8-ratio axis helper as the other carousel work. Zoomed images still pan; they do not change pages through a swipe.
- A horizontal drag moves one `translate3d` carriage. Release travels to the adjacent page over230ms using a transform easing curve, then commits the page/reset together. Under-threshold release animates back to zero. Commit threshold is15% of viewport width, capped at72px (58.5px at390px, previously78px). This makes the required distance smaller; subjective comfort is still a device check.
- At most two decorative neighboring previews appear during drag/settling. Their800px source uses the same `ADJACENT_SCAN_WIDTH` constant as existing neighbor prefetch. They are not original scans and do not add another resolution policy. Existing current-image progressive loading and bounded retry still own the committed page.
- Pinch, touch cancellation, zoom controls and page buttons cancel pending swipe work. Buttons remain immediate. A second swipe during settling cannot queue an extra page change. Content replacement/unmount clears animation work; a310ms fallback prevents missing transition events from locking the viewer. Reduced motion commits immediately.
- The current image keeps its zoom/pan transform separately. Panel mode uses `display: contents` for the new wrapper to retain the existing image flex layout. No page-level navigation changes.

## Review correction

The first candidate gave neighboring previews desktop margins on phones, so an incoming preview would expand at commit. Independent review caught this. Current, thumb and neighboring images now share both desktop and mobile fit selectors. Both Chromium and WebKit measured incoming374×498.8125px versus committed374×498.65625px: same width and less than0.2px height difference from variant rounding.

## Validation

- 29 targeted tests pass, covering11 gesture cases plus reader resolution/progressive-image contracts.17 gesture/reader tests also passed independently.
- Cases include delayed commit, under-threshold snap-back, vertical/diagonal intent, zoomed pan, pinch takeover, double-tap, moved-pan tap reset, touchcancel, rapid repeat, immediate button interruption, missing transition fallback, source replacement, unmount, reduced motion and bounded displayed-image retry after commit.
- Production build/typecheck and lint pass:102 existing diagnostics, zero increases.
- Chromium and WebKit at390×844: synthetic gestures show the first image retained while a230ms carriage transition starts, then the second page at fit scale and zero offset. Settled zoom/pan and pinch cases preserve page identity. These are engine/DOM-event checks, not physical touch acceptance.
- Chromium native CDP touch dispatch with coarse-pointer emulation also committed a horizontal swipe to page2, then pinched to200% without changing page2 or leaving carriage displacement.
- The WebKit fit screenshot was inspected; the scan remained fitted between its existing controls. Read-only public letter `0b5e626d-01bb-4026-a4fa-a6ebdf180c7d` supplied browser content through a local frontend; non-GET API calls were intercepted locally.

Browser scripts/results remain under `output/playwright/`: `viewer23-before.txt`, `check-viewer-swipes.js`, `viewer23-{chrome,webkit}.txt`, `check-viewer-fit.js`, `viewer23-fit-{chrome,webkit}.txt`, `viewer23-native-chrome.txt`, and `viewer23-fit.png`.

## Limits and remaining manual acceptance

No60fps claim is made. Desktop WebKit at a phone-size viewport is not physical Safari; Chromium CDP input is also emulation. On iPhone13 Safari and Chrome, check fast/slow fit swipes both directions, short snap-back, zoomed pan, pinch during a partial swipe, double-tap, rapid repeat, buttons during animation, and closing/reopening the viewer. Confirm perceived responsiveness and frame pacing on the device.

Neighbor URLs reuse existing bounded prefetch, but two temporary DOM images may add decode/compositing work and cache behavior is environment-dependent; this audit does not claim fewer network requests, lower bytes or measured frame-time improvement. Adjacent previews use the shared capped retry wrapper and hide a failed image during backoff. A short gesture may finish before a retry, leaving a blank preview temporarily; after commit the unchanged main-image retry path handles recovery. Cold image loading can still delay detailed pixels even when navigation animates correctly.

## Latest retry integration

Locally rebased onto reviewed PR 113 head `4e1852a3` before its merge. Its latest initial-thumb and minimap `RetryingImage` replacements are retained. Decorative 800px swipe neighbors use that same bare-image wrapper; a gesture regression confirms failed-image hiding, same-URL recovery during a held swipe, and pending-retry cancellation on commit. The sole conflict was the new failed-image status message next to the carriage closing tag: the message remains beside the displayed image inside the carriage, and `displayedRetry.failed` still hides a broken image during backoff. The parent's visible-placeholder retry keys, failure state handling, progressive image component, and reader retry tests remain unchanged. All 36 focused gesture/reader/progressive/retry tests, frontend build, and lint passed after integration (102 existing diagnostics, zero increases). The earlier browser measurements above describe the swipe candidate before this parent rebase; no new physical-device or animation-performance claim is made.
