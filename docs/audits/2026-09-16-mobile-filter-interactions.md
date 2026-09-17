# Mobile filter interactions (#12)

Baseline: main `5a54cce0`. On the live Home page, WebKit with the iPhone 13 profile reproduced both reported failures: tapping the main search field left filters open, and the panel had 936px of content in a 529px client area with `overflow-y: auto`.

## Change

At the existing phone breakpoint (700px), focusing or clicking the main search field dismisses refine and sort panels. It does not clear selected filters. The focus event comes after the outgoing year field's blur, preserving valid draft commits. Desktop behavior stays unchanged.

On phones, the refine overlay grows with content and uses the existing page scroller. Expanded choices occupy the full available row and flow within the panel, with no independent choice-list scrollbar. Choice buttons, filter inputs, format chips, and Clear All have at least 44px height. The panel remains an overlay rather than moving result cards. No bottom sheet, viewport compensation, or new scrolling system was introduced.

## Validation

- 37 focused search/choice tests passed, including new controlled full/compact dismissal, year draft preservation, repeated input clicks, sort dismissal, and desktop retention. TypeScript and production build passed.
- Chromium and WebKit checks each covered Home with `q=he` and Collection 003 with a no-result query, at widths 320, 390, and 1440px. Local frontend requests used read-only public API responses through a browser test route; this is not a production deployment or latency measurement.
- At both phone widths, expanded panel and option content fit their own client heights (`overflow: visible`), Clear All was reachable through page scrolling, no document horizontal overflow occurred, and choice buttons measured at least 44px. Tapping main search closed the panel. At 1440px the filter panel stayed open when search was focused, preserving desktop behavior.
- Example WebKit expanded heights: Home 1347px at 320px and 1234px at 390px; the no-result collection panel 1329px and 1150px. Those are intentionally page-scrolled content, not viewport-height dialogs. Desktop panels remained 492px tall with the existing nested choice behavior.
- Artifacts and the reproducible browser check are in local `output/playwright/`. A development image telemetry request returned 400 before telemetry was intercepted for the test; no claim of a completely clean production console follows from this local harness.

## Manual acceptance after deployment

Use Safari and Google Chrome, including the physical iPhone 13. Open [Home](https://voicesthatremain.com/) and [Collection 003](https://voicesthatremain.com/collections/003), expand filters and Topic, and scroll to Clear All. The page should scroll naturally without a small inner scrolling box. Select options, then tap the main query field: panels should close, the query should receive focus, and selected filters should remain. A valid year typed immediately before the tap should be retained when filters reopen. Also test zero-result searches.

The physical iOS keyboard/visual-viewport problem is separate (#42) and remains unverified here. These browser checks do not substitute for the phone checks in `docs/qa/public-site-checks.md`.
