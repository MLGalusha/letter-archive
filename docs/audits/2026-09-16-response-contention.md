# Search response tail investigation (#85)

## Conclusion

A bounded local experiment reproduced a fast query phase followed by a slow compressed response while Sharp occupied the Node worker pool. With six concurrent transforms, median response-tail time was 242ms for Brotli and 194ms for gzip; with no transforms it was below 1ms. Limiting the same six transforms to two active at a time reduced the tail to about 1ms. Prepared image bytes also avoided the delay.

This establishes a mechanism and a candidate mitigation, **not attribution of all 5.6 seconds in the production incident**. No production behavior, cloud resources, publication checks, or search results were changed. No load was sent to production.

## Incident and relevant code

The original audit correlated application and browser request IDs:

| Request ID | Search calculation | App request completion | Browser duration |
| --- | ---: | ---: | ---: |
| `8ebff32d-c882-4e28-9a58-032e524384e0` | 76ms | 5,630ms | 5,728ms |
| `2dd7424f-728a-4330-ba97-280b1cb953ce` | 205ms | 4,340ms | 4,398ms |

`backend/src/routes/letters.ts` logs search completion before `res.json(response)`. It therefore excludes serialization, asynchronous compression, and writing the response. `backend/src/index.ts` enables compression for JSON. `backend/src/routes/images.ts` performs Sharp transforms in the API process on cache misses, using AVIF quality 60 / effort 2 for supporting browsers. The search timer alone cannot establish end-to-end API latency.

Node documents that asynchronous [zlib operations use its internal thread pool](https://nodejs.org/api/zlib.html#threadpool-usage-and-performance-considerations). Sharp exposes the number of transformations [waiting for a libuv worker](https://sharp.pixelplumbing.com/api-utility/#queue). More CPU threads inside an image transform and more libuv workers are separate settings.

## Reproduction

After installing backend dependencies, from the repository root:

```sh
node backend/scripts/diagnose-response-contention.mjs > /tmp/response-contention.json
UV_THREADPOOL_SIZE=8 node backend/scripts/diagnose-response-contention.mjs > /tmp/response-contention-pool8.json
```

The second command is a diagnostic intervention in a new local process, not a suggested production setting. The script binds only to an ephemeral loopback port. It does not import the production app, load environment credentials, query a database, or access archive images. It asserts status, content encoding, and byte-for-byte decoded payload equivalence for every request.

The workload uses one deterministic 2400×3200 synthetic JPEG (5,472,048 bytes), transforms to 480px AVIF, and an 8,979-byte synthetic JSON response. The prepared variant is 60,709 bytes. A 5ms asynchronous query stand-in deliberately separates database time from response delivery. JSON serialization is measured explicitly before sending with the same Express compression middleware configuration. Prepared variants model in-memory cache hits, not storage or CDN latency.

Four workloads run sequentially, with three repetitions and rotating workload order: no transforms; six transforms submitted together; six transforms with at most two active; and six already-prepared buffers. Each is run with Brotli, gzip, and identity encoding. No measured batches overlap. The script waits for every transform batch before moving on.

Environment: Node 20.20.1, macOS arm64, eight logical CPUs, Express 4.22.2, compression 1.8.1, Sharp 0.35.4 / libvips 8.18.6, Sharp concurrency 4. The first run uses the default libuv pool of four. Dependencies were reused from the separately reviewed security update worktree (PR #94); the original investigation branch began at `52a739bc`, whose lockfile still specified Sharp 0.35.3. Actual loaded versions and native libraries are recorded in each evidence file. These results are not measurements of that older binary.

## Measurements

Medians of three samples, milliseconds. These are small diagnostic samples, not percentiles or performance budgets. Other development tasks were running on the host; absolute timings and image throughput can vary.

| Workload | Encoding | Query stand-in | Serialization | Send-to-finish tail | Maximum event-loop delay | Image batch |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| None | br | 6.02 | 0.03 | 0.60 | 7.01 | n/a |
| Six concurrent | br | 9.29 | 0.03 | 241.76 | 17.14 | 497.01 |
| Two active, six total | br | 5.79 | 0.06 | 1.08 | 10.41 | 396.24 |
| Prepared | br | 5.90 | 0.10 | 1.34 | 5.73 | n/a |
| None | gzip | 5.75 | 0.03 | 0.78 | 6.12 | n/a |
| Six concurrent | gzip | 7.75 | 0.03 | 194.48 | 17.15 | 373.90 |
| Two active, six total | gzip | 4.75 | 0.04 | 1.23 | 17.71 | 420.90 |
| Prepared | gzip | 5.81 | 0.07 | 1.04 | 6.55 | n/a |
| Six concurrent | identity | 5.81 | 0.06 | 0.86 | 22.63 | 310.34 |

At response submission, every six-transform sample in the default-pool run had four transforms processing and two queued. Identity encoding avoided the response delay despite this same image workload. Switching from Brotli to gzip did not remove it. Event-loop delays and serialization time were much smaller than the compressed-response tail. In the separate eight-worker intervention all six transforms could run without occupying every worker, and compressed-response tails fell to single-digit milliseconds.

Together these controls support worker-pool waiting as the dominant cause of the **local** response tail. They do not separately measure every compression worker's queue wait versus native execution time. The `responseTailMs` field includes compression, Express bookkeeping, and handing bytes to the local socket; `finish` is not proof that a remote visitor received the response. The script also records client TTFB/total, process CPU, Sharp queue depth, and event-loop timings.

Raw evidence: [default worker pool](evidence/2026-09-16-response-contention.json) and [eight-worker intervention](evidence/2026-09-16-response-contention-pool8.json). The synthetic JSON compresses unusually well (278 bytes Brotli / 412 bytes gzip); the encoding comparison demonstrates waiting, not expected production bandwidth savings.

## Recommended follow-up

Implementation and production verification are tracked in [#96](https://github.com/MLGalusha/letter-archive/issues/96).

First implement a small, bounded image-transform scheduler in the existing API process, with a finite pending queue and clear overload/cancellation behavior. Compare a conservative active limit below the worker-pool size against the current behavior in a controlled staging workload. This experiment supports trying two active transforms; it does not establish that two is optimal for the production one-CPU instance. Preserve authorization and publication validation before any shared result is served.

Acceptance should include mixed image/search p50/p95, image completion time, queue wait, process memory and CPU, and identical search/image output. Record query completion and response finish under the same request ID. Verify errors, client disconnects, and queue saturation release capacity; do not introduce an unbounded queue. Queueing images can delay image completion, so faster search alone is insufficient to accept the change. No new service, paid minimum instance, or permanent thread-count change is needed to test this mitigation.

Avoid disabling JSON compression globally: it trades the demonstrated queueing delay for extra response bytes. Avoid treating gzip as the fix: it showed the same queue competition. Avoid synchronous compression in request handlers: that transfers work to the event loop. Deduplicating identical concurrent image transforms may reduce work but does not protect search when different images arrive together.

If bounded scheduling still cannot meet image and search targets, durable prepared variants are the next architectural experiment. That removes request-time encoding but adds storage, generation/invalidation work, and publication-revocation requirements. Existing image preparation work should own that scope rather than introducing a parallel framework here.

What remains unresolved: exact attribution of the historical production delay; GCSFuse/database effects; real letter image complexity; one-CPU Cloud Run scheduling; mixed traffic volume; and the best concurrency/cost tradeoff. Closing this investigation should track the proposed implementation and production verification separately, without claiming the original latency problem is fixed.
