# Bounded image transforms (#96)

## Decision and limits

Use **two active transforms**, at most **32 queued distinct jobs**, and at most **64 attached callers** per API process. The measured local tradeoff favors two over one (which roughly doubled completion time for 24 images) and over three (higher search response tails and memory). This is a conservative starting setting, **not a measured optimum for the one-CPU Cloud Run instance**. No cloud resources, worker-pool settings, encoders, image quality, or database schema changed.

The scheduler wraps creation/execution of Sharp pipelines on resized cache misses. Original streams and completed cache hits bypass it. Identical public page/version/width/format misses share one job; the previous backend had only a completed-buffer cache, so this adds in-flight coalescing while leaving the frontend preload service intact. Private transformations are not shared. Queued jobs retain closures rather than decoded buffers. The existing completed-image LRU remains capped at 1,000 entries; converting it to a byte budget is outside this change.

Every caller passes the original access check, then its own publication/admin and source-version recheck after generated work. File mtime/size are also rechecked before delivery. Hidden output stays private and never enters the shared cache. A disconnected queued caller detaches; its job is removed if nobody remains. An already-running native transform keeps its active slot until it actually finishes, including when all callers leave. Errors release capacity and settle every remaining caller.

The finite queue admits a cold 24-card burst without overload. Excess work receives `503`, `Retry-After: 1`, and `private, no-store`. Public card/reader loaders retry the same URL/resolution after one and two seconds, then stop; changing source or unmounting cancels scheduled retries. Native image events do not reveal status codes, so permanent 404 failures also consume these two bounded retries. No retry switches to the original scan or adds a cache-busting URL. Preloads remain speculative and do not retry. Persistent failure retains the existing unavailable state; reopening/reloading starts a new bounded attempt. This is recovery from temporary saturation, not a guarantee under sustained overload.

## Controlled comparison

Run from `backend/`, with Docker available and matching backend dependencies installed in both checkouts:

```sh
node --import tsx scripts/benchmark-image-scheduler.mjs \
  --baseline-root=/path/to/baseline-checkout --repetitions=5 > results.json
```

The baseline image route is checked against commit `5a54cce0`; paired search-route source and dependency locks must match. The recorded comparison used the common `5a54cce0` search source before later independent exact-excerpt changes were integrated. To rerun from a newer branch, use its parent checkout with the same search source. The script owns one disposable PostgreSQL container, synthetic published catalogue rows, synthetic image files, and loopback HTTP servers. It invokes the actual image and archive-search routes, not a query stand-in. Each batch starts a fresh Node process and cold application image cache; the search is warmed once before measurement. Five repetitions rotate before/one/two/three configurations. Each batch launches 6 or 24 different image URLs and six typed search requests, staggered by 25ms. All batches run sequentially. Other team builds/browser checks were paused for the final comparison.

The source is the deterministic 2400×3200 JPEG from the earlier mechanism experiment (5,472,048 bytes), copied to distinct paths, transformed to 480px AVIF with the existing quality 60 / effort 2. The fixture JSON is actual search output for 24 synthetic items, not production transcripts. Every one of **1,200 image requests and 480 measured search requests** returned 200; image bytes and decoded search output matched across every configuration. This measures HTTP delivery, not browser decode/paint or real scanned-image complexity.

Environment: Node 20.20.1, macOS arm64, eight logical CPUs, Sharp 0.35.4 / libvips 8.18.6, Sharp concurrency 4, default libuv pool 4. PostgreSQL 16 runs locally in Docker. Node process CPU/RSS exclude PostgreSQL and container resource use. The schema is intentionally minimal and synthetic; no production database, storage, images, or load test was used.

Search columns pool 30 requests per row; p95 uses the nearest-rank small-sample statistic. Image, CPU and RSS columns are medians of five batches. All times are milliseconds; RSS is MiB. “Six images” means the sixth completed request, a proxy for making a small visible group available, not a browser visibility measurement.

| Active limit | Images | Encoding | Search send-to-finish p50 / p95 | Search HTTP total p50 / p95 | Six images | All images | Node CPU | Peak RSS |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| before | 6 | br | 123.4 / 266.4 | 162.8 / 300.4 | 312 | 312 | 1201 | 266 |
| 1 | 6 | br | 2.2 / 8.3 | 36.8 / 66.2 | 561 | 561 | 1064 | 211 |
| 2 | 6 | br | 2.4 / 29.9 | 45.3 / 76.6 | 360 | 360 | 1113 | 233 |
| 3 | 6 | br | 6.6 / 52.0 | 50.0 / 172.5 | 293 | 293 | 1197 | 254 |
| before | 6 | gzip | 98.4 / 164.5 | 167.2 / 260.5 | 320 | 320 | 1230 | 264 |
| 1 | 6 | gzip | 2.3 / 8.7 | 31.7 / 57.2 | 541 | 541 | 1045 | 210 |
| 2 | 6 | gzip | 5.7 / 24.4 | 45.9 / 80.9 | 368 | 368 | 1172 | 231 |
| 3 | 6 | gzip | 6.7 / 33.9 | 59.7 / 286.6 | 293 | 293 | 1149 | 255 |
| before | 24 | br | 665.1 / 1298.3 | 822.5 / 1502.8 | 385 | 1113 | 4429 | 286 |
| 1 | 24 | br | 7.1 / 24.7 | 84.2 / 163.1 | 658 | 2305 | 3994 | 229 |
| 2 | 24 | br | 6.5 / 37.5 | 83.2 / 162.3 | 374 | 1252 | 4210 | 258 |
| 3 | 24 | br | 12.4 / 53.4 | 181.1 / 305.0 | 373 | 1206 | 4550 | 272 |
| before | 24 | gzip | 667.1 / 813.5 | 761.7 / 917.0 | 364 | 944 | 4415 | 296 |
| 1 | 24 | gzip | 6.3 / 17.4 | 62.9 / 165.4 | 581 | 2075 | 3816 | 228 |
| 2 | 24 | gzip | 10.2 / 37.3 | 116.8 / 201.0 | 386 | 1248 | 4225 | 257 |
| 3 | 24 | gzip | 13.6 / 60.9 | 138.3 / 301.1 | 332 | 1035 | 4461 | 280 |

At limit 2, the 24-image Brotli workload reduced the observed response tail from 665/1298ms p50/p95 to 6.5/37.5ms. Six images completed in 374ms versus 385ms, while the full batch took 1252ms versus 1113ms. For gzip the full batch increased from 944ms to 1248ms. This is an explicit image-completion tradeoff, not a claim that every image becomes faster. The additional per-caller database access check had a local median of about 4ms; the second file-stat check about 0.1ms. GCSFuse/remote database costs remain unmeasured.

The tail starts at the existing “Archive search completed” log immediately before response serialization and ends at Express `finish`; it includes serialization/compression/socket handoff and is not a remote user's received/painted time. Client totals are also recorded. The active/queued counters are diagnostic: baseline uses Sharp native counters; candidate uses scheduler counters, so their queue definitions differ. Five-millisecond sampling can miss brief peaks. The raw evidence retains per-request phases, CPU, sampled RSS and event-loop delay: [all final samples](evidence/2026-09-17-image-scheduler.json).

## Correctness and browser checks

Scheduler tests cover FIFO/admission, duplicate waiters, saturation/recovery, failed jobs, pre-aborted/queued/active abandonment, key reuse and listener cleanup. Route tests cover publication/admin revocation after shared work, cache access, database/file replacement and a real HTTP queued disconnect. Full backend suite: 1,269 passed, 52 opt-in SQL cases skipped; typecheck passed.

The browser recovery check serves the actual React components from Vite and intercepts only synthetic image URLs. First response 503/private-no-store then 200 must produce a second real request for the identical width URL and a visible image with nonzero naturalWidth. Permanent failures must stop; source replacement/unmount must cancel scheduled retries. Chromium and WebKit checks cover cards, progressive display with permanently failing lower tier, an already-preloaded image, and the reader. These are local browser-engine checks, not an iPhone 13 hardware claim.

Two real browser findings were fixed during review: WebKit needed a fresh off-DOM Image object for same-URL retry; and visible failed image elements needed replacement after background success even if their src string stayed unchanged. The reader/preloaded case receives the same bounded DOM recovery. Unit regressions preserve those boundaries, source revisits, and fitted-resolution/zoom behavior. All 24 focused frontend tests passed, alongside the full frontend suite (1,201 tests), build and lint baseline (102 existing diagnostics, no increases). [Browser observations](evidence/2026-09-17-image-retry-browsers.json) record actual request counts and decoded-image state.

## Production acceptance and rollback

After the normal release, open the home archive and a collection in Safari/Chrome, scroll several pages, type a transcript search while cards load, open a letter and change pages. Images should recover from brief overload without requiring a reload or downloading originals; normal card bytes/resolution and reader zoom behavior should be unchanged. Check request-correlated image completion logs for active/queued/waiters, queueMs, transformMs, accessRecheckMs, versionRecheckMs, responseMs and overloads, alongside existing search completion/request-finish logs. Original-stream abandonment is not measured by the transform lifecycle listener.

Production acceptance is pending. Do not infer a production latency/cost win or attribute the historical 5.6-second incident from this local experiment. If normal image completion becomes unacceptable or sustained overload appears, revert this focused change; durable prepared variants are a separate follow-up rather than raising concurrency or queue bounds without new evidence.
