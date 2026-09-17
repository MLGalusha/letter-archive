# Public reader startup investigation — issue #130

Status: investigation evidence; **no application or cloud configuration change**. Keep #130 open for an independently validated improvement. Baseline source and live revision: `5b39df608921d398ff2ee56d3cf4d5bf8b000e94` / `letter-archive-backend-r-5b39df6089-039c6744`. Production metadata and historical logs were read on 2026-09-17. No forced cold starts, shared database writes, production load tests, or minimum-instance changes.

## What the measured pause was

Two read requests during collection 003 → reader navigation spent approximately three seconds waiting for **new instances**, although their actual application work took only 25–34ms. Five image requests completed on two *other* instances during the same startup window. This was scale-out while other instances were active, not evidence that the entire service had been idle at zero. Logs identify `AUTOSCALING`, but do not distinguish CPU saturation, concurrency, pending capacity, or unrelated traffic as the trigger.

| Milestone, UTC 2026-09-17 | Detail instance (suffix `de6e537f`) | Adjacent instance (suffix `44123cfb`) |
| --- | ---: | ---: |
| Platform request timestamp | 06:06:22.756576 | 06:06:22.757357 |
| Starting new instance | 06:06:22.792235 | 06:06:22.782425 |
| GCS Fuse reports successful mount | 06:06:23.139924 | 06:06:23.147582 |
| OpenAI client initialized log | 06:06:25.428872 | 06:06:25.679177 |
| Server started/listening log | 06:06:25.504217 | 06:06:25.792597 |
| Startup HTTP probe succeeds, second attempt | 06:06:25.903256 | 06:06:26.036654 |
| Application request completes | 06:06:25.940943 | 06:06:26.064464 |
| Application readiness request duration | 15ms | 55ms |
| Application reader request duration | 34ms | 25ms |
| Platform request latency | 3.063s | 3.214s |
| Browser request duration | 3.250s | 3.368s |

Platform and application timestamps come from different instrumentation; do not subtract them into an exact additive latency budget. The mount-to-listen interval is approximately **2.36–2.65 seconds**, and listen-to-probe-success is **0.24–0.40 seconds**. There is no process-entry timestamp, so the first interval cannot yet be attributed entirely to JavaScript imports. The early generic “GCSFuse is mounted” platform log precedes the actual Fuse success message; the table uses the latter.

Existing instances with suffixes `aa029fc0` and `4813cae5` completed image requests at 06:06:22.831575–22.917446, with application durations 81–205ms. Their presence establishes active capacity, not why the autoscaler added more. Later warm reader navigation returned detail/adjacent in 170/123ms in the browser. These few observations are not percentiles or a site-wide average.

Correlation identifiers from the original audit:
- Detail request `5cfa62a8-6c71-43bd-aa70-5adc012d056c`, trace `fe1383c880eadaf2d7a80da6694dc2d6`, 950 decoded response bytes.
- Adjacent request `b8e9c4f1-7eab-4916-9970-044d794728ad`, trace `6d061f02b38558b8d7a80da6694dc533`, 501 decoded bytes.
- Both paths are under `/letters/be6ef848-a8f9-4696-9097-646d4257562a`.

## Configuration and source path

Current service: `letter-archive-backend`, project `letter-archive-485110`, region `us-east1`. Revision minimum is **0**, maximum **5**, concurrency **40**, **1 vCPU / 1GiB**, request timeout 300s, generation 2. Service metadata additionally has a max-scale annotation of 20; do not interpret that as twenty instances for this revision. Cloud SQL and the archive GCS Fuse volume are attached. CPU boost and CPU-throttling annotations are absent from the inspected revision; this read does not establish effective platform defaults.

`deploy/cloudrun/backend-service.yaml` uses `/health/ready` for the startup probe, period 3s, failure threshold 10; the live revision reports timeout 1s. `backend/src/routes/health.ts` verifies `SELECT 1`. Preserve this database check. Replacing it with `/health` would change readiness correctness, not make the database ready sooner. The Dockerfile's separate `HEALTHCHECK` is not the configured Cloud Run startup probe.

`backend/src/index.ts` statically imports the route graph before calling `app.listen`. `routes/index.ts` includes admin/AI routes as well as public ones. The database pool is constructed at import; readiness queries happen later. `runBootChecks`, lease reconciliation, notification broadcaster initialization, and sweeper startup run **after listening**; their asynchronous work is not awaited before listen. Removing these correctness mechanisms is not supported by this evidence. Production file logging is already disabled. Migrations are a separate release job; the API's boot check inspects migration status rather than applying migrations.

The OpenAI initialization log is a milestone, not a timer proving that constructing its client consumed the preceding interval.

## Safe local experiment

`scripts/profile-startup-imports.mjs` dynamically imports a compiled entry in a fresh process, denies Node socket/HTTP/fetch transport, and intercepts `listen` without invoking its callback. This prevents the boot recovery, sweeper, migration-status check, and dev-admin seed from executing. It disables dotenv loading and supplies an unusable database URL. It is an import experiment, **not a general security sandbox**, and does not test database readiness, Linux containers, GCS Fuse, routing, or cloud allocation.

Reproduction after installing the locked backend dependencies and running its build, from repository root:

```sh
node scripts/profile-startup-imports.mjs index
node scripts/profile-startup-imports.mjs routes/admin/index
node scripts/profile-startup-imports.mjs routes/letters
```

Five fresh-process runs per target on local macOS arm64 / Node 20.20.1, with no network allowed:

| Imported graph | Median wall time | Range | Median process CPU time |
| --- | ---: | ---: | ---: |
| Full entry, listen intercepted | 228ms | 228–1366ms | 425ms |
| Admin router | 205ms | 200–215ms | 384ms |
| Public letters router | 90ms | 88–91ms | 128ms |
| Health router | 71ms | 70–72ms | 95ms |
| Processing queue | 62ms | 62–63ms | 85ms |
| OpenAI client module, no API key | 57ms | 53–59ms | 114ms |

These graphs overlap; **do not add or subtract their timings as exclusive module costs**. CPU totals can exceed wall time due to native/worker activity. The very first full-entry run was 1366ms and subsequent ones ~228ms: local file/native caches substantially affect this experiment. No API client construction with a real key was measured.

A bounded experiment bundled only project JavaScript with esbuild (`--bundle --platform=node --format=esm --packages=external`) and alternated eight fresh processes for each entry. Original median was **237ms** (220–499ms); bundle median **225ms** (187–680ms). That small difference and overlapping ranges do **not** justify changing the production build. The experimental bundle remains an ignored build artifact. Broad lazy-router work would add failure-handling and first-admin-request complexity and is not justified by these numbers alone.

## Recommended order and tradeoffs

1. Finish #131's immediate pending feedback and independent letter rendering. This improves perceived response even during startup but does not remove the server wait. Finish #129/#127/#128 to reduce avoidable image work and repeat resizing. Reduced scale pressure is plausible, not yet measured.
2. Add narrowly scoped startup phase timing before considering an import refactor: process-entry → imports evaluated → listening → first readiness query/result. A tiny bootstrap with a dynamic import of the unchanged server can establish the missing entry timestamp without lazy-loading individual routers. Preserve failure propagation and existing fatal-error reporting; measure logging overhead. This is the most bounded implementation follow-up.
3. Collect naturally occurring starts after those changes and compare the same image/revision/configuration. Record failures as well as success. Correlate instance count, CPU/concurrency metrics, and image transform activity around scale-out; do not infer a cause from a single shared timestamp.
4. Only if probe delay is material, test period 1s with a correspondingly adjusted failure threshold in an isolated environment, preserving roughly the current startup tolerance and the DB readiness check. This creates more readiness queries, and the observed 0.24–0.40s listen-to-success gap is only an upper bound on what cadence might save in these two starts. No blanket “three seconds faster” claim.
5. Intent-based reader prefetch or a small client reuse cache may hide waits for repeated navigation. They also spend requests on abandoned intent and need explicit freshness/unpublish behavior, bounded entries, request deduplication, and abort handling. Do not add catalogue-wide detail prefetch or a cache that bypasses access checks.
6. Startup CPU boost is an optional measured capacity experiment, not a free fix. Google documents a boost from 1 to 2 CPUs during startup and 10s afterwards, with additional allocated CPU billing. First establish effective current settings; absence of an annotation is insufficient. It may help CPU work, not external waits. Leave minimum instances at zero. Always-warm capacity has ongoing cost and would not prevent every scale-out cold start; it is not the default recommendation.

Do not tune database queries to solve this particular three-second gap: those measured handlers are already tens of milliseconds. Do not extend public cache lifetimes without preserving publication/access semantics. No absolute dollar cost, speedup percentage, or future startup guarantee is established here.

## Validation needed before closing #130

- [ ] #131 pending feedback verified during a controlled delayed response.
- [ ] Missing process-entry/import timing captured without removing readiness checks or startup failure handling.
- [ ] Comparable naturally occurring cold/scale-out and warm samples after a selected change; report sample count, revision, config, and cache state.
- [ ] Verify no unexpected request failure or hidden increase in idle/capacity spend; keep minimum instances zero.

Local raw investigation artifacts are in the `letter-archive-reader-startup` worktree under `output/startup/`: `instance-timeline.json`, `prior-active-requests.json`, `import-profile.json`, `bundle-experiment.json`. Original browser/platform traces are in the `letter-archive-performance-audit` worktree under `output/playwright/`. The tables and request identifiers above preserve the handoff evidence without committing raw operational logs.

References checked 2026-09-17: [Cloud Run health checks](https://docs.cloud.google.com/run/docs/configuring/healthchecks) explain startup gating and probe configuration; [autoscaling](https://docs.cloud.google.com/run/docs/about-instance-autoscaling) describes CPU/concurrency scaling; [startup CPU boost](https://docs.cloud.google.com/run/docs/configuring/services/cpu#set_startup_cpu_boost) documents extra CPU allocation and billing.
