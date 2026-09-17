# Public site: things to try

This is a running checklist for Mason to use whenever convenient. A pending check is not a claim that a bug is fixed. Record observations below each check; no need to complete everything in one sitting.

## Browser coverage

The public site should work well in **Safari and Google Chrome**, on desktop and mobile. The primary physical phone for acceptance is an **iPhone 13**. Run phone checks in both installed browsers, particularly keyboard, scrolling, gestures, and fullscreen images. Chromium/WebKit automation helps catch regressions but does not establish physical iPhone behavior.

Session: date ___; device ___; browser/version ___; iOS/macOS/OS version ___; Wi-Fi/cellular ___; Reduce Motion on/off ___.

Current already-live baseline: frontend/backend release `5a54cce0`, verified before this checklist was created. Counts below describe that catalogue snapshot and may change as letters are published. New work below remains pending until its own release is recorded.

## 1. Back to search / back to top

**Status: pending improvement / physical-device reproduction.** [Issue 38](https://github.com/MLGalusha/letter-archive/issues/38), overlapping [issue 8](https://github.com/MLGalusha/letter-archive/issues/8).

- Open [Home](https://voicesthatremain.com/) or [Collection 003](https://voicesthatremain.com/collections/003), then scroll several screens down.
- Tap the floating search button. Repeat with back-to-top where available.
- Expected: arrive at the right place without hiding the target behind the header. With Reduce Motion off, movement should animate smoothly. With Reduce Motion on, an immediate jump is intentional.
- Compare Safari and Chrome on the iPhone 13. Note whether it jumps, freezes briefly, stops at the wrong place, or only fails after opening the keyboard.

Observation: ___

## 2. Typing, keyboard, and mobile filters

**Status: keyboard/filter-layout follow-ups pending.** [Issue 42](https://github.com/MLGalusha/letter-archive/issues/42), [issue 12](https://github.com/MLGalusha/letter-archive/issues/12). Earlier input-responsiveness changes are already live ([PR 105](https://github.com/MLGalusha/letter-archive/pull/105)).

- On [Home](https://voicesthatremain.com/), scroll to search, open the filters, then tap the search input and type. Dismiss the keyboard; repeat on [Collection 009](https://voicesthatremain.com/collections/009).
- Expected: input remains reachable above the keyboard, header does not get stranded offscreen, and dismissing the keyboard restores a usable page. Opening/closing filters should feel predictable; the pending filter ticket covers dismissal when typing and mobile panel layout.
- Type a different query quickly, change sort, then clear the query. Expected: your input updates promptly; results eventually correspond to the latest controls, with no stale results replacing newer ones.

Observation: ___

## 3. Search matches and preview placement

**Status: transcript-first search and accessible preview controls already live.** [PR 98](https://github.com/MLGalusha/letter-archive/pull/98), [PR 102](https://github.com/MLGalusha/letter-archive/pull/102). Ordinary previews stayed inside their panels and cards did not move in Chromium/WebKit checks. [Issue 44](https://github.com/MLGalusha/letter-archive/issues/44) remains open for long exact-phrase truncation; [45](https://github.com/MLGalusha/letter-archive/issues/45)'s old hold interaction was replaced by the explicit preview button. Physical-phone checks remain useful.

- Open [search for “he”](https://voicesthatremain.com/?q=he). Open the magnifying-glass preview on a result; on desktop also try keyboard focus and Escape.
- Expected: transcript matches take priority. If a particular result has no transcript match, its explanation may match date, sender, recipient, or location. Format, summary, and hook alone must not produce a typed-search match.
- Expected: the highlighted excerpt stays inside the preview, neighboring cards keep their size/position, and dismissing the preview restores normal interaction. On mobile, use the preview button rather than requiring a long press.
- The baseline snapshot has three results for “he”; searching “ephemera” has none, while selecting that format as a filter can still find its item. This illustrates the difference between text search and filters.
- Known pending case: [this long exact phrase](https://voicesthatremain.com/?q=I+did+receive+your+letter+saying+that+you+were+married+and%0A++honestly%2C+I%27ve+tried+so+many+times+to+write+you%2C+but+somehow%2C+the+words%0A++didn%27t+seem+to+come--at&exact=true) returns a match but currently cuts the highlighted phrase at “so many times…”. Expected after issue 44: the complete matched phrase is supplied and readable, scrolling inside the preview if necessary. Open the link directly; it contains transcript line breaks.

Observation: ___

## 4. Exact phrase, filters, sorting, and navigation

**Status: already live.** [PR 107](https://github.com/MLGalusha/letter-archive/pull/107), [PR 103](https://github.com/MLGalusha/letter-archive/pull/103), [PR 104](https://github.com/MLGalusha/letter-archive/pull/104). Removing obsolete sorting code in issue 32 should not change visible behavior.

- Compare [ordinary “kids the how” search](https://voicesthatremain.com/?q=kids+the+how) with [the exact phrase](https://voicesthatremain.com/?q=kids+the+how&exact=true). The baseline has one ordinary match and zero exact matches: exact mode requires contiguous words in that order.
- Toggle Exact phrase, reload, and use browser Back/Forward. Expected: controls, URL, and results agree. Clear everything and confirm the mode/filter selections reset as shown by the controls.
- Select a sender, recipient, format, and date range separately, then combine them. Expected: selected roles constrain the correct field and incompatible date bounds are explained instead of silently accepted.
- Change sort direction, scroll to load more, then navigate away and back. Expected: no duplicate cards, totals describe all matching items, and selection/order stay consistent with the URL.

Observation: ___

## 5. Scrolling across carousels and reading images

**Status: gesture/carousel fixes pending.** [Issue 10](https://github.com/MLGalusha/letter-archive/issues/10), [11](https://github.com/MLGalusha/letter-archive/issues/11), [20](https://github.com/MLGalusha/letter-archive/issues/20), [21](https://github.com/MLGalusha/letter-archive/issues/21), [23](https://github.com/MLGalusha/letter-archive/issues/23). Smaller initial reader images already live ([PR 95](https://github.com/MLGalusha/letter-archive/pull/95)).

Issue 10 candidate: carousels now wait for a clearly horizontal gesture before taking control; canceled drags and adding a second finger do not change slides. Reviewed code and automated checks are ready; production release and physical Safari/Chrome checks are still pending. Fullscreen behavior and the other tickets above are separate.

- On [Home](https://voicesthatremain.com/) and [Collection 003](https://voicesthatremain.com/collections/003), begin a mostly vertical swipe over a carousel. Then deliberately swipe horizontally.
- Expected: vertical movement scrolls the page; horizontal movement changes the carousel image. A carousel containing one highlight should behave as a static item. Dots should follow the visible image without clipping.
- Open [a two-page letter](https://voicesthatremain.com/letter/0b5e626d-01bb-4026-a4fa-a6ebdf180c7d), enter fullscreen, swipe pages, zoom/pinch, and pan.
- Expected: the initial image looks clear at its displayed size. Zoom can request higher detail. Fit-to-screen page swipes and zoomed-image panning should not fight each other; ordinary page swiping should not unexpectedly open another letter.

Observation: ___

## 6. First load and deeper scrolling

**Status: earlier payload/image/pagination improvements live; remaining image contention and phone validation pending.** [Issue 96](https://github.com/MLGalusha/letter-archive/issues/96), [issue 50](https://github.com/MLGalusha/letter-archive/issues/50).

- Visit [Home](https://voicesthatremain.com/) after not using it for a while. Notice when controls appear, when cards appear, and when their images appear. Repeat immediately to compare a warm visit.
- Scroll steadily through results, then try a faster scroll. Change search or sort while images are arriving. Repeat on [Collection 003](https://voicesthatremain.com/collections/003).
- Expected: visible images fill in, controls remain responsive, new pages do not repeat cards, and the list eventually reports completion. Record persistent blank images, a freeze, or unusually long waits and approximately how far down you were.
- Earlier work reduced some downloads and unnecessary initial result fetching. It does not prove all cold starts, image waits, or deep-scroll problems are solved. The new image scheduler must be evaluated for image completion as well as search responsiveness.

Observation: ___

## Change log

- Initial checklist: created alongside old-ticket reconciliation and issue 32 cleanup. Safari and Chrome coverage applies across the public site, including the iPhone 13. New implementation/deployment results will be recorded here as work lands.
