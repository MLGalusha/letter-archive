# Explicit mobile letter navigation (#21)

Baseline: main `5c7a9654`. The current detail page uses `.letter-nav-section` and `.adjacent-teasers`; the older `LetterNav` component named in the issue is not mounted there.

The article-level swipe hook intercepted horizontal transcript touches and animated the entire article before changing letters. Removed that call, its touch-device/import wiring, and the article transform/ref. Header scrubber controls, bottom links, keyboard arrows, and the existing stale-navigation guards remain. The shared swipe hook and fullscreen `LetterViewer` are unchanged. Scan dragging and indicators are separate from this page gesture.

## Measured spacing

Before the change, the footer links had no horizontal padding at widths 320, 390, and 844px. WebKit measured 0px clearance on both sides. Desktop Chromium measured 0px left and 15px right; the right-side space was its native scrollbar gutter, not navigation padding.

Added `padding-inline: 1rem` to the actual navigation section through the existing 900px breakpoint. At all three narrow widths, links now have 16px space on both sides of the available content area. Chromium's viewport-relative right measurement is 31px including its 15px scrollbar. At 1440px the existing positions were unchanged (Chromium 256.5/271.5px; WebKit 264/264px). No horizontal document overflow was measured. Existing top spacing and article bottom padding remain. The independent transcript-gutter change in #22 is not included here.

Final review corrected the gutter to `calc(1rem + env(safe-area-inset-left/right, 0px))` on each physical side. The detail page bypasses the shared body-layout inset, and `viewport-fit=cover` can otherwise place landscape iPhone links under the cutout. Zero-inset browser geometry remains unchanged; physical iPhone landscape acceptance must confirm the device-provided insets.

A focused fixture using the actual detail-page stylesheet and footer markup measured 16/16px at 844px in Chromium and WebKit. Chromium's native safe-area override of 47px left/21px right produced 63/37px card gutters, with no horizontal overflow; at 1440px the existing 264/264px positions stayed unchanged. This verifies CSS environment-variable handling under emulation, not physical-device or full-page acceptance. Script and results: `output/playwright/check-footer-safe-area.cjs` and `footer-safe-area.json`.

## Verification

- The new touch regression failed before the change because the move event was prevented. Afterward all 16 focused detail-page/shared-swipe tests pass. Tests retain the stale-route guard and verify the newly loaded route's keyboard target; an explicit bottom-link click still loads the next letter.
- Frontend production build passes. Lint reports 102 existing diagnostics and no file/rule increases.
- On the local frontend using read-only public API responses, Chromium and WebKit both received horizontal-left, horizontal-right, and vertical DOM touch sequences on transcript text. None was prevented, no article transform appeared, and the URL remained unchanged after the old animation interval. Bottom Previous, keyboard ArrowRight, and header Next each navigated to the expected public letter. These are synthetic event checks of application handling, not physical touch claims.
- Chromium CDP touch emulation additionally performed an actual vertical drag (335px scroll change) and horizontal drag without letter navigation or article movement. WebKit used Playwright's iPhone 13 profile. Neither environment establishes physical iPhone Safari/Chrome behavior.
- Both engines' footer screenshots were visually inspected. Local scripts, before/after measurements, interactions, screenshots, and test/build/lint logs are preserved under this worktree's `output/playwright/`; `navigation-evidence.json` combines the numeric results.

## Manual check after deployment

Open [the October 18 letter](https://voicesthatremain.com/letter/0b5e626d-01bb-4026-a4fa-a6ebdf180c7d) in Safari and Chrome on the iPhone 13. Swipe across transcript text: it should remain the same letter; normal vertical reading scroll should work. At the bottom, both navigation cards should have space from the screen edges in portrait and landscape. Tap Previous/Next and use the header scrubber to change letters. Open a scan fullscreen and verify its separate page gesture still behaves as before. Desktop keyboard arrows remain available when an editable field is not focused. Deployment and physical-device acceptance are pending.
