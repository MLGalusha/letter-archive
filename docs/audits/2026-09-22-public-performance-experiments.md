# Public performance experiments — September 22, 2026

The accepted application change from this pass is deferred admin-route loading
for public server startup. See [startup measurements and tradeoffs](2026-09-22-public-startup.md).
Collection-image sequencing and a smaller archive preload buffer were tested
and rejected. No frontend source changes from these experiments remain.

## Controlled browser setup

Baseline frontend: `e9523f7eba8ef5ab43dbc8d6d8e152758af329c1`. Compare production
builds against the same anonymous, saved API/image responses. Freeze client-side
random highlight selection too: freezing only the API does not freeze the
featured letter. Disable external fonts consistently. These controls remove
content and font variation; they do not reproduce every production condition.

Use a dedicated headless Chromium session. A background headed window produced
missing LCP observations and was excluded. Mobile conditions: 390×844, DPR 3,
4× CPU slowdown, 150 ms network latency, 200,000 bytes/sec download and 93,750
bytes/sec upload. Disable the browser cache; the fixture server sends no-store.
Warm the saved response set before comparing builds. Alternate variant order.
Do not run local builds/tests during timed comparisons. Other processes on the
shared computer can still add noise.

`scripts/performance-fixture-server.mjs` serves an anonymous GET-only replay API
on loopback port 4310 and gzip-compressed static builds on ports 4311/4312.
Responses are frozen by path and Accept header; upstream reads are capped at 250
per server process. It forwards no authentication and rejects write methods.
This is a lab tool, not a production proxy or a caching recommendation.

`scripts/capture-public-performance.js` installs a capture function using a
Playwright CLI `run-code` callback. It records completed encoded image bytes,
requests, LCP, and sampled visible-image readiness. Samples every 50 ms sum the
time each visible image is not loaded. **Summed image-wait time is not elapsed
page wait, paint confirmation, INP, or a field percentile.** Simultaneously
waiting images contribute separately. Swiping timings include the automated
click/scroll and transition, so they are not INP either.

## Results and decisions

### Collection image admission

Completely deferring hidden display images reduced speculative requests but
made the next swipe slower: approximately 0.57–1.1 seconds versus 0.10–0.18
seconds in the exploratory comparison. Rejected. An IntersectionObserver
callback also reported `isIntersecting=true` for a clipped, zero-area carousel
edge; admission changes must account for actual useful visibility.

Five frozen-content pairs then tested visible-card priority hints without
stopping neighbor preparation. Median LCP was 3,832 ms baseline and 3,988 ms
candidate. No convincing improvement; reverted.

Five further pairs sequenced hidden-card preparation after the visible card was
ready while letting explicit selection bypass the queue. Median LCP was 3,792
ms baseline and 3,804 ms candidate. Both completed 431,235 image bytes in 28 image
requests in the initial observation window. Median click-to-loaded-image was
125 ms baseline and 112 ms candidate, with substantial outliers. This does not
justify added loading state; reverted. Priority hints alone do not establish a
loading-speed improvement.

### Archive lookahead: 1200px versus 800px

Only the archive card's `PreviewImage` preload margin changed in the final paired
experiment. Image size/quality, cache policy, reader thumbnails and UI layout did
not change. The existing component default remained untouched.

| Fixed mobile journey | Current 1200px | Candidate 800px | Decision |
| --- | ---: | ---: | --- |
| Initial image bytes | 398,897 | 285,396 | Saves 113,501 bytes / 28% |
| Fast down-and-back image bytes | 1,984,486 | 1,893,958 | Saves 4.6% |
| Fast down-and-back summed image wait, median of 5 | 36,997 ms | 32,854 ms | Improves 11% |
| Normal down-and-back summed image wait, median of 3 | 1,248 ms | 6,298 ms | **Regresses about 5×** |

The fast journey moved 700px every 350 ms for 12 steps and immediately reversed
for 12 steps. The normal journey used 700px every second for eight steps and
reversed for eight. Both began after six seconds and observed another 1.5 seconds
after scrolling. The normal-scroll regression is large enough to reject the
change despite lower transfer. Keep 1200px until another candidate improves
both transfer and visible readiness. Do not infer a site-wide speedup from
fewer initial bytes or a single scroll pattern.

## Reproduce the archive comparison

From a clean baseline checkout with dependencies installed, build once with
`VITE_API_URL=http://127.0.0.1:4310`, using Vite output directory
`../output/performance/baseline`. Add `preloadMargin="800px 0px"` only to the
`PreviewImage` in `frontend/src/components/LetterCard/LetterCard.tsx`, then build
to `../output/performance/candidate`. Revert that one experiment afterward.

Run `node scripts/performance-fixture-server.mjs` from the repository root.
Use a dedicated Playwright CLI session, open the local baseline, and install
the callback from `scripts/capture-public-performance.js` using `run-code`.
Invoke it with:

```js
async page => await page.capturePublicPerformance({
  origin: 'http://127.0.0.1:4311', // 4312 for the candidate
  route: '/', scroll: true, reverse: true, steps: 12, interval: 350,
})
```

Save each result separately. Alternate origins for five pairs. Repeat using
`steps: 8, interval: 1000` for normal scrolling. Desktop options are
`width: 1440, height: 900, dpr: 1, cpu: 1`; they retain the constrained network.
Run one warmup of each journey before recording comparisons. Check that the
replay server never exhausts its upstream cap or returns errors. Saved fixtures
and raw results live under local `output/performance/`; do not commit anonymous
content snapshots or interpret replay timings as live backend timings.

Local receipts for this pass include `fixed-*.json`, `sequenced-*.json`,
`archive-reversal-*.json`, `archive-steady-*.json`, `archive-desktop-*.json`,
`experiment-summary.json`, and `final-startup-comparison.json`.

## Remaining acceptance and next experiments

The collection showcase on slow connections remains unresolved. Inspect resource
discovery, preview usefulness and image transfer together; do not shrink image
quality or stop useful preparation to improve just one number. Preserve
publication revocation and protected-media caching rules. No evidence from this
pass justifies a framework rewrite or always-warm paid instances.

Keep the existing race, image-retry, navigation and archive-return browser tests
as gates. Retest the other agents' completed reader/fullscreen work against the
same frozen journeys, including rapid selection, zoom while loading, repeated
open/close, Back/Forward, disconnect/reconnect and delayed/out-of-order responses.
Physical iPhone Safari, Chrome and Home Screen acceptance remains separate from
desktop WebKit automation. Neither this lab nor the startup PR certifies every
public route, every network or absence of all regressions.

## Research behind the decisions

- [Google: optimize LCP](https://web.dev/articles/optimize-lcp) — distinguish
  discovery delay, transfer and rendering; a heading LCP can hide image waits.
- [Google: fetch priority](https://web.dev/articles/fetch-priority) — priorities
  are hints; verify the resulting waterfall rather than assuming a benefit.
- [MDN: requestIdleCallback](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestIdleCallback)
  — main-thread idle scheduling does not establish spare network bandwidth.
- [MDN: HTTP caching](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching)
  — preserve freshness and access requirements while optimizing reuse.
- [Meta: rebuilding Facebook.com](https://engineering.fb.com/2020/05/08/web/facebook-redesign/)
  — inspect serialized code/data discovery and prioritize useful work.
- [Meta: BrowserLab](https://engineering.fb.com/2016/08/31/web/browserlab-automated-regression-detection-for-the-web/)
  — repeatable regression measurement; historical engineering guidance, not a
  prescription to adopt a framework.

Related investigations: [#50](https://github.com/MLGalusha/letter-archive/issues/50),
[#123](https://github.com/MLGalusha/letter-archive/issues/123),
[#130](https://github.com/MLGalusha/letter-archive/issues/130). Their broader
acceptance criteria remain open.
