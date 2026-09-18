# Shared scan page picker (#155, #157)

Approved design: C1 plain Close icon, P2 Pages button reveals thumbnails. The
inline reader now shares ViewerPageDrawer with fullscreen. Both use thumbnail-only
visuals, accessible scan/type names and selected-state borders. The main reader
keeps a compact previous/count/next/Pages row regardless of collection length.
The inline drawer scrolls horizontally at every breakpoint; fullscreen preserves
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
