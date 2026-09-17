# Public site: things to try

This is a running checklist for Mason to use whenever convenient. A pending check is not a claim that a bug is fixed. Record observations below each check; no need to complete everything in one sitting. For entries marked **merged**, the expected behavior applies after their production release. Only entries explicitly marked **live** or **deployed** record a completed production check.

## Browser coverage

The public site should work well in **Safari and Google Chrome**, on desktop and mobile. The primary physical phone for acceptance is an **iPhone 13**. Run phone checks in both installed browsers, particularly keyboard, scrolling, gestures, and fullscreen images. Chromium/WebKit automation helps catch regressions but does not establish physical iPhone behavior.

CI runs the existing public archive history/image checks in both Chromium and WebKit. The first Linux run passed all three WebKit cases and the existing Chromium suite in PR 120. This is a continuing regression check for search, native navigation, and deferred images; the phone checks below still matter for keyboard and touch behavior.

Session: date ___; device ___; browser/version ___; iOS/macOS/OS version ___; Wi-Fi/cellular ___; Reduce Motion on/off ___.

Recorded release checkpoint: frontend `b894e3f5` (September 17, 2026 UTC); backend remains `5c7a9654` because the intervening changes affect only the frontend. This includes long exact previews, carousel gesture handling, mobile filters, scan dots, static single highlights, explicit letter navigation, and transcript gutters. Later changes below have their own status. Counts below describe that catalogue snapshot and may change as letters are published. New work below remains pending until its own release is recorded.

## 1. Back to search / back to top

**Status: pending improvement / physical-device reproduction.** [Issue 38](https://github.com/MLGalusha/letter-archive/issues/38), overlapping [issue 8](https://github.com/MLGalusha/letter-archive/issues/8).

- Open [Home](https://voicesthatremain.com/) or [Collection 003](https://voicesthatremain.com/collections/003), then scroll several screens down.
- Tap the floating search button. Repeat with back-to-top where available.
- Expected: arrive at the right place without hiding the target behind the header. With Reduce Motion off, movement should animate smoothly. With Reduce Motion on, an immediate jump is intentional.
- Compare Safari and Chrome on the iPhone 13. Note whether it jumps, freezes briefly, stops at the wrong place, or only fails after opening the keyboard.
- Placement ticket [13](https://github.com/MLGalusha/letter-archive/issues/13) was already implemented: both controls sit 12px plus the device safe-area inset above the mobile viewport bottom, compared with the 24px desktop base. Check that this feels comfortable in both phone browsers; this does not establish that the separate animation issue is fixed.

Observation: ___

## 2. Typing, keyboard, and mobile filters

**Status: filter layout deployed in [PR 112](https://github.com/MLGalusha/letter-archive/pull/112). Keyboard issue remains open.** [Issue 42](https://github.com/MLGalusha/letter-archive/issues/42), [issue 12](https://github.com/MLGalusha/letter-archive/issues/12). Earlier input-responsiveness changes are already live ([PR 105](https://github.com/MLGalusha/letter-archive/pull/105)).

Issue 12 change: on phones, including touch-screen landscape layouts, tapping search closes open panels while retaining selected filters and valid year drafts. Filter choices use page scrolling and larger targets. Chromium/WebKit checks and independent review passed; your physical-phone check is still pending. Try expanding Topic and reaching Clear All in both orientations, including a search with no results. Issue 42's keyboard/header shift remains separate.

- On [Home](https://voicesthatremain.com/), scroll to search, open the filters, then tap the search input and type. Dismiss the keyboard; repeat on [Collection 009](https://voicesthatremain.com/collections/009).
- Expected: input remains reachable above the keyboard, header does not get stranded offscreen, and dismissing the keyboard restores a usable page. Opening/closing filters should feel predictable; the deployed filter fix covers dismissal when typing and mobile panel layout.
- Type a different query quickly, change sort, then clear the query. Expected: your input updates promptly; results eventually correspond to the latest controls, with no stale results replacing newer ones.

Observation: ___

## 3. Search matches and preview placement

**Status: transcript-first search and accessible preview controls already live.** [PR 98](https://github.com/MLGalusha/letter-archive/pull/98), [PR 102](https://github.com/MLGalusha/letter-archive/pull/102). Ordinary previews stayed inside their panels and cards did not move in Chromium/WebKit checks. [Issue 44](https://github.com/MLGalusha/letter-archive/issues/44) is fixed by [PR 110](https://github.com/MLGalusha/letter-archive/pull/110), with the complete long phrase confirmed in a live preview; [45](https://github.com/MLGalusha/letter-archive/issues/45)'s old hold interaction was replaced by the explicit preview button. Physical-phone checks remain useful.

- Open [search for “he”](https://voicesthatremain.com/?q=he). Open the magnifying-glass preview on a result; on desktop also try keyboard focus and Escape.
- Expected: transcript matches take priority. If a particular result has no transcript match, its explanation may match date, sender, recipient, or location. Format, summary, and hook alone must not produce a typed-search match.
- Expected: the highlighted excerpt stays inside the preview, neighboring cards keep their size/position, and dismissing the preview restores normal interaction. On mobile, use the preview button rather than requiring a long press.
- The baseline snapshot has three results for “he”; searching “ephemera” has none, while selecting that format as a filter can still find its item. This illustrates the difference between text search and filters.
- Fixed case: [this long exact phrase](https://voicesthatremain.com/?q=I+did+receive+your+letter+saying+that+you+were+married+and%0A++honestly%2C+I%27ve+tried+so+many+times+to+write+you%2C+but+somehow%2C+the+words%0A++didn%27t+seem+to+come--at&exact=true) previously cut the highlighted phrase at “so many times…”. Expected now: the complete matched phrase is supplied and readable, scrolling inside the preview if necessary. Open the link directly; it contains transcript line breaks.

Observation: ___

## 4. Exact phrase, filters, sorting, and navigation

**Status: already live.** [PR 107](https://github.com/MLGalusha/letter-archive/pull/107), [PR 103](https://github.com/MLGalusha/letter-archive/pull/103), [PR 104](https://github.com/MLGalusha/letter-archive/pull/104). Removing obsolete sorting code in issue 32 should not change visible behavior.

- Compare [ordinary “kids the how” search](https://voicesthatremain.com/?q=kids+the+how) with [the exact phrase](https://voicesthatremain.com/?q=kids+the+how&exact=true). The baseline has one ordinary match and zero exact matches: exact mode requires contiguous words in that order.
- Toggle Exact phrase, reload, and use browser Back/Forward. Expected: controls, URL, and results agree. Clear everything and confirm the mode/filter selections reset as shown by the controls.
- Select a sender, recipient, format, and date range separately, then combine them. Expected: selected roles constrain the correct field and incompatible date bounds are explained instead of silently accepted.
- Change sort direction, scroll to load more, then navigate away and back. Expected: no duplicate cards, totals describe all matching items, and selection/order stay consistent with the URL.

Observation: ___

## 5. Scrolling across carousels and reading images

**Status: issues 10, 11, and 20 deployed; letter navigation deployed; fullscreen change merged in PR 119; physical-phone acceptance pending.** [Issue 10](https://github.com/MLGalusha/letter-archive/issues/10), [11](https://github.com/MLGalusha/letter-archive/issues/11), [20](https://github.com/MLGalusha/letter-archive/issues/20), [21](https://github.com/MLGalusha/letter-archive/issues/21), [23](https://github.com/MLGalusha/letter-archive/issues/23). Smaller initial reader images already live ([PR 95](https://github.com/MLGalusha/letter-archive/pull/95)).

Issue 10 is deployed in frontend release `5c7a9654`: carousels now wait for a clearly horizontal gesture before taking control; canceled drags and adding a second finger do not change slides. Reviewed code and automated checks passed; physical Safari/Chrome checks are still pending. Scan dots now follow the visible page and respond to taps (issue 11), confirmed on the live two-page letter in both engines. Single highlights no longer render an interactive outer carousel (issue 20), checked with a local singleton fixture. Fullscreen behavior and the other tickets above are separate.

- On [Home](https://voicesthatremain.com/) and [Collection 003](https://voicesthatremain.com/collections/003), begin a mostly vertical swipe over a carousel. Then deliberately swipe horizontally.
- Expected: vertical movement scrolls the page; horizontal movement changes the carousel image. A carousel containing one highlight should behave as a static outer item; a gallery inside it can still have its own image controls. Dots should follow the visible image without clipping.
- The ordinary letter-page swipe-to-next-letter interaction was removed in [PR 116](https://github.com/MLGalusha/letter-archive/pull/116). A horizontal gesture over reading text should stay on the same letter. The explicit previous/next links, header scrubber, and desktop arrow navigation remain available. Check bottom-link spacing in portrait and landscape, including the side with the cutout.
- Open [a two-page letter](https://voicesthatremain.com/letter/0b5e626d-01bb-4026-a4fa-a6ebdf180c7d), enter fullscreen, swipe pages, zoom/pinch, and pan.
- For [PR 119](https://github.com/MLGalusha/letter-archive/pull/119), also try a short swipe that should return to the same page, a rapid second swipe or Next tap while the first settles, and starting a pinch during a partial swipe. Expected: no accidental page skip or stuck slide; pinch stays with the current image. With Reduce Motion enabled, committed page changes should be immediate. The change is merged; your physical-phone check is pending.
- Expected: the initial image looks clear at its displayed size. Zoom can request higher detail. Fit-to-screen page swipes and zoomed-image panning should not fight each other; ordinary page swiping should not unexpectedly open another letter.

Observation: ___

## 6. First load and deeper scrolling

**Status: earlier payload/image/pagination improvements live; image contention fix merged in PR 113; phone and cold-start validation pending.** [Issue 96](https://github.com/MLGalusha/letter-archive/issues/96), [issue 50](https://github.com/MLGalusha/letter-archive/issues/50).

- Visit [Home](https://voicesthatremain.com/) after not using it for a while. Notice when controls appear, when cards appear, and when their images appear. Repeat immediately to compare a warm visit.
- Scroll steadily through results, then try a faster scroll. Change search or sort while images are arriving. Repeat on [Collection 003](https://voicesthatremain.com/collections/003).
- Expected: visible images fill in, controls remain responsive, new pages do not repeat cards, and the list eventually reports completion. Record persistent blank images, a freeze, or unusually long waits and approximately how far down you were.
- The image-queue change in [PR 113](https://github.com/MLGalusha/letter-archive/pull/113) limits simultaneous resizing so image work does not monopolize the server. In its controlled local test, search waited less but the complete 24-image batch took longer. Judge both responsiveness and image completion; this is not a promise that every image or Cloud Run cold start becomes faster.
- Earlier work reduced some downloads and unnecessary initial result fetching. It does not prove all cold starts, image waits, or deep-scroll problems are solved. The new image scheduler must be evaluated for image completion as well as search responsiveness.

Observation: ___

### Image follow-up: repeat visits

**Status: early revalidation deployed and verified; physical phone checks remain.** [Issue 121](https://github.com/MLGalusha/letter-archive/issues/121).

- Open [Home](https://voicesthatremain.com/) or [Collection 003](https://voicesthatremain.com/collections/003), allow images to finish, then revisit in the same browser. Try Safari and Chrome with normal browser caching enabled.
- Expected: the same images display correctly. Where the browser asks whether its cached preview is still current, the server can answer without resizing it again. This does not eliminate the first download or guarantee an instant first visit.
- A forced reload or DevTools Disable cache can deliberately bypass this shortcut. Server-side verification records a matching conditional response with no resize work; visual appearance alone cannot prove that.
- A read-only check at release `dc5c1b44` confirmed a zero-body 304 with `cache: not-modified` and no queue/transform work. The single request recorded 10ms server time and 73ms client time; this is a mechanism check, not a benchmark. [Verification receipt](https://github.com/MLGalusha/letter-archive/pull/124#issuecomment-5708570898).
- Saved previews (#122) are deployed, with one production save and bounded Chromium/WebKit checks verified. The [local image pilot](../audits/2026-09-17-visible-image-pilot.md) confirmed byte-identical saved previews across backend restarts. It did not reproduce visible blanks, so no frontend priority change was justified locally. Issues #123 and #50 remain open for representative production and physical phone checks.

Observation: ___

## 7. Collection first visit and intermittent visual reports

**Status: investigation / physical reproduction pending.** [19](https://github.com/MLGalusha/letter-archive/issues/19), [46](https://github.com/MLGalusha/letter-archive/issues/46), [48](https://github.com/MLGalusha/letter-archive/issues/48), [24](https://github.com/MLGalusha/letter-archive/issues/24).

- Open [Collections](https://voicesthatremain.com/collections), scroll down, and enter a collection you have not visited in that tab. Expected: title fully below the header without manually correcting the scroll. Distinguish clicking a new collection from browser Back, which should restore your prior position.
- On [Collection 003](https://voicesthatremain.com/collections/003), swipe the highlights and watch the dots during the transition. Expected: complete, unclipped dots throughout.
- Check the format breakdown under the title on first load and after rotating your phone. Expected: consistently smaller supporting text. Record which browser/orientation shows an oversized line.
- On [Collection 009](https://voicesthatremain.com/collections/009), tap Jimmie under People. Expected: the backdrop covers the header and the bottom of the screen. This collection popup covers the full 390×844 viewport in both engine checks and already uses a body portal (earlier issue 41). Issue 24 names a letter-page trigger that remains unconfirmed; record the exact page and control if its backdrop still clips.
- Current delayed-data/browser checks did not reproduce the first-visit overlap; a measured desktop-engine dot transition also did not show clipping. These checks do not close the intermittent iPhone reports.

Observation: ___

## 8. Transcript edge spacing

**Status: issue 22 deployed in PR 117; physical phone checks pending.** [Issue 22](https://github.com/MLGalusha/letter-archive/issues/22).

- Open [the October 18 transcript](https://voicesthatremain.com/letter/0b5e626d-01bb-4026-a4fa-a6ebdf180c7d#letter-transcript) in Safari and Chrome. Try portrait and landscape.
- Expected: reading text has visible space on both sides instead of reaching the right edge. Switch to Original formatting and back; both modes remain readable. The change adjusts spacing only and adds browser-reported safe-area clearance around screen cutouts.
- Live Chromium/WebKit checks at 390px and 844px confirmed 20px reading padding on both sides, 16px navigation padding, and text inside the viewport. Nonzero safe-area behavior was checked locally with emulated insets; physical rotation remains your check.
- The larger Reader View V2 work is tracked separately in [issue 111](https://github.com/MLGalusha/letter-archive/issues/111); it is not included in the padding fix.

Observation: ___

## 9. Collection card feedback

**Status: PR 118 merged; physical phone checks pending.** [Issue 49](https://github.com/MLGalusha/letter-archive/issues/49), [PR 118](https://github.com/MLGalusha/letter-archive/pull/118).

- Open [Collections](https://voicesthatremain.com/collections) in Safari and Chrome on the iPhone 13, then tap a card. Expected: first-tap navigation without the mouse-style upward lift sticking after touch.
- On desktop, hover and press a card, then navigate using Tab and Enter. Expected: hover feedback, immediate press feedback, visible keyboard focus, and normal navigation.
- With Reduce Motion enabled, cards should not lift or animate. The measured fix addresses retained touch hover; your physical-phone impression still matters.

Observation: ___

## 10. Work still awaiting a decision or more evidence

- [Best Match without typed text (#29)](https://github.com/MLGalusha/letter-archive/issues/29): prepared locally, not deployed. The proposed quality ordering adds roughly 1–3ms in the representative 100-group local comparison; the 250-group difference is inconclusive. The issue requires no measurable slowdown, so it stays open pending your cost decision or a qualifying change. Typed search is unchanged. [Measurement summary](https://github.com/MLGalusha/letter-archive/issues/29#issuecomment-5707852661).
- [Popular sort (#30)](https://github.com/MLGalusha/letter-archive/issues/30): still needs a decision about what counts as popularity and how to measure it. No visitor tracking was added.
- [Transcript/image comparison (#53)](https://github.com/MLGalusha/letter-archive/issues/53) and [Reader View V2 (#111)](https://github.com/MLGalusha/letter-archive/issues/111): larger reader work remains separate from these spacing and image-loading fixes.
- The phone/intermittent reports in sections 1, 2, and 7, plus remaining performance validation in section 6, stay open. An engine check that does not reproduce a report is not a claim that the report is fixed.

## Change log

- Initial checklist: created alongside old-ticket reconciliation and issue 32 cleanup. Safari and Chrome coverage applies across the public site, including the iPhone 13. New implementation/deployment results will be recorded here as work lands.

## Reusable archive-card previews (issue 122)

**Status: deployed; bounded browser checks complete, physical phone acceptance pending.** This change saves 480px card
previews after their first successful generation so another server process can
reuse them. It does not pre-generate every image, and the first request may still
wait for generation and saving.

- Open [Home](https://voicesthatremain.com/) and
  [Collection 009](https://voicesthatremain.com/collections/009) in Safari and Chrome
  on the iPhone 13. Scroll at an ordinary pace, then try a few faster jumps.
- Expected: visible cards eventually show their scans without broken-image icons;
  search and filtering remain responsive while previews arrive. Record the route,
  scroll position and approximate wait if a visible card stays blank.
- Revisit the same route normally. Repeated visits may benefit from browser,
  process-memory or saved previews; browser speed alone cannot distinguish them.
  Engineering acceptance uses server read/transform timings to establish durable
  reuse. A fresh browser is not a fresh server instance.
- A bounded check confirmed a preview was saved through production storage. The
  first request still waited for generation and saving. Its subsequent 304 response
  used early browser-cache revalidation; it did not prove reuse of the saved file.
- Chromium still showed some waiting after fast jumps, then all eight visible
  images settled during an additional stationary wait. WebKit ultimately showed
  all eight visible images ready, but its fast-scroll script hit a pagination
  click race, so that phase is not a completed timing check. Search and clear
  worked in both engines. These desktop-engine checks do not replace your phone
  observations or establish a production speed improvement. [Live observations](https://github.com/MLGalusha/letter-archive/issues/50#issuecomment-5708851265).
- Keep original scan viewing and deliberate zoom working. This change persists
  card-sized previews only; it does not replace original downloads.

Observation: date ___; browser/device ___; route ___; first visit/revisit ___;
visible-card wait ___; effect on search ___ .

## Reader navigation feedback and independent data (issue 131)

**Status: implementation under review; not yet recorded as deployed.**

Open [this letter](https://voicesthatremain.com/letter/be6ef848-a8f9-4696-9097-646d4257562a), tap Next, then use browser Back/Forward. Repeat on iPhone 13 Safari and Chrome. Expected after release: navigation immediately shows “Loading letter...” if new data is pending; the retained old letter is dimmed and cannot be interacted with. New letter content appears as soon as its own data arrives, even if next/previous information is still loading. Optional navigation failure does not prevent reading. Check the loading message remains visible below the header and fullscreen closes when leaving a letter.

Automated coverage uses separately held detail/adjacency responses, stale responses during rapid navigation, failed adjacency, and browser Back/Forward. This removes a frontend dependency; it does not claim to fix server startup or scan-generation time.

Observation: browser ___; connection ___; feedback visible ___; correct destination ___; unexpected behavior ___

## Saved reader images (issue 128)

**Status: implementation under review; deployment verification pending.**

- Open [Collection 003](https://voicesthatremain.com/collections/003), then a letter, in Safari and Chrome on the iPhone 13.
- Try [this multi-page letter](https://voicesthatremain.com/letter/be6ef848-a8f9-4696-9097-646d4257562a). Move between scans, open fullscreen and deliberately zoom. Expected: every scan still loads, zoom remains sharp, and revisiting scans can reuse previous image work.
- Revisit normally later. Expected: repeat requests can reuse saved reader sizes even on another server instance. A browser visit alone cannot establish which cache served it; server timings are the engineering check. First generation and backend startup can still take time.
- Record the page/scan, browser, first/repeat visit and approximate time until readable. There is no promised fixed loading time; these observations will catch regressions that a local benchmark cannot.

Observation: date ___; browser/device ___; letter/scan ___; first/repeat ___; readable after ___ .

### Progressive image scheduling (#129)

After the release containing #129, try [collection 003](https://voicesthatremain.com/collections/003)
and [its first letter](https://voicesthatremain.com/letter/be6ef848-a8f9-4696-9097-646d4257562a)
in Chrome and Safari. A smaller preview should appear while a larger scan loads;
switching letters should not briefly show the previous scan as fully ready. Opening
and paging the fullscreen viewer should still work. Try the same image navigation
in an existing admin review without changing the transcript.

The scheduler now admits the rendered full image after the planned delay, and
that DOM image owns its request and completion. The useful preview stays until
the displayed image has loaded, including with no-store or revalidated responses.
Priority changes update the active request without restarting it. Navigation
releases unfinished image objects owned by the component. That release is best
effort: another consumer can still need the same URL, and server work already started may continue.

Developer check: in a fresh Network recording, collection showcase 32/320px
previews should be admitted before the deferred 640px tier. Cached responses can
be immediate, and the browser may run an idle callback quickly; this is not a
promise of a fixed visible delay or fewer total bytes. Controlled Chromium and
WebKit tests hold idle callbacks and test a 1.2-second delay, including replacement
of an already-loaded source. They also cover recovery, keeping a useful
preview when the larger image fails, and exactly one full request while the actual
DOM response is held under no-store and max-age=0 cache headers. This is
correctness evidence, not a measured production speedup or a physical iPhone result.

## Collection content independent of optional profile (issue 132)

**Status: implementation under review; not yet recorded as deployed.**

Open [Collection 003](https://voicesthatremain.com/collections/003) and [Collection 009](https://voicesthatremain.com/collections/009) in iPhone 13 Safari and Chrome. Try searching, sorting, opening a letter, and returning with browser Back. Expected after release: the collection header, published narrative, highlights and archive can appear as soon as overview data arrives, even when the separate profile request is still pending. Profile failure must not turn the collection into a not-found page. Late enrichment must not insert a narrative above the search area or clear your query, sort, or scroll position. Both configured featured letters and the initial fallback selection remain stable after optional profile resolution; profile data enriches popups only.

Switch collections quickly with the header controls, then Back/Forward. Expected: you see the current collection or its loading state, never a late response replacing it with a previous collection. For a developer check, hold only `/collections/003/profile` in a local browser fixture: the overview and search must remain usable while it is held; releasing it must not move the archive due to narrative insertion.

Validation uses controlled browser fixtures, not production speed measurements: Chrome and WebKit with iPhone 13 emulation rendered the overview and narrative while profile was held, and the archive's top position stayed unchanged on release. Focused tests cover query preservation, profile failure, overview failure, route cancellation/late responses, publication masking, hidden featured targets, and companion-to-primary selection. Physical phone checks remain yours to try.

Observation: browser ___; collection ___; query/sort preserved ___; unexpected jump ___; Back/Forward result ___
