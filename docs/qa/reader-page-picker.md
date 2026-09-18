# Shared scan page picker (#155, #157)

Approved design: C1 plain Close icon, P2 Pages button reveals thumbnails. The
inline reader now shares ViewerPageDrawer with fullscreen. Both use thumbnail-only
visuals, accessible scan/type names and selected-state borders. The main reader
keeps a compact previous/count/next/Pages row regardless of collection length.
The inline drawer scrolls horizontally at every breakpoint and allows vertical
scroll chaining into the letter; fullscreen preserves
its existing horizontal-phone/vertical-desktop layout. A centered SVG replaces
the font-based multiplication character in a transparent 44px Close hit target.

## Selection and measurement

The earlier controlled 24-scan audit showed four rows of number buttons (188px
high at 390px) and long smooth scrolls on distant selections. Direct selection
now targets the chosen scan immediately instead of traversing intervening scans.
The active index/image admission updates in the same action. Native touch and
trackpad scrolling retain scroll snap; other hook callers retain their default
smooth behavior. Selecting an already-visible thumbnail does not recenter the
thumbnail strip.

At 320, 390 and 1440px, Chromium and WebKit checks establish:
- The collapsed control row is at most 48px high with 24 scans.
- Thumbnails overflow only inside their own horizontal strip.
- Rapid selections 24 -> 1 -> 13 -> 3 -> 24 arrive within two animation frames,
  with less than 1px center error and the correct page count.
- Page selection preserves document position within 1px, including partially
  visible scans and reduced motion. Last/first wrapping remains available.
- Image admission remains bounded and respects reduced-data preferences.

This isolates navigation delay from network/decoding delay. It does not claim
uncached originals load instantly or certify physical iPhone swipe feel.

## Validation

Frontend reader/carousel units: 28 passed. Focused browser coverage: 76 passed,
two intentional CDP-only WebKit skips after scoping fullscreen Pages locators to
the dialog. Production build and lint regression checks passed. Visual review
used actual public letter imagery at phone and desktop widths; local captures
are under output/playwright/page-picker. Native phone browser chrome is not
represented in these desktop screenshots.

A manual wheel probe caught inherited fullscreen scroll containment trapping
vertical reading over inline thumbnails (scrollY stayed 0 after a 350px wheel).
The inline variant overrides vertical overscroll containment. That regression
failed before the override and passes in Chromium and macOS WebKit.

CI runs 35376909819 and 35379185545 failed the native wheel assertion in Linux
WebKit at all three widths. Isolated reproduction in the official Playwright
1.58.2 Linux image showed this also affects a bare 3000px-tall page: with
`html { overscroll-behavior: none }`, a 300px wheel leaves scrollY at 0; removing
that rule yields scrollY=300. The body-only rule also yields 300. The same real
reader remains stuck after reload, despite no modal, no inert elements, restored
styles and uncancelled wheel events. Changing thumbnail containment did not help.
This is a bundled Linux WebKit limitation, not evidence of a viewer cleanup bug.
The trial thumbnail CSS changes were reverted; production root behavior remains.

The unchanged wheel assertion now lives in scan-reading-scroll.mocked.spec.ts:
Linux Chromium still runs it, and a required macOS WebKit CI job runs it without
retries. Production release depends on this job. Other reader WebKit coverage
continues on Linux, including all compact paging and position assertions. This
keeps native scroll coverage on the platform closest to Safari, as recommended
by [Playwright browser documentation](https://playwright.dev/docs/browsers#webkit).
Local checks passed 24/24 without retries during isolation. A separate earlier
macOS WebKit newContext process failure recovered on an isolated rerun; this is
recorded as environment recovery, not an application fix.

The paused-swipe measurement now waits for the rendered drag offset before its
intentional pause, instead of assuming the animation frame ran within 120ms.
That adjustment passed both subsequent Linux runs without a retry.

Review found that the shared thumbnail error label inherited near-white text on
the inline near-white surface. The inline variant now uses the public muted-text
token (#6d5f51), giving 5.93:1 contrast against #fffaf2 instead of 1:1. An aborted
thumbnail request confirmed the real error message and computed colors in the
browser; the fullscreen error styling remains unchanged.
