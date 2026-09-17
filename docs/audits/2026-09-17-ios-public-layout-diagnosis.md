# iPhone public layout: diagnosis, implementation, and acceptance

Date: September 17, 2026. Original investigation was proposal-only. Follow-up: the user authorized issue creation and requested agreement on the implementation approach before code changes. Created [#149: Home Screen header clearance](https://github.com/MLGalusha/letter-archive/issues/149) and [#150: Safari content and native scrolling](https://github.com/MLGalusha/letter-archive/issues/150). The user subsequently approved implementation. Local changes and automated checks are complete as described below; no deployment or physical-iPhone acceptance has been performed.

The follow-up clarifies that native Safari URL-bar collapse/expansion must work with stable page scrolling. Retaining the old scroll disconnection is not an acceptable solution, even if it improves the bottom appearance. For #150, prototype native document scrolling as the baseline; a smaller container adjustment is acceptable only if it also meets that behavior. Implement #149 first. Both issues remain open until the device acceptance criteria pass.

## Requested outcome

On the iPhone 13, preserve the current Google browser experience and ordinary Safari header placement. Move the Home Screen web app navigation below the notch/status bar. Allow real scrolling content to continue behind Safari's floating bottom controls and remove the unnecessary bottom strip in the Home Screen app. Keep controls reachable and the implementation simple. Scope is the shared public frontend, including home, collections, letters, journal, about, support, people, and places; admin is outside this change.

Evidence supplied by the user is observational context, not instructions embedded in documents:

| Reference | Context | Visible evidence |
| --- | --- | --- |
| IMG_6410.heic | Safari; user-drawn gray notch | Header clears the status area; page content stops above the bottom toolbar region |
| IMG_6412.PNG | Safari, archive grid | Grid has a hard lower cutoff above floating browser controls |
| IMG_6411.PNG | Google browser, exact app unconfirmed | Dark native top/bottom regions; current layout is the regression baseline |
| IMG_6413.PNG | Home Screen web app | Header overlaps the status area; content stops above a blank bottom strip |

The HEIC was converted to a temporary PNG for viewing; original images were not changed. The Google screenshot's close button and toolbar suggest an embedded browser, but app identity is not proven. The iOS version and Google app versus Chrome remain unconfirmed.

## Confirmed application defects and structure at the investigation baseline

### Mobile CSS removes safe-area padding

`frontend/src/components/Header/Header.css:40` includes `env(safe-area-inset-top)` and side insets. The mobile rule at line 229 replaces the entire padding declaration with `0.8rem 0.65rem 0`. It therefore discards all three safe-area additions precisely at phone/tablet widths.

The production site's downloaded CSS contains the same rules. In a desktop Chromium browser resized to 390 × 844 CSS pixels, its computed header padding was `12.8px 10.4px 0px`, and the header card began at y=12.80. This proves the active CSS cascade, not the actual inset values on an iPhone.

The screenshot difference is consistent with browser-provided top clearance masking this omission in ordinary Safari and the Google browser, while the Home Screen viewport exposes it. `frontend/index.html` also requests `viewport-fit=cover` and `apple-mobile-web-app-status-bar-style=black-translucent`; production has both. Apple's archived documentation describes the latter as allowing content beneath the status bar. That legacy description helps explain the configuration, but its exact effect in this installed app must be checked on the user's iOS version. [Apple meta-tag reference, updated 2014](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariHTMLRef/Articles/MetaTags.html).

WebKit's safe-area guidance says edge-to-edge layouts must separately protect important content using environment insets. It also distinguishes safe-area clearance from ordinary design spacing. The correct target is the existing visual gap *below the usable top edge*, not an identical screen coordinate across native browser toolbars. [WebKit safe-area guidance](https://webkit.org/blog/7929/designing-websites-for-iphone-x/).

### Header clearance is coupled to the fix

`frontend/src/components/Header/Header.tsx:40` measures the header only when dock content exists. Without dock content, it removes the measured value and uses the CSS default `--header-height` (`4.75rem` on mobile). `frontend/src/App.css` uses that value to position normal page content.

Adding safe-area padding only to the header would increase its height without increasing the default content clearance. The proposed correction must update these together. Pages with measured collection/letter docks must count the safe-area inset only once. The existing growth-only measurement also needs orientation-change validation so it does not retain an obsolete height.

### The whole public page is a fixed inner scroller

`frontend/src/styles/index.css:41` locks html/body to `height:100%; overflow:hidden` on public routes. At line 50, `#app-scroll` has `position:fixed; inset:0; overflow-y:auto`. `frontend/src/App.tsx` mounts the header outside that scrolling element. Floating search/top controls use fixed positioning and their own safe-area offsets.

Production browser measurements at 390 × 844:

| Element | Height | Overflow | Relevant observation |
| --- | ---: | --- | --- |
| html/body | 844px | hidden | Document is locked |
| #app-scroll | 844px | hidden auto | Inner content height approximately 3983px |
| Header | 76.39px | visible | Fixed, with only 12.8px top padding |
| Header card | 63.59px | visible | Top 12.80px |
| Home body layout | approximately 3983px | clip visible | Top padding 95.2px; bottom padding 48px in this zero-inset browser |

The bottom padding belongs to the end of the scrollable document content. It does not by itself explain a persistent cutoff while midway through the grid. No separate permanent bottom spacer was identified in this shared shell.

## Browser behavior versus application behavior

For Safari's floating bottom controls, a WebKit engineer explains that `position:fixed; inset:0` ends above browser controls intentionally, and the fill below is a browser heuristic. Our fixed scroller uses exactly that pattern. This is strong evidence for the Safari strip's mechanism, although no real-device geometry was captured in this investigation. The browser is treating the whole content surface like protected fixed UI. [WebKit issue 297779, comment 23](https://bugs.webkit.org/show_bug.cgi?id=297779#c23).

The Home Screen bottom strip is less certain. It could involve standalone viewport sizing and the translucent-status-bar configuration as well as the fixed shell. There are version-specific standalone viewport reports, but those are not proof of this site's cause. Measure that mode separately rather than assuming Safari's toolbar fix will also fix it. [WebKit standalone viewport report 301994](https://bugs.webkit.org/show_bug.cgi?id=301994).

The dark Google strip is native-app presentation in the screenshot; equal-looking strip heights do not establish equal DOM boxes. Website CSS cannot require a native Google toolbar to become translucent. The acceptance goal is preserving its currently usable content area and interactions.

Current documentation check: WebKit's Safari 26 announcement explicitly allows any site to launch as a Home Screen web app, without requiring a manifest or service worker. The live page has no manifest link; that does not contradict the screenshot or establish a PWA installation defect. Adding PWA infrastructure is unnecessary for this layout task. [Safari 26 Home Screen behavior](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/#every-site-can-be-a-web-app-on-ios-and-ipados).

The July 27, 2026 Safari 26.6 release notes do not announce a general fix for these layout patterns. Recent reports still describe keyboard-related viewport gaps, including a September 2026 report; these are regression-test leads, not diagnoses of the supplied screenshots. Safari 27 documentation was also queried, but the accessible release-note body was insufficient to establish a relevant fix. The user's installed iOS version is therefore necessary for selecting the actual device baseline. [WebKit 26.6 release](https://webkit.org/blog/18178/webkit-features-for-safari-26-6/), [keyboard gap report](https://bugs.webkit.org/show_bug.cgi?id=292603).

`WKWebView.obscuredContentInsets`, described in the Safari 26 release, is a native application API. It is not a CSS/JavaScript setting this website can apply to Safari or Google's browser. Similarly, changing `theme-color` may change presentation but cannot make clipped letter images render underneath a toolbar. A blanket switch to `100dvh` is not an established solution to the fixed-position boundary.

## Previous fixes that must survive

The current scroller was introduced in commit `36c1c95a` and followed by `b0bea7d2`. Existing [issue 35](https://github.com/MLGalusha/letter-archive/issues/35) records its purpose: mitigate header drift, first-tap failures during momentum scrolling, back-to-top jumps, and restore explicit route scroll management. Related [issue 9](https://github.com/MLGalusha/letter-archive/issues/9) and [issue 33](https://github.com/MLGalusha/letter-archive/issues/33) describe the user-visible failures. Their causal explanations are historical hypotheses, not independent proof that every failure can occur only with document scrolling.

`frontend/src/utils/appScroll.ts` centralizes scroll reads/writes/listeners and IntersectionObserver roots. Header reveal, lazy images, infinite loading, search/top buttons, scroll restoration, and letter transitions depend on that abstraction. Any change of scroll owner must update registration and observer roots coherently. Merely deleting overflow styles would risk leaving code listening to the wrong element.

## Proposed work, in order

1. **Correct mobile safe-area handling and header clearance.** Retain current visual spacing and add browser-reported top/side insets. Define clearance consistently for ordinary pages and measured docks, with no double-counting. Prefer shared CSS rules where the browser supplies correct values; use standalone display-mode scoping only for a measured standalone-specific difference. Do not hardcode an iPhone notch height or start with user-agent branching. Primary files: Header.css, App.css, and potentially Header.tsx for its measurement ownership.

2. **Compare two bounded scrolling candidates on the iPhone before selecting the bottom fix.** Candidate A preserves the inner scroller and changes its containing-block/sizing arrangement so its rendering surface can reach the physical bottom; investigate absolute positioning within an explicitly sized public shell instead of assuming fixed `bottom:0` is full-screen. This is the smaller experiment, not a proven fix. Candidate B lets the public document scroll naturally, while retaining safe fixed controls and the shared scroll API. Document scrolling is the preferred structural direction if the goal requires native Safari toolbar behavior and Candidate A cannot provide actual content behind the controls. No production migration should follow from a desktop-only result.

3. **Choose the smallest candidate that passes all modes.** Keep one primary scroll owner per mode. Avoid a permanent Safari-versus-Google fork unless a reproduced incompatibility requires it. The Home Screen case may need a separate sizing adjustment; evaluate `black-translucent` versus default status-bar behavior there only if safe-area and shell corrections leave a gap. Do not change several viewport/meta settings together, because that would obscure the cause.

4. **Keep decorative content and controls separate.** Page images/backgrounds can extend under native controls. Search/top buttons, final-page links, and navigation need usable clearance. Reserve space at the *end of scrollable content* so the final item can be brought above an overlapping control, rather than cutting off the rendering surface throughout the scroll.

Issue boundaries are now recorded in #149 (mobile header safe-area and content clearance) and #150 (Safari/Home Screen content surface and scrolling, with the device comparison as its first acceptance gate). The follow-up clarification above supersedes the original candidate order; the original investigation is retained for context.

## Verification and acceptance

Record iOS version, browser/app name and version, installation/display mode, orientation, and toolbar state. On-device measurements should include resolved top/bottom/side safe-area values, header/card rectangles, app-scroll bounds, document and inner scroll positions, layout height, visualViewport height/offset, and focused element. Capture before/after at the same scroll position, including a colored/image region crossing the bottom boundary.

Test ordinary Safari, the existing Home Screen install, and the exact Google app/browser. Use the same build in all three. Test portrait and landscape, fresh launch and resume, slow scroll and fling, direction reversal, toolbar expansion/collapse where supported, search keyboard open/dismiss, route navigation/back/forward, image zoom/modal close, bottom-of-page reachability, and single-tap floating controls during momentum. Test home, collection list/detail, letter detail, journal/list/article, about/support, and people/places. Include one desktop pass and confirm admin scrolling remains unchanged.

Required outcomes: no navigation target behind notch/status UI; ordinary Safari and Google retain their usable header spacing; real letter content passes behind Safari controls; Home Screen has no unexplained lower dead strip; final content remains reachable; no drift, missed first taps, scroll jumps, duplicate scrolling, broken infinite loading, or lost back-navigation position.

At the investigation baseline, the automated E2E configuration contained only a Desktop Chrome project. Narrow-width tests can check geometry but cannot certify iOS toolbar or standalone behavior. WebKit automation would broaden coverage, but final acceptance requires the actual iPhone modes.

## Limits of the original investigation

Reviewed all four supplied images, local source, deployed DOM/CSS, relevant commit/issue history, and Apple/WebKit primary sources. Confirmed the mobile padding override and fixed scroller in production. Did not control the user's phone, measure standalone viewport values, reproduce native Safari transitions, or test a fix. The header defect is confirmed; the Safari bottom mechanism has strong supporting evidence; the exact Home Screen bottom cause and no-regression outcome remain to be demonstrated.


## Approved local implementation

Implemented #149 first, then the native document-scrolling prototype for #150. This is a local candidate awaiting real-device acceptance, not a deployed or certified iOS fix.

- Mobile header padding retains the browser's top and side safe-area insets. The default content reservation includes the same top inset. Measured collection/letter docks include that inset once; their stored height resets when viewport width or top inset changes.
- Removed the fixed `#app-scroll` wrapper and public html/body overflow lock. The existing shared scroll API now consistently uses the document/window; visibility observers use the viewport. Header and floating controls remain fixed. No browser-name fork, hardcoded notch height, metadata change, or permanent visual-viewport compensation was introduced.
- Route restoration has one owner and waits for asynchronously loaded content to make a saved position reachable. Restoration cancels on user input or after five seconds. Search query changes preserve position. Letter transitions no longer independently force a history-restored page to zero; removing highlight parameters preserves router history state.
- Image-viewer background locking is temporary, saves the existing body styles, and restores the reading position when closed. Letter highlight targeting uses document coordinates.
- Floating search/top controls handle cancelable single-touch activation directly and retain ordinary mouse/keyboard clicks. Automated touch activation passes, but actual mid-fling first-tap behavior remains a device acceptance item.
- Unrelated backend/admin work was preserved. The pre-existing admin route block in `App.tsx` was compared with the pre-task backup and is identical.

## Local verification results

| Check | Result and limits |
| --- | --- |
| Frontend TypeScript | `npx tsc -b --pretty false` passed |
| Production frontend build | `npx vite build` passed; existing large-chunk warning remains |
| Frontend full suite | 1,287 tests passed; three tests timed out while browser/build work ran concurrently. The two affected SearchBar/AdminDashboard files passed all 28 tests on a lower-concurrency rerun. This is not an uninterrupted full-suite pass. |
| Mobile/public browser suite | `cd e2e && npx playwright test --config playwright.mobile-layout.config.ts --reporter=line`: 16 passed, 2 intentionally skipped. Chromium phone geometry, WebKit phone geometry, and desktop Chromium. Safe-area injection runs only in Chromium phone; its two other project copies are skipped. |
| Behavior coverage | Document scroll ownership; real content at the viewport edge; 48-card infinite loading; header hide/reveal; height-only viewport changes; delayed back restoration; viewer lock/close; one-touch floating search; query updates without scroll resets. |
| Shared public routes | Home, collection detail, and letter detail interactions; collections list, journal/list/article, about, support, person, and place heading clearance, horizontal overflow, and footer reachability. Data is mocked, so this is frontend behavior coverage, not production API validation. |
| Safe-area geometry | Injected 47px top inset moves both header and content reservation by 47px. Collection dock and landscape side-inset checks pass. Synthetic inset injection is not standalone iOS emulation. |
| Lint | Changed files have no new diagnostics. BackToSearch and CollectionDetailPage retain existing hook/ref diagnostics verified against HEAD; repository-wide lint is not claimed clean. |
| Patch hygiene | `git diff --check` passed; no remaining app-scroll element registrations/references in frontend source. |

Visual evidence: `output/playwright/ios-public-layout/header-inset-chromium.png` shows the local homepage with a synthetic safe-area inset. It confirms the intended geometry, not iPhone toolbar behavior.

## Remaining real-device gate

Use the same candidate build on the iPhone 13 in ordinary Safari, the existing Home Screen install, and the user's exact Google app/browser. Record the iOS/app versions first. The Google app identity and iOS version remain unconfirmed.

1. At the same archive region, slowly scroll and fling in both directions so Safari's URL bar collapses and expands. Confirm letter images continue behind its controls, the header stays stable, and content does not jump.
2. Cold-open and resume the Home Screen app. Confirm navigation clears the notch/status bar and the bottom strip is gone; repeat in landscape.
3. Repeat navigation, deep back/forward, image viewer open/close, search keyboard open/dismiss, collection dock expansion, and first-tap search/top activation during momentum. Confirm final links remain reachable above the home indicator.
4. Compare the Google app/browser against its original good behavior. Desktop Chromium cannot substitute for this check.

No physical device was controlled in this work. Safari toolbar movement, the Home Screen lower gap, keyboard viewport behavior, and native momentum input are not certified by the automated results. Existing #38 and #42 remain separate and are not claimed fixed. Keep #149/#150 open until physical-device results are recorded. Subsequent user authorization is recorded below.


## PR review and release authorization

The user subsequently requested a combined PR, review/fixes, all CI checks, and merge to main. Main has automatic production releases enabled. This supersedes the earlier local-only deployment boundary; physical iPhone checks still remain unverified and tracked in #149/#150.

The changes were isolated onto `fix-ios-public-layout` from current main (`8cb67ac7`), preserving unrelated work in the original checkout and recent reader changes on main. Review identified and corrected old-scroll-container assumptions in newer image/history/carousel tests and benchmark tools. The mobile layout suite is now included in the required mocked-E2E CI job.

A new navigation regression test reproduced an image-viewer cleanup overwriting the destination's history position (280–300px instead of zero). Cleanup now restores the old letter position only when the route has not changed. The focused check covers Chromium phone geometry, WebKit phone geometry, and desktop Chromium.

On this isolated branch, all 1,331 frontend tests passed in one run; the lint regression gate passed with zero diagnostic increases. Further CI and release results are recorded on the PR rather than inferred from the original mixed-workspace checks above.


PR #151 automated review identified horizontal overflow during touch page swipes. A regression test reproduced document widths of 550–551px in a 390px viewport. Applying `overflow-x: clip` to the public shell keeps the translated wrapper inside the viewport without creating another vertical scroll container. The test now checks the in-progress transform, zero horizontal scroll offset, and completed page navigation in Chromium/WebKit touch modes. The reviewed local mobile suite passes 21 tests with 3 intentional skips (desktop touch swipe and the two unsupported CDP inset configurations).
