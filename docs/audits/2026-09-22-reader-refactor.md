# Reader simplification — implementation and verification

Implemented locally on `simplify-scan-reader`, based on `origin/main` at `e9523f7e`. The existing working directory and its unfinished changes were left untouched. Nothing was deployed.

## Behavior

- Phone and laptop use the same thumbnail selection and main-scan transition rules. Reduced-motion preferences remain respected.
- One selected-page owner connects the inline carousel, thumbnail buttons, and fullscreen viewer.
- Scrolling or dragging the thumbnail strip only browses thumbnails. Clicking/tapping or keyboard activation selects a page. The strip reveals the selected thumbnail only when needed.
- Clicking the active main scan opens fullscreen. Fullscreen page changes stay fullscreen and reset to fit. Close, Escape, and browser Back exit; Forward and reload restore the selected fullscreen page.
- The public viewer has a small close icon, with no zoom buttons or percentage display. Pinch, keyboard zoom, and pan remain available; an inline-started pinch can continue into fullscreen and hand off to one-finger panning.
- The inline scan stage is bounded and has a stable height across image shapes. The image stays contained without cropping. Short thumbnail groups center naturally; long groups scroll natively.

## Structural changes

`ScanReader.tsx` owns reader selection and composition, extracted from `LetterDetailPage.tsx`. `ReaderFocusViewer.tsx` now owns only modal accessibility, history, and the fullscreen surface. The shared `LetterViewer` retains zoom/pan and image-resolution behavior, with controlled selection for the public reader and its existing internal selection for other consumers.

Deleted `animateFocusChrome.ts`, `drawScanReturn.ts`, `focusZoomProgress.ts`, and `pageMotion.ts`. Removed the duplicate motion channel, flying image/canvas return, shell choreography, and thumbnail snap-to-selection loop. Opening uses a short fade. The refactor removes roughly 750 net lines of production code after including the new reader component; test changes are separate.

Preserved native thumbnail scrolling, progressive image loading, active/neighbor request admission, data-saver checks, rendition stability during pinch, focus trapping/restoration, and document scroll restoration.

## Bugs caught during verification

- Rounded image dimensions created a small visible gap at zoomed pan limits. Bounds now use fractional rendered dimensions.
- Restoring fullscreen after reload could overwrite the saved page before initial selection settled. Modal initialization now waits for selection restoration.
- Fullscreen controls require explicit keyboard tab stops for consistent WebKit focus trapping.
- Fit geometry reserves room for controls and thumbnails without shrinking the underlying full-viewport pan stage.

## Verification

- Frontend: **194 test files, 1,419 tests passed**.
- Reader browser suite: **119 passed, 3 skipped**, Chromium and WebKit. Includes phone/laptop selection parity, rapid reversal, thumbnail browsing, mixed image ratios, safe-area simulation, rotation, zoom clamps, focus, history, and header coverage.
- Follow-up regression for inline pinch-to-pan handoff: **2 passed**, Chromium and WebKit. This is synthetic touch evidence; trusted multi-touch tests also run in Chromium.
- Production build, TypeScript, changed-source lint, and diff whitespace checks passed. Build retains the existing large-chunk advisory.
- Real public scans visually reviewed through a local frontend preview at laptop and phone viewport sizes.

Old tests tied to the removed flying-image choreography, full-bleed neighboring scans, or thumbnail auto-selection were replaced with assertions for the new behavior.

## Device acceptance still required

The supplied physical iPhone screenshot proves a bottom strip was visible, but desktop WebKit and simulated safe areas cannot reproduce all Safari/Home Screen viewport behavior. This change removes a measured zoom-edge gap and verifies full-stage geometry and consistent surface color. Confirm the original symptom on physical iPhone Safari, Home Screen mode, and Chrome before treating it as resolved. Include toolbar expansion/collapse, rotation, pinch/pan to all edges, page switching, and closing back to the original document position.

## Preview

Local desktop preview: http://localhost:5183/letter/eb997470-6fb7-486d-ac98-cdeb5a03d4ca?image=2d47b66f-6abc-4419-a6ae-b6825ec21e80

The preview uses the public production API for reads and serves the new frontend locally. Its temporary configuration lives in `frontend/output/reader-preview.config.ts`; it is not application code. This loopback preview is not a phone/LAN validation environment.

## Follow-up: focused phone feedback

Removed the public viewer zoom-in, zoom-out, and percentage/reset controls. Close is a 20px icon on a 32px visual disc with a 44px touch target. This does not change the other shared viewer variants.

Measured thumbnail overflow at a 390px viewport: the frame was 366px wide but its scroll strip was 374px, because content-box width excluded 8px padding. The strip now uses border-box sizing, and the rounded frame clips overflow. Both now measure 366px. Native scrolling and selection behavior are retained.

Validation after this correction: 43 browser checks passed across Chromium and WebKit, with 3 browser-specific skips; build, changed-source lint, and whitespace checks passed. Phone-width and laptop-width screenshots were visually inspected.

### Top/bottom bands: investigation remains open

User reports Home Screen launch on iOS 26.6.2. Supplied screenshots also show browser address controls; actual display mode has not yet been measured. The current reader stage measures the full reported viewport locally (390 × 844 at x=0,y=0), with zero padding on the dialog or image stage. Viewport metadata already includes `viewport-fit=cover`.

WebKit engineer commentary explains that Safari places `bottom:0` above its browser controls for fixed overlays and uses a color-fill heuristic below them: https://bugs.webkit.org/show_bug.cgi?id=297779#c23 . This is a plausible explanation for browser-mode bands, not proof of the user's Home Screen cause. iOS 26 also lets users choose a Home Screen web app or browser bookmark independently of manifest setup: https://webkit.org/blog/17333/webkit-features-in-safari-26-0/#every-site-can-be-a-web-app-on-ios-and-ipados . No manifest or speculative viewport offsets were added.

A temporary local Vite-only probe in `frontend/output/reader-preview.config.ts` records display mode, safe-area insets, screen/visual-viewport dimensions, and reader bounds to `/tmp/reader-phone-viewport.json` after phone load/resize/touch release. It records no page contents, credentials, or image data, and is not bundled in production. Pending: refresh the phone preview, open fullscreen, pinch, inspect the measurements, and verify a targeted correction on that device. The physical top/bottom bands are not claimed fixed.

### Physical-phone measurement received

At 2026-09-22T17:04:48Z, after the user refreshed and opened fullscreen on the LAN preview:

- User-reported OS: iOS 26.6.2; launched from Home Screen.
- Runtime reports `navigator.standalone=false`, `display-mode: browser`.
- Screen: 390 × 844 CSS pixels. Inner and visual viewport: 390 × 699, visual offsetTop=0, scale=1.
- Fullscreen backdrop and image stage both: x=0, y=0, width=390, height=699, padding=0.
- Reported safe-area padding: 0px.
- Thumbnail frame: x=12, width=366, overflow hidden.

This confirms no top/bottom inset between the image stage and the viewport reported by this phone. The 145px difference between screen and page viewport is outside the stage's available viewport. The active launch is browser mode despite the Home Screen entry point. No speculative CSS expansion was added. Next acceptance step: launch a Home Screen entry with Open as Web App enabled, then repeat the fullscreen check. Actual standalone notch/home-indicator coverage remains unverified.

## Reopened edge-coverage investigation

The user's comparison with the scrolling homepage invalidates treating the fixed viewer's reported viewport as the maximum paintable screen area. The production PWA screenshot independently shows a bottom gap. Browser mode is a relevant variable, not a resolution.

Controlled attempt 1: move the public viewer into document flow (`position:relative`, `height:100lvh`), keep controls fixed, freeze only the underlying application, and retain document overflow locking. On the physical phone this expanded the stage from 699px to 739px, but the user confirmed both bands remained. Thus geometry expansion alone did not solve the paint boundary.

Candidate behavior passed 51 Chromium/WebKit reader checks (3 browser-specific skips), 4 repeated-open/resize/style-restoration checks, build and lint. WebKit reports a fractional 843.984375px for an 844px CSS viewport; the geometry assertion uses a subpixel tolerance.

Controlled attempt 2: retain the document surface but remove root/body overflow locking, clip the hidden background application's own overflow, and preserve gesture handling on the viewer. Physical paint verification is pending. This is a local diagnostic candidate, not a verified production fix. The original surface files are saved in `/tmp/reader-surface-before.ts` and `/tmp/reader-surface-before.css` for reverting the unsuccessful candidate without touching the accepted thumbnail/control changes.

Attempt 2 result: user confirmed both bands remained with root/body overflow locking removed. It is not a fix.

Attempt 3 isolates the remaining fixed-layer candidates: the background application is removed from painting while the reader is open, and the close button/thumbnail strip use absolute positioning inside the document reader. The strip's inset derives from the difference between large and dynamic viewport heights. Physical sample at 17:20:57Z confirms a 739px document stage and an absolute thumbnail strip at y=606.921875. Visual result is pending. This attempt is diagnostic only; background-carousel selection must also be revalidated before accepting any display:none approach.

Attempt 3 visual result: both bands remained, but the bottom band became smaller.

Attempt 4 removed clipping from the image-only backdrop/dialog/stage, retaining clipping on thumbnails. User observed a nearly eliminated top band with a thin sliver remaining; the bottom band grew and then appeared to return toward its earlier state without further viewer edits. Physical measurement showed stage y=-40 (document scrolling), which is a regression. This experiment is not accepted as a completed fix.

An isolated native-document image baseline is available locally at `/output/edge-coverage-baseline.html`. It uses one ordinary scrolling image and no reader code or fixed elements. The user requested direct testing through iPhone Mirroring. The macOS app is accessible through computer-use tools but currently requires the user to unlock it with their Mac login. Viewer code is held unchanged while arranging direct observation; experimental surface changes still need acceptance or rollback.


## Physical Mirroring results and final surface direction (18:00 UTC)

The earlier failed attempts above are superseded by direct phone comparisons. A standalone diagnostic page with the same ordinary image painted behind Safari's top and bottom controls after document scrolling. The viewer can do the same; the reported visual viewport is not the entire paintable area.

The remaining shared `.letter-viewer` overflow clip was removed for public focus mode only. The document surface now has a viewport of document space above and below, and opening aligns the stage with the visible viewport. This gives the zoomed image actual positive document coordinates above the visible stage instead of relying on paint above the document origin. A ResizeObserver realigns on viewport geometry changes. Thumbnail clipping remains intact. This is one shared implementation, not mobile/desktop branches.

The background app is hidden and taken out of flow while retaining carousel layout (the diagnostic display:none version was discarded). The fixed header and reader cover are removed from painting during the session. Every temporary style and the previous reading position is restored on exit.

Physical iPhone via Mirroring, user-reported iOS 26.6.2, local build port 5183:
- Safari: fresh-load fullscreen zoom visibly paints image behind status area and bottom browser controls. Thumbnail selection and closing retain the selected main image.
- Chrome: fullscreen fit, double-tap zoom, thumbnail selection, and closing verified. Image fills the page viewport without extra app-owned bands; Chrome retains its own opaque browser controls.
- Local Home Screen app: user authorized adding a temporary installation; check pending.
- Actual multi-finger pinch and device rotation have not been exercised through Mirroring; automated gesture/resize checks are separate evidence.

Additional requested fit correction: the unzoomed image is centered in the space between the close-control region and the measured thumbnail tray. The tray stays anchored in its existing position. Zoom pan bounds still use the full surface, while pinch coordinates use the fitted image region. Physical Safari and Chrome both show the complete fitted image above the tray.

Validation: 42 history/focus/reader/viewport checks passed before the fit adjustment; subsequent reader/drawer/gesture checks passed, with old stage-size assertions updated to verify full backdrop coverage and image/tray separation. Final repeated-open/resize/style-restoration checks: 4 passed. Production build and changed-source lint passed. Nothing deployed.


### Installed Home Screen acceptance (18:11 UTC)

With explicit user approval, added the local preview as **Reader Local Test**, with Open as Web App enabled. The phone reported `navigator.standalone=true`, inner/visual viewport 390×844, and safe-area insets 47px top / 34px bottom. The display-mode media query separately reported browser; the native standalone flag and absence of browser UI identify the tested launch mode.

Observed directly through Mirroring: fullscreen double-tap zoom paints the scan behind the status area and to the bottom screen edge, without the prior bottom strip. Fit clears the thumbnail tray. Selecting page 2 and closing restores page 2 in the document. This is local installed-app evidence; production has not changed. Chrome and Safari were tested separately above. True multi-finger pinch and physical rotation remain untested through Mirroring.

Final return/focus suite including an actual selected-slide-center assertion: 12 passed in Chromium and WebKit. Final viewport suite: 4 passed. Existing build and changed-source lint passed. A document scroll guard retains modal position without removing the document painting layer; its explicit scroll-and-realign regression is included in the final viewport check.


## Restored gallery design and continuous fullscreen transitions (19:15 UTC)

User correction: the bounded gallery and abrupt modal swap removed intentional design behavior. Restore large neighboring images at the screen sides and preserve the visual identity of the scan when opening/closing fullscreen. This supersedes the earlier bounded-gallery choice.

Measured before at laptop viewport 1440×1000: gallery clipping window x=296.5,width=832; first scan x=460.5,width=504,height=672; next scan x=1308.5, outside the gallery clip despite lying within the visible screen. After: scroll window spans the screen, with the same scan dimensions and centers. Native scroll padding preserves the content lane; asymmetric phone insets are respected. Neighbor loading policy remains bounded to current/nearby pages.

Fullscreen now uses one browser-owned same-document View Transition in both directions. The scan and page strip have stable shared names; surrounding page/header cross-fade for the same 260ms. No flying-image clone, separate return canvas, or added animation library. Reduced-motion users and unsupported browsers retain direct state changes. Rapid duplicate open requests are coalesced, interrupted transitions are skipped safely, and focus is restored after the browser transition if needed. The document painting/safe-area architecture from the verified phone fix is unchanged.

Primary API reference: WebKit documents same-document view transitions, old/new capture, and the native lifecycle in Safari 18: https://webkit.org/blog/15865/webkit-features-in-safari-18-0/ . Implementation was verified in both current local Chromium and WebKit, not inferred from API availability alone.

Evidence: paused midpoint screenshots show the scan moving between its inline/fullscreen bounds and the header fading rather than disappearing. Mobile-width and laptop-width captures were reviewed. Physical iPhone Home Screen app entry, zoom, and zoomed exit were exercised via Mirroring; the image still paints behind the status area and to the screen bottom. Physical multi-finger pinch/rotation remain untested.

Validation: 59 of 60 initial browser checks passed; the remaining mixed-ratio assertion ran before the decoded image's layout commit. It passed in isolation, then the assertion was changed to wait for the expected settled ratio. All 18 reader-mode tests subsequently passed, plus 4 dedicated native transition tests verifying successful scan/page-strip captures in both directions at phone/laptop widths across Chromium/WebKit. Carousel unit tests: 11 passed. Build, changed-source lint, and whitespace checks passed. No deployment or commit.

Final neighboring-image regression: 16 checks passed across eight viewport widths in Chromium and WebKit, including visible neighboring scans outside the desktop content lane and off-screen neighbors on phones.

## Pre-merge review

Found a real entry-zoom regression: the generic image-change effect reset the opening gesture's scale to 1 on mount. Keyboard and wheel entry regressions failed in both engines before the fix. Focus mode now preserves its opening scale and resets only when the image changes; entry scale is also bounded by the viewer maximum. All 26 focused reader checks pass after the correction.

Repeated mixed-ratio tests isolated a fixture problem: WebKit reported rendered SVG viewport dimensions as natural dimensions (for example 61×81 for a 600×800 source), contaminating the ratio used by the progressive image. The mixed-ratio fixture now serves raster PNGs with fixed dimensions, matching production scans; ratio assertions are unchanged. The earlier hypothesis that this was only a decoded-layout timing issue was insufficient.

All 1,419 frontend unit tests pass. Source lint and production build pass. The local preview config is intentionally untracked and excluded from the PR; repository CI runs the clean checkout's full lint gate.
