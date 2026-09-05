# Public image loading

[Visual comparison](report.html) · [Detailed report](report.md)

The archive preview loader now uses one display-size request per card. Removing whole-result-set reader preloading also reduces small-collection traffic. Image widths, server encoding and publication cache policy are preserved.

[Experiment log and measurements](experiment-log.md) · [Repeatable loop](../../scripts/image-perf-program.md)

Each evidence directory contains a readable `summary.json`, a compressed raw `results.json.gz`, and scroll screenshots. Decompress raw evidence with Python's `gzip` module or `gzip -dc`. It includes individual card readiness samples and image request timings/bytes. All requests are anonymous public browsing.

- `baseline-native`: production before changes, ordinary local connection, two runs per viewport/page.
- `control-4g` / `single-4g`: identical preview serving, live production image API, two fast-scroll runs per viewport.
- `small-collection-control` / `small-collection-trim` / `small-collection-control-repeat`: isolate reader-sized speculative loading in Collection 007, including a reversed warm control.
- `production-before-4g` / `production-after-4g`: matching fast-scroll trials directly on production before and after deployment.
- `production-after-native`: matches the original native-connection baseline.
- `production-before-revisit` / `production-after-revisit`: first and repeat visits within the same browser context.
- `production-single-image-check`: a short production check after PR 79, before PR 80 deployed.
- `production-after-small-collection`: verifies Collection 007 after PR 80 deployed.

The final production comparison is captured after both focused fixes deploy; see the report and final evidence directories below. These artifacts are measurements from one Chromium browser on one machine; they do not establish field performance or guarantee zero delay on other connections.

## Delivery

Both code fixes are merged and deployed:

- [PR 79](https://github.com/MLGalusha/letter-archive/pull/79): one native 480-pixel archive preview per card. Main revision `b1d7353e4a468bf92ad9a496b43f1facfc95581d`. [CI and release passed](https://github.com/MLGalusha/letter-archive/actions/runs/33950834044); Cloud Build `ee5691b7-defa-4c38-b98d-1538c3b5de60` succeeded.
- [PR 80](https://github.com/MLGalusha/letter-archive/pull/80): remove whole-result-set reader preloads; add the browser regression and experiment harness. Main revision `ec72790c8bbcb51020ef3d000bf80fb9ca555152`. [CI and release passed](https://github.com/MLGalusha/letter-archive/actions/runs/33951408324); Cloud Build `5236173e-5ae8-44f8-86e9-fda4211a0fd6` succeeded.

Required unit tests, builds, type checks, lint, dependency audits, mocked browser tests and browser smoke tests passed. The broader full E2E suite remains manually triggered and was not run by these PR pipelines. No review threads were outstanding on either merged PR.

The performance comparison and live UI verification measured frontend revision `ec72790c8bbcb51020ef3d000bf80fb9ca555152`. The unchanged backend remained on `d3de8948c6e1ca10813f3cca8873ed9fb6cf2d3f`, with healthy readiness and database connectivity. No backend, deployment configuration or migration files changed in this series.

The final report delivery also guards native image telemetry against a missing Resource Timing entry after long browsing sessions. Its elapsed-time test passes without affecting image URLs, sizes or scheduling. The final deployment proof is recorded on the report delivery PR; the full before/after measurements above retain their exact measured revision.
