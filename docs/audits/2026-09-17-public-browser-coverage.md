# Public Safari and Chrome coverage

The supported-browser goal applies to the whole public site, including desktop Safari/Chrome and both installed browsers on Mason's iPhone 13. WebKit/Chromium automation supplements physical acceptance; it does not simulate iOS's keyboard, browser chrome, safe-area behavior, or compositor faithfully.

The existing mocked public archive suite now runs in both Chromium and WebKit in CI. The extra WebKit project is intentionally limited to three existing checks: native new-tab destinations, search URL/input/request synchronization through Back/Forward, and one-size/deferred archive previews. Admin suites retain their existing Chromium coverage. Browser installation is explicit in the mocked job; the required job name is unchanged.

Local validation: all six targeted checks passed (three Chromium and three WebKit), sequentially, with the repository's pinned Playwright browsers. The initial WebKit run exposed two fixture assumptions: middle-click did not open a tab in that harness, and its synthetic SVG reported a layout-dependent natural width. The native-link check now uses Control/Command-click in both engines; a tiny deterministic 480×640 PNG preserves the exact decoded-width, deferred-src, request-width and one-request-on-return assertions. No application behavior changes are included in this coverage change. Linux CI validation is still required on the final PR head.

## Reconciled placement ticket (#13)

The requested mobile floating-button rule was already implemented in `36c1c95a`: both controls use `bottom: calc(0.75rem + env(safe-area-inset-bottom, 0px))` below 768px. Current Chromium/WebKit checks at 320/390px measured both visible controls 12px above the viewport bottom; 1440px retained 24px. No horizontal overflow was observed. The test traversed the collection search panel before scrolling below it and back up to reveal the control. Source/history and closure reasoning were independently reviewed; no new style fix is claimed. Physical-phone comfort/nonzero safe areas remain manual checks.

A separate observation: jumping directly from above the search panel to the page bottom can skip its IntersectionObserver boundary, leaving Back to Search hidden. This was observed with programmatic jumps, not yet established as a normal touch-scroll bug; it is not a placement regression or proof of the iOS animation report (#38).

## Unconfirmed collection reports

For #46, a 390px collection003 dot transition produced 146 Chromium and 142 WebKit dot/frame samples over 1.2s. Measured heights ranged 7–9.45px with no vertical overflow against clipping ancestors. The active dot changed correctly. This was a button-driven transition, not physical iPhone swipe/compositor evidence, so the intermittent clipping report remains open.

For #48, the same settled view used 14.08px text/22.528px line height for both stats line and format breakdown in both engines. This single settled-state observation does not establish cold-font/orientation/text-autosizing behavior. The intermittent report remains open; no speculative CSS patch was applied.
