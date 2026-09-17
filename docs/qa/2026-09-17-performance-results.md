# Public performance fixes: what to try and what we measured

This report separates released behavior from local tests. Try the public links in Safari and Chrome; the automated WebKit/Chromium checks do not replace a physical iPhone 13 check.

## Reader navigation (#131, PR #137)

First verified frontend release: `5e000ed3b01c8ed5e693199a915aca0d1da09790`.

Open [this three-page letter](https://voicesthatremain.com/letter/be6ef848-a8f9-4696-9097-646d4257562a), click Next and use browser Back/Forward. Expected: a pending destination immediately shows “Loading letter...”; old content is dimmed and disabled. The new letter does not wait for its optional next/previous navigation data. Fullscreen closes when leaving a letter.

Live Chromium verification held the adjacency response in the browser: the article and all three scan controls appeared before its release. A second check held the next detail response and observed loading feedback, the correct destination URL, and an inert/busy retained article. Controlled Chromium and WebKit regressions cover failures, stale responses, and fullscreen history behavior.

This removes a frontend dependency. It does not remove image generation or server startup delays.

## Saved reader images (#128, PR #140)

First verified backend release: `29c59f5ccf034bcf076d9e95f7f3338010bfec1b`.

Open the same letter, move through its scans and revisit it later. The server can now reuse saved 480/800/1200/1600px representations across processes. Originals and deliberate zoom remain available. First generation remains a separate cost.

On 2026-09-17, one ordinary 1200px AVIF request for scan `c5d225a9-c2db-43e3-816b-c6dc1af9571f` returned 86,309 bytes:

| Observation | First generation, 29c59f5c | Saved read after deployment, a5793133 |
| --- | ---: | ---: |
| Client request, including transfer | 5,021ms | 631ms |
| Server response | 4,841ms | 449ms |
| Image generation | 4,238ms | Not performed |
| Saved variant read | 41ms (miss) | 141ms (hit) |
| Save generated variant | 252ms | Not needed |

First request ID: `646e380e-4da1-4d3c-808d-bce01381ea03`; saved read ID: `f48b4675-6740-4c56-8364-79821b73da79`. After a normal deployment, a new backend revision confirmed `cache=saved` and `previewRead=hit`. Both responses had identical bytes and ETags. This one sample took 4.39 seconds less end to end (87%); it demonstrates durable reuse, not a site-wide latency estimate. No forced restart, mass generation or cloud configuration change was used.

Local fresh-process tests already verify identical bytes and ETags without re-encoding, and route tests verify access checks and failure fallback. [Method and storage tradeoffs](../audits/2026-09-17-saved-reader-variants.md).

## Progressive downloads (#129, PR #138)

First verified frontend release: `c30f86b3ad2087e7a4d0e0bf19ae661b53473cd6`.

Try [Collection 003](https://voicesthatremain.com/collections/003), then open and page through a letter. Expected: a useful preview remains until the displayed larger image loads; changing the source or its priority does not expose stale readiness or restart the same completed download.

In a live collection visit after deployment, 14 displayed images loaded with no failed displayed image, and each of the two observed 640px showcase sources had one recorded request. The controlled Chromium/WebKit tests provide the stronger edge-case check: one full request under both `private, no-store` and `public, max-age=0, must-revalidate`, with the preview retained while that request is held. This is request-ownership evidence, not a promised total-page speedup.

## Collection loading (#132, PR #141)

Frontend and backend release verified: `d16022e6a3de5fa3d46e0f6e2a354c1804fe567b`.

Open [Collection 003](https://voicesthatremain.com/collections/003), search and sort, then open a letter and return. Expected: the collection and archive appear independently of optional profile enrichment, and late enrichment does not replace your selected highlight or clear your search.

A live Chromium check held only the profile response: the heading was visible, archive search was enabled, and 26 letter links existed before that response was released. The first probe used the wrong accessibility role (`textbox` instead of `searchbox`) and timed out; the corrected role-based probe passed. Local Chromium/WebKit checks cover late profile responses, stable layout and selection, failures and rapid collection navigation. No production speed percentage is inferred from deliberately holding a response.

## Offscreen carousel work (#133, PR #142)

First verified frontend release: `6944e10d6a890dfdfb9923cde208a1057c850dfc`.

On [Collection 003](https://voicesthatremain.com/collections/003), the highlights should advance while visible, pause when you scroll away or switch tabs, and respect reduced motion. Resume should start a fresh interval without racing through missed slides. Manual interaction retains its 30-second pause.

A live Chromium check with ordinary timers observed Slide 1 → Slide 2 while visible, then no movement during separate six-second offscreen and reduced-motion windows. Local Chromium/WebKit checks cover these transitions and hidden-state handling. A separate controlled 12-second local trace recorded 3 carousel style mutations while visible and 0 offscreen. This demonstrates avoided work, not a measured battery-life improvement.

## Current request owns the page (#135, PR #143)

First verified frontend release: `6944e10d6a890dfdfb9923cde208a1057c850dfc` (the earlier main release was superseded).

Try [Journal](https://voicesthatremain.com/blog), change sort quickly, and use Back/Forward when following people from a collection. The final result must match the current route and selection; a late old response or old error cannot replace it. Browser-local fixtures cover populated journal pagination because the public journal was empty during the audit. No production entries were created. A browser-local data check against the deployed frontend held the Title request, selected Author, advanced to page 2, then released Title: the page stayed on `author-12` with Author selected and `?page=2`.

## Backend startup (#130, PR #139)

Diagnostics are deployed; the latency issue remains open. Two naturally started production instances on release `a5793133` measured 1,617ms and 6,006ms from the bootstrap entry point to dependencies ready. First successful readiness was at 1,908ms and 6,735ms; database readiness queries were 40ms and 88ms. These bounded samples point to work before the server listens, rather than the readiness query, as the next investigation target. They exclude platform time before JavaScript begins and do not establish a latency improvement. Cloud resources and scale-to-zero settings remain unchanged.

## Reader page layout follow-up (#127)

Release `8cec7331` correctly requested the measured 1200px rendition and retained the known loaded 480px preview in the DOM during a held full response. However, a full-page iPhone 13 emulation check found the scan container at 296.39px wide and **zero height**, so that preview was not visibly usable. The earlier fixed-size component checks did not establish actual page geometry. Issue #127 was reopened for a bounded layout fix and real-page Chrome/WebKit regression checks. Do not interpret a loaded image or `visibility: visible` alone as proof that users can see it.

## Follow-up work

- **#130: startup latency.** Diagnostics identify where time passes; they are not themselves a latency fix. A controlled local experiment deferring the OpenAI SDK imports reduced median entry time from 284ms to 252ms across six alternating fresh-process pairs, with overlapping ranges. That is a candidate for a separate bounded change, not evidence that it removes seconds of production waiting. No paid capacity was enabled.
- **#136: journal layout stability.** Responsive delivery and smaller decodes are implemented in PR #145. A separate implementation is carrying source dimensions through uploads, editing, persistence and rendering to reserve the natural height of article/inline images before decode. Existing card frames already reserve space. Unknown external-image dimensions retain an explicit natural-rendering fallback rather than a guessed crop. This section will be updated when that follow-up passes review and deployment.

## Your observations

Record browser/device, route and scan number, first visit or revisit, time until readable, and anything that jumps or stops responding. The [main manual checklist](public-site-checks.md) has additional search, collection and phone checks.

Physical iPhone 13 Safari: ___

Physical iPhone 13 Chrome: ___
