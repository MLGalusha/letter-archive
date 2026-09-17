# Saved reader variants (#128)

The production audit measured 1200px image transforms taking 1218–3409ms. The existing durable store admitted only 480px, so an instance without that reader image in memory had to generate it again.

This change admits exactly 480, 800, 1200 and 1600px, matching `scanResolution.ts`. It retains the existing store, source/version/format identities, public access rechecks, conditional responses, read/write limits and transform scheduler. Other widths and originals keep their existing behavior. No archive backfill or cloud configuration change is involved.

## Controlled validation

Run from `backend/`: `node --import tsx scripts/measure-saved-reader-variants.mjs`. The script uses a checked-in scan, temporary local storage, and a separate Node process for each generation and reuse. It asserts identical bytes and ETags and zero transformations on the reused result. It does not connect to a database or the network.

One local run on 2026-09-17:

| AVIF width | Generation + save | Fresh process saved read | Image bytes |
| --- | ---: | ---: | ---: |
| 480 | 119ms | 0.75ms | 13,566 |
| 800 | 165ms | 0.64ms | 34,693 |
| 1200 | 416ms | 1.06ms | 78,994 |
| 1600 | 703ms | 3.50ms | 148,106 |

These are local filesystem operation timings, excluding process startup, HTTP, database access checks and network transfer. They prove reuse avoids encoding; they are **not** production wait-time predictions or a percentage improvement claim. The route tests additionally exercise saved reads without entering Sharp, all four widths, fallback failures, publication/source changes during reads and writes, and concurrent real saved files.

## Cost and limits

Variants are saved only when requested. Each saved representation remains capped at 2MiB; up to four widths and three negotiated formats can exist per source version (a theoretical 24MiB payload ceiling per version, excluding envelope/filesystem overhead). This fixture's four AVIF variants total about 269KiB. Actual archive size depends on scans, requested widths and browser formats. Historical source versions are not garbage-collected by this change.

A first miss still incurs encoding and saving, including storage latency. A saved hit still needs authorization/version checks and storage reads. Memory-cache hits and browser 304s are separate paths; neither proves durable reuse. Save failures fall back to serving the generated image. Existing limits remain 40 active store reads, two writes, and a bounded transform scheduler.

After deployment, compare a small fixed reader workload with the audit, correlate request IDs with cache/read/transform timing, and report misses separately from saved hits. Do not force production restarts or generate the whole library to benchmark this change. Physical iPhone 13 Safari/Chrome acceptance remains a manual check.
