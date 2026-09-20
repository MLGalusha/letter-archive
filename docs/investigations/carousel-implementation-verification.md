# Shared card carousel implementation

Implemented locally on `ui-next-pass`, based on merged PR #188 (`54a71a7f`). Preview: http://localhost:5177/. PR #189 is open for review and later deployment. No merge or deployment was initiated.

## Behavior

- Homepage and collection highlights share `CardCarousel`, including frame clipping, native touch/trackpad scrolling, dots, keyboard navigation, and mouse drag handling.
- The outer frame has a 24px radius. Moving slides have square edges and no gap. Page-specific dimensions and content styling remain in the pages.
- Navigation is manual and finite. Autoplay, loop clones, touch-direction classification, distance thresholds for touch, and wheel cooldowns are removed.
- Desktop arrangements are preserved. The same content stays mounted across the 640px breakpoint, preserving selected media and the selected mobile slide.
- Active-slide focus restrictions prevent navigating into hidden slides. Dot buttons have explicit appearance and 24px hit targets. Modified link clicks and the inner page-arrow controls retain their behavior.
- `CardMediaImages` and `useMediaSelection` share bounded image preparation and identity-based selection. Current and adjacent images are retained (at most three per card), with only the current image exposed to assistive technology.

## Measured geometry

Desktop Chromium, 390px viewport with a 15px browser scrollbar:

| Measurement | Before | After |
| --- | --- | --- |
| Homepage visible card dimensions | 343 × 404.75px | 343 × 404.75px |
| Homepage gap during movement | 32px | 0px |
| Collection visible card dimensions | 343 × 440px | 343 × 440px |
| Collection gap during movement | 0px, individually rounded cards | 0px, square adjoining edges |
| Moving card corner radius | 24px | 0px |
| Stationary frame radius | 0px | 24px |

Live-data geometry inspected at widths 320, 390, 430, 640, 641, 900, and 1280px; no document horizontal overflow. Desktop/static card radii and layouts remain page-owned. Dot circles retain their sizes and colors, with slightly wider spacing for larger, nonoverlapping hit targets.

Artifacts in `output/playwright/`: `cards-after.txt`, `home-mid-after.png`, `collection-mid-loaded.png`, `home-desktop-final.png`, and the resting captures. Historical baseline evidence remains alongside these files.

## Verification

- 31 targeted component/page tests passed: carousel behavior, media preparation, selection on data changes and responsive layouts, existing homepage and collection behavior.
- Production build passed.
- Project lint gate passed with zero file/rule increases. Existing repository diagnostics remain unchanged or reduced.
- 23 focused browser scenarios passed across Chromium and WebKit (one additional WebKit CDP-only check intentionally skipped). The final geometry rerun passed all eight width/engine combinations after removing an external font-loading race from the fixture. Browser checks cover manual/no-autoplay behavior, finite keyboard endpoints, mouse drag without accidental link activation, interrupted/reversed paging, clipping/seams at mobile widths, and selection across responsive layout changes.
- Native diagonal touch input was exercised using Chromium CDP: content moves during the drag and reaches the next card without navigating to a different collection. This input-delivery check is intentionally unavailable in WebKit.
- Native horizontal wheel scrolling and vertical page scrolling passed in desktop Chromium and WebKit. A first WebKit attempt in mobile emulation did not advance; testing wheel behavior in its desktop context passed without an application workaround.
- Existing reader-edge geometry and asymmetric-inset checks passed in Chromium and WebKit.
- Broader mobile-layout suite: 24 passed, 3 intentional project skips, covering Chromium/WebKit phone profiles and desktop Chromium.

A synthetic 55px touch flick initially snapped back. The browser now decides the endpoint from native input rather than the old application threshold; this was not treated as evidence that every short synthetic flick must advance. The acceptance test instead observes continuous diagonal touch scrolling and a completed swipe. Physical short-flick feel remains part of device acceptance.

## Remaining device acceptance

Physical iPhone Safari, Home Screen mode, and Chrome have not been tested in this task. On each, check the homepage and collection highlights with slow drags, short flicks, diagonal starts, vertical page scrolling, reversals, inner page arrows, and ordinary taps to open a letter. Browser automation and macOS WebKit results do not certify physical-device feel.

## PR self-review (September 20)

- Reproduced a stale mouse drag in Chromium and WebKit: press near the frame edge, leave vertically, release outside, and reenter. The pointer handler now checks whether the primary mouse button is still held before dragging. The regression failed on both engines before the fix and passed afterward.
- Reproduced intermittent rapid dot reversal failures in WebKit. Instrumented scroll calls ruled out an extra application realignment; disabling snapping during explicit smooth navigation passed six WebKit reproductions. Explicit navigation now temporarily owns its destination, restoring native snapping on completion or gesture interruption, while ignoring stale completion events from canceled requests. Twelve repeated cross-browser reversal checks passed, followed by the complete carousel file: 25 passed, one intentional CDP/WebKit skip.
- Assigned native WebKit wheel coverage to the existing macOS CI job. The Linux WebKit wheel limitation is already isolated in `docs/qa/reader-page-picker.md`; Chromium continues to cover wheel input in Linux. The new macOS project passed locally.
- Full frontend unit run: 1,330 tests passed; 37 API assertions initially failed because this worktree's preview points at port 3005 while their contract expects 3002. With `VITE_API_URL=http://localhost:3002`, all nine affected files plus the carousel tests passed (55 tests). No application or API-test changes were needed for this local configuration issue. The final carousel unit rerun passed all six tests.

The PR is intentionally left unmerged. CI status is checked once at review completion; pending runs are not watched.
