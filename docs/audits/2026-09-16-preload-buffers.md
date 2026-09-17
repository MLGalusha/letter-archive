# Archive preload buffer experiment — issue #86

Reduce pagination lookahead from 2,400px to 1,800px; retain the existing 1,200px image lookahead. This avoids an unnecessary early second results page in the measured desktop layouts while preserving image readiness during normal scrolling. It does **not** reduce initial card-image bytes. Smaller image buffers saved early bytes but worsened fast-scroll readiness, so they are not included.

## Conditions and method

Measurements used production frontend builds from `c99f3daec568703599357bfb368a3f519fef4792`, differing only in the tested margins, and the public backend at the same release. The final candidate changes only pagination. The catalogue had 94 home results and 35 results in collection 003. Both builds used identical dependencies, browser and API path. The production site was not modified.

- Desktop: 1440×900 CSS pixels, DPR 1. Mobile: 390×844, DPR 2. Both Playwright viewport and CDP device metrics were set; the recorded browser dimensions agree.
- Browser cache disabled; CDP network settings: 80ms latency, 500,000 bytes/second download and upload (about 4 Mbps). CPU unthrottled.
- A loopback GET-only proxy fetched public API responses without credentials. This let actual browser requests receive CDP throttling; intercepted/fulfilled Playwright responses do not provide the same network experiment. The proxy decompresses API responses and strips encoding/length headers, so byte totals are **local experiment transfer sizes**, not production compressed JSON sizes. Image bodies are unchanged.
- Each navigation settled for six seconds before the initial sample. Normal scrolling: 350px every 700ms. Fast scrolling: 700px every 350ms. Home used 12 steps, mobile collection 16 normal / 12 fast steps, desktop collection eight normal steps. Each finished with a 1.5-second settling period. Scrolling used the actual `#app-scroll` element.
- The final paired comparisons ran candidate then baseline. Earlier passes warmed the public image variants. Server cache and instance state were not controlled. These are small lab samples, not field percentiles or evidence about cold starts.
- Every 50ms, visible card image elements were checked for `complete && naturalWidth > 0`. Waiting time accumulates only while a card is visible. The summed card-wait column adds waits across cards, so it is **not elapsed page wait**. This detects missing images, not decode/paint completion or letter readability. It also does not measure time waiting for an unmounted result page.
- Bytes come from CDP `loadingFinished.encodedDataLength`, including headers. Pending requests have no completed byte count. Card traffic is separated using the existing 480px preview URL; total image traffic also includes hero/carousel work, which varied between collection runs.

## Final policy: unchanged image buffer, smaller page buffer

Initial samples, before scrolling:

| Route / viewport | Policy | Search pages | Result cards mounted | Card images requested | Completed card-image bytes |
| --- | --- | ---: | ---: | ---: | ---: |
| Home desktop | 1200 image / 2400 page | 2 | 48 | 16 | 506,675 |
| Home desktop | 1200 image / 1800 page | 1 | 24 | 16 | 506,532 |
| Collection 003 desktop | 1200 / 2400 | 2 | 35 | 16 | 363,698 |
| Collection 003 desktop | 1200 / 1800 | 1 | 24 | 16 | 363,693 |
| Collection 003 mobile | 1200 / 2400 | 1 | 24 | 10 | 217,924 |
| Collection 003 mobile | 1200 / 1800 | 1 | 24 | 10 | 217,988 |

Home initial search transfer changed from 20,917 to 10,392 bytes through the proxy; desktop collection from 14,442 to 9,349. The useful result is one fewer early request and fewer mounted cards. The approximately equal image bytes show why this is not an image-compression win. These are geometry-dependent observations; other viewports, or an already-scrolled user, may legitimately fetch another page immediately.

Visible-card readiness:

| Route / scroll | Policy | Cards observed | Cards with any wait | Longest visible wait | Sum of card waits |
| --- | --- | ---: | ---: | ---: | ---: |
| Home desktop normal | baseline / candidate | 52 / 52 | 0 / 0 | 0 / 0ms | 0 / 0ms |
| Collection desktop normal | baseline / candidate | 35 / 35 | 0 / 0 | 0 / 0ms | 0 / 0ms |
| Collection mobile normal | baseline / candidate | 35 / 35 | 0 / 0 | 0 / 0ms | 0 / 0ms |
| Home desktop fast | baseline / candidate | 94 / 94 | 72 / 74 | 849 / 850ms | 34,281 / 36,200ms |
| Collection mobile fast | baseline / candidate | 35 / 35 | 2 / 5 | 51 / 151ms | 101 / 702ms |

Normal-scroll samples had no observed blank card images. Fast scrolling still produces short waits: the desktop maximum was effectively unchanged; the mobile candidate had a modest worse sample. This does not establish a speed improvement or statistical equivalence. The narrow change trades some page headroom for less initial API/DOM work, retaining a 600px gap before the image buffer. A slower API or faster scrolling can still outrun it; monitor those cases rather than adding a queue without evidence. Fast home and collection runs reached all 94 / 35 results with the correct end message.

## Rejected changes and important limits

An 800px image / 1200px page candidate reduced initial home image traffic from about 542KB to 409KB. However, an earlier warmed fast-scroll comparison increased cumulative card-wait from 37.1s to 50.0s and the maximum from about 2.05s to 2.15s. A 1000px / 1800px candidate had mixed results: a lower maximum (1.2s) but more cumulative waiting (47.5s). Because those experiments changed both margins, they cannot attribute the difference to either margin alone. They justify caution, not an optimal threshold claim. The final experiment isolates pagination.

The first, less-warmed baseline normal-scroll pass had visible waits up to 4.2s with many image requests still pending. A repeat of the same policy had zero observed wait. This is a diagnostic sign that server/cache/transform conditions matter considerably; it is not proof of a specific backend bottleneck. A smaller frontend buffer cannot be claimed to solve it. Keep the separate response-contention work in #85 and cold/warm production verification separate from this margin choice.

## Functional verification and reproduction

The candidate passed the existing PreviewImage, HomePage, CollectionDetailPage and useArchiveSearch tests (36 tests), the production build, and the lint baseline (103 existing diagnostics; zero increases). Browser checks confirmed query `war` resets to one card, adding the photo filter yields zero cards, Clear All restores the 94-item archive, and navigating to Collections then Back restores `?q=war`, the input and its one result. Clearing while already near the shelf correctly loaded a second page; the change is not a fixed page-count cap. Fast-scroll runs verified both end-of-results messages.

[Results](evidence/preload-buffers/results.json) contain derived per-run request/byte counts, actual dimensions and per-card wait samples. Full local browser output is under `output/playwright/preload86-*.txt`; it is not required to read the table and is not committed. The capture started during a build was discarded and excluded from the evidence.

For a repeat, build baseline and candidate with `VITE_API_URL=http://127.0.0.1:3009` and serve them on separate local preview ports. Start the [public read proxy](evidence/preload-buffers/read-proxy.mjs) with Node. Run the [capture setup callback](evidence/preload-buffers/capture.js) once in a Playwright CLI session, then call `page.__capture` with the origin and the parameters recorded in the results. Use a fresh session if reinstalling setup to avoid duplicate observers. The proxy deliberately rejects telemetry POSTs to `/images/perf` with 405; these appeared between experiments and do not represent an image failure. Do not use this proxy for authenticated workflows.
