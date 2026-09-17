# Journal media sizing (#136)

Journal cards, article heroes and Markdown images previously used the uploaded original at every display size. The new image component offers 480, 800, 1200 and 1600px candidates only for the application's blog/letter image endpoints. The browser chooses a size using layout and pixel density. External images remain unchanged. Cards and inline images use native lazy loading; the article hero loads eagerly with high fetch priority. A failed rendition falls back once to the original, followed by an accessible unavailable message if that also fails.

Blog renditions reuse the existing durable variant store and transform scheduler. Originals remain downloadable at their existing URL and byte content. GIF and detected animated PNG/WebP/AVIF retain original bytes, avoiding animation loss. Letter images continue through their existing access-controlled route; this does not make private letter images public. Blog uploads were already public immutable assets.

## Bounded cost and caching

The blog scheduler permits one active transform, 16 queued jobs and 32 waiting consumers; excess requests receive 503 with Retry-After. Input decoding is capped at 40 million pixels and encoding has a 10-second Sharp timeout. The store permits 40 reads and two writes with a 2MiB saved-payload cap per representation. Oversized or unsupported inputs can still use the unchanged original through the frontend fallback. No pre-generation or cloud configuration changes are included.

Only four widths and three negotiated formats are accepted, with source path/size/mtime and encoder recipe/library version in durable identity. This is a theoretical 24MiB saved-payload ceiling per source/version, excluding overhead. Old versions are not garbage-collected. Source replacement is rechecked before returning generated/saved bytes. ETags are format-specific and responses vary on Accept. Blog rendition URLs carry a recipe version because their browser cache, like existing originals, is immutable. Changing the journal encoding recipe requires bumping that frontend version. First requests still incur encoding and storage writes; subsequent requests can reuse saved bytes or browser cache.

## Reproducible local evidence

From `backend/`, run `node --import tsx scripts/measure-journal-images.mjs`. It copies a checked-in scan to temporary storage, starts a local route and measures real responses. It does not access production or the database.

One local run, using WebP:

| Response | Encoded bytes | Decoded dimensions | Approximate RGBA pixel storage |
| --- | ---: | ---: | ---: |
| Original JPEG | 3,078,013 | 3000 × 4000 after orientation | 48,000,000 bytes |
| 480px | 10,958 | 480 × 640 | 1,228,800 bytes |
| 800px | 27,496 | 800 × 1067 | 3,414,400 bytes |
| 1200px | 61,550 | 1200 × 1600 | 7,680,000 bytes |
| 1600px | 114,890 | 1600 × 2133 | 13,651,200 bytes |

The 1200px response has 98.0% fewer encoded bytes and 84% fewer pixels than this original. Pixel storage is an arithmetic estimate, not measured browser memory. A local first encode can take longer than reading the original; reduced transfer and decode work is the benefit, with durable reuse avoiding repeat encoding.

For browser checks, start the same script with `--serve` (API 4197), then run Vite on 4196 with `VITE_API_URL=http://127.0.0.1:4197`. Open `/blog` and `/blog/fixture`. The retained [browser check](evidence/journal-images/browser-checks.js) runs through Playwright CLI `run-code`. Results: [Chromium](evidence/journal-images/chrome.json), [WebKit](evidence/journal-images/webkit.json).

Both engines, with iPhone 13 emulation (390px viewport, DPR 3), selected 1200px for the ~358px article image. The card retained its 16:10 frame, the hero retained its natural aspect ratio and high priority, and a distant inline image had not requested bytes until scrolling toward it. Animation loaded, and the deliberately failed rendition recovered via the original. Chromium's negotiated AVIF response was 78,994 bytes, 97.4% below the original. WebKit's resource byte counters were zero/unavailable; they are not evidence of zero transfer.

Single `createImageBitmap` decode samples for original / 480px WebP / 1200px WebP were 55.4 / 1.7 / 7.9ms in Chromium and 73 / 8 / 10ms in WebKit. These are local desktop-engine samples, not phone CPU, battery, production latency, LCP or p95 results. The browser has discretion over responsive candidate selection, caching, lazy-load distance and retries.

## Remaining limitations

Article and Markdown images keep natural aspect ratios and current layout. Their source dimensions are not stored in the post schema, so intrinsic-height layout shift remains until image metadata arrives. This change deliberately does not introduce letterboxing or a metadata migration. Cards already reserve their frame. Physical iPhone 13 Safari/Chrome and production checks remain pending; the audited production journal had no published entries, so no user-visible speed claim can be made for existing production posts.

## Review corrections

Owned relative and protocol-relative image URLs are normalized before rendition construction. Original fallback removes size/recipe parameters but preserves source version parameters. Cards use `sizes="auto, 100vw"`: native lazy-image layout sizing follows the existing auto-fit grid, while an older engine can safely fall back to viewport width. This follows the [MDN native sizing and fallback guidance](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/img#sizes). The fallback may transfer a larger candidate on older browsers, but avoids blurring a stretched single card or introducing a JavaScript measurement/request stage.

[Desktop checks](evidence/journal-images/desktop-cards.js) at 1440px, DPR 1 confirmed both [Chromium](evidence/journal-images/chrome-desktop.json) and [WebKit](evidence/journal-images/webkit-desktop.json) chose 1200px for one 1130px-wide card and 480px for three ~365px-wide cards. No card requested multiple different renditions. WebKit issued one same-URL request per card; Chromium coalesced them. These desktop engines do not prove every shipped Safari version supports auto sizing; the fallback is intentional.
