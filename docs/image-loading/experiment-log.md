# Public image loading experiments — 2026-09-05

Protected handwriting checkout left untouched. Branch: `improve-public-image-loading`.
Cloud configuration and billing settings are read-only. Measurements are serial ordinary browsing.

## Method

Run `node e2e/scripts/image-scroll-benchmark.mjs --label NAME --runs 2` from the repository root. Requires the existing e2e dependencies/browser. The script writes raw request timings, actual transferred bytes from Chromium, visible image readiness samples, and screenshots under `docs/image-loading/NAME/`.

Each fresh browser context visits the homepage or Collection 009, waits two seconds after the first letter card mounts, moves that card near the top (featured card on Home; archive card on collection pages), then scrolls 65% of the viewport 16 times without waiting for image completion. After five seconds to finish outstanding loads, it returns to the top. Viewports: 390×844 and 1440×1000, both DPR 2. No CPU throttle. `--network 4g --step-ms 400` adds a 4 Mbps download / 3 Mbps upload / 80 ms simulated latency profile and faster scrolling. This is a controlled browser scenario, not a physical phone or a field percentile.

The primary measures are wait from first entering view to full-quality display (including any CSS opacity transition), unresolved images, cumulative visible time spent waiting, request count and wire bytes. P75 request duration separately captures delivery time even for images that finish before scrolling into view. An image completed before entry records zero visible wait. Unresolved images remain explicit, not silently removed from the report. The early/late groups and individual waits are retained in raw data.

`--assets /absolute/build/path` locally substitutes a production frontend build at the production page origin while leaving the production API and image requests live. Both control and candidate use the same substitution. CDP intercepts only frontend resources, preserving the normal image cache. Initial HTML/JS timing from these trials is not a production navigation comparison. Production before/after trials use no substitution.

## Experiments

1. **Baseline:** production revision `d3de8948`. Native connection, two runs per page/viewport. Homepage scrolls issued 265 image requests on mobile / 283 on desktop. One mobile run observed 4.58 s delivery and a 3.3 s visible wait. Later runs were faster: server cache state is uncontrolled and must not be mistaken for a code improvement.
2. **Harness correction:** discarded the initial preview comparison because Playwright routing disabled the HTTP cache, duplicating image requests. Replaced it with frontend-only CDP interception. Discarded results are excluded from conclusions.
3. **Single image per archive card:** replace 32 → 240 → 480 pixel progressive tiers with one native 480 pixel image. Preserve the 1200 pixel loading margin and final resolution. Remove the second visibility observer, detached Image objects and fade delay from archive previews. Native image load telemetry remains. Hypothesis: fewer server transforms/requests, less queueing and less unnecessary data without a quality reduction. Comparison in progress.

## Acceptance

Keep changes only when repeatable browser measurements improve resource use and scrolling readiness, image resolution and visible layout remain intact, and relevant unit/browser checks pass. Do not optimize one percentile by leaving images unresolved or by lowering the final resolution. No long-lived public image caching changes: publication revocation still requires revalidation. Rejected experiments are removed only from this branch's own changes, never by resetting the protected checkout.

### First comparison outcome

Two trials per viewport, identical controlled fast-scroll scenario, normal image caching:

| Metric | Mobile control → single image | Desktop control → single image |
|---|---:|---:|
| Image requests | 265 → 90 | 283 → 96 |
| Image wire bytes (mean) | 3,123,900 → 2,351,355 | 3,281,271 → 2,472,061 |
| P95 readiness after first entering view | 600 → 0 ms | 3,051 → 350 ms |
| Cumulative time visible cards spent waiting (mean) | 7,875 → 0 ms | 53,033 → 4,808 ms |
| Unresolved images | 0 → 0 | 0 → 0 |

**Keep.** Request count falls about 66%, image bytes about 25%, and waits improve without changing final resolution. Percentiles above are means of two per-run percentiles, not population estimates. Cards can finish loading after scrolling out of view; cumulative visible waiting counts only the time actually on screen. A zero means ready by the first 50 ms observation, not literally zero network latency.

### Small-collection speculation

Removed the ArchiveList effect that fetched an 800-pixel reader image for every result whenever total results were ≤20. The existing bounded three-letter collection preloader and deliberate hover behavior remain for now.

Collection 007, with the single-image card loader already applied, requests fell from 47 to 30–31 and image bytes from roughly 1.5 MB to 0.7 MB. Initial control included cold transforms and an 8-second tail, so that delay is not attributed entirely to this change. A later control rerun still sent 47 requests / 1.52–1.54 MB; mobile P95 readiness was 1.70 seconds versus zero in both trimmed trials. Desktop cards were effectively ready in both. **Keep for the repeatable resource saving; avoid claiming an 8-second guaranteed speedup.**

### Final production verification

After both UI fixes deployed as `ec72790c`, the same production fast-scroll scenario measured 283 → 96 desktop image requests and 3.28 → 2.47 MB. Desktop per-run P95 readiness was 2.45–3.05 seconds before and 0.40 seconds in both after trials. Mobile requests were 265 → 90, with P95 readiness 0.50–0.70 seconds → zero at the 50 ms sampling interval. Every paired run requested the exact same set of 480-pixel preview URLs.

On the ordinary connection, all observed post-change scrolling previews were ready at their first visible observation. The browser cache already saved most transfer on repeat visits; the second desktop visit changed from 283 requests / 11,883 wire bytes to 96 requests / 4,422 wire bytes. The final small-collection production check sent 31 requests / 0.68–0.72 MB.

Final report delivery includes one instrumentation correction: measure native image load elapsed time even after the browser's Resource Timing buffer fills. A regression test supplies no Resource Timing entry and verifies a 250 ms load is recorded as 250 ms, not zero. The scrolling benchmark does not consume that telemetry and its results remain independent.

### Review corrections

Production runs now abort if either deployment-revision lookup fails, returns a non-success HTTP response or lacks a valid revision. Local/substituted previews may explicitly proceed without a deployed revision. Six Node checks cover these cases and run ahead of the mocked browser suite in CI. Revisit artifacts' overall cache description was corrected to match the already-recorded per-run `cacheState`; raw measurements and results were not changed.

## Final release check: performance is still inconsistent

The final timing-guard frontend d2c1047 deployed successfully through main CI 33953391334 and Cloud Build ad2db486-3a9e-42d8-8525-cfb22e47cc65. The backend remained d3de8948, with successful health/readiness checks. Functional public UI checks also passed on both viewports.

A final fresh-browser 4 Mbps / 80 ms fast-scroll check exposed a remaining delay. Mobile ended with 20 of 50 observed scrolling cards unresolved; desktop ended with 47 of 90 unresolved. P95 among completed cards was 8.35 / 8.00 seconds and excludes unfinished images. The incomplete run must not be used to claim byte savings. Median response-header waits were 6.0 / 4.4 seconds. Read-only Cloud Run logs confirm multi-second image requests and new backend instance starts during this interval. Cache misses or cold starts are plausible contributors; the logs do not isolate database, storage, encoding or queue time.

A repeat at the same release completed every image and confirmed 90 / 96 requests and 2.35 / 2.47 MB, but P95 remained 2.65 seconds mobile / 2.00 seconds desktop. These results qualify the earlier paired comparison; the 400 ms desktop result is not a consistent service-level claim. Both raw runs, screenshots, summaries and allowlisted cloud observations are retained. The visible report leads with these late results. No cloud resource configuration changed.

The next backend investigation should distinguish per-request publication lookup, mounted-file access, transform-cache hit/miss and encoding time. Any persistent preview storage or warm-capacity changes need a cost discussion first. The existing in-process cache disappears with an instance; this is code evidence, not proof that it alone caused the observed stalls.
