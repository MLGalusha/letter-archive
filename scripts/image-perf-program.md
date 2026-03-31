# Image Performance Optimization Loop

Modeled after [Karpathy's autoresearch](https://github.com/karpathy/autoresearch) — an autonomous ratchet loop where you iteratively improve a measurable metric.

## Goal

Minimize **P75 LCP** (Largest Contentful Paint) across public pages under simulated 4G network conditions.

## How to Run the Benchmark

Both servers must be running first (in separate terminals):
```bash
cd backend && npm run dev    # port 3002
cd frontend && npm run dev   # port 5174
```

Then run the benchmark:
```bash
cd scripts && npx playwright test image-benchmark.ts --config=benchmark.config.ts
```

The output includes a single target metric line:
```
p75_lcp_ms: XXXX
```

Lower is better. The benchmark uses Chrome DevTools Protocol to simulate 4G (4 Mbps down, 3 Mbps up, 20ms RTT), so results are meaningful even on localhost.

## Current Image Width Settings

| Context | Component | Width | File |
|---------|-----------|-------|------|
| Archive grid cards | LetterCard | 240px | `frontend/src/components/LetterCard/LetterCard.tsx` |
| Collection highlights | ShowcaseCard | 320px initial → 640px idle | `frontend/src/components/ShowcaseCard.tsx` |
| Homepage hero | HeroLetterCard | 480px initial → 640px idle | `frontend/src/pages/HomePage.tsx` |
| Letter detail carousel | LetterDetailPage | 800px | `frontend/src/pages/LetterDetailPage.tsx` |
| Letter viewer (panel) | LetterViewer | 1200px initial → full on zoom | `frontend/src/components/LetterViewer/LetterViewer.tsx` |
| Letter viewer (lightbox) | LetterViewer | 1600px initial → full on zoom | Same as above |
| Adjacent letter preload | LetterDetailPage | 800px | `frontend/src/pages/LetterDetailPage.tsx` |
| Blur-up thumbnails | All | 32px | All image components |
| Archive page size | useArchiveSearch | 12 items | `frontend/src/hooks/useArchiveSearch.ts` |

## Optimization Levers

1. **Image width values** — Lower widths = smaller files = faster loads, but reduced quality. Letter text must remain readable.
2. **Backend Sharp quality** — Currently 76 (WebP) / 78 (JPEG) in `backend/src/routes/images.ts`. Lower quality = smaller files.
3. **Idle upgrade thresholds** — When to start loading higher quality versions. Controlled by `idleUpgrade` prop on ProgressiveImage.
4. **Thumbnail size** — Currently 32px. Could go lower (20px) or higher (48px) depending on blur quality vs speed tradeoff.
5. **Preloading strategy** — Adjacent letters are preloaded at 800px. Could preload more or fewer, or at different sizes.
6. **CSS containment** — `content-visibility: auto` on off-screen cards to skip rendering.
7. **Priority hints** — `fetchPriority="high"` on above-fold images, `loading="lazy"` on below-fold.

## Constraints

- Letter text must be readable at 1x zoom on retina displays (2x pixel ratio)
- All existing tests must pass: `cd frontend && npm test` and `cd e2e && npm run test:mocked`
- No backend API changes (the `?w=` parameter already supports any width up to 1600px)
- No new npm dependencies
- Changes should be simple and focused — one lever per iteration

## The Ratchet Loop

1. Run the benchmark and record the baseline `p75_lcp_ms` value
2. Review current settings and form a hypothesis about what to change
3. Make ONE focused change (edit a single file or setting)
4. Commit the change with a descriptive message
5. Run the benchmark again
6. **If `p75_lcp_ms` improved**: Keep the commit. Log the result.
7. **If `p75_lcp_ms` stayed the same or got worse**: `git reset --hard HEAD~1` to revert
8. Run `cd frontend && npm test` to verify tests still pass
9. Go back to step 2

## Logging

After each iteration, append a line to `scripts/benchmark-results.tsv`:
```
commit_hash	p75_lcp_ms	status	description
abc1234	2450	improved	Reduced archive card width from 480 to 360
def5678	2600	reverted	Lower JPEG quality to 60 — too blurry
```

## Performance Tracking

In development mode, you can inspect real-time image load timing in the browser console:
```js
window.__imagePerf.getSummary()  // P50/P75/P95 by context
window.__imagePerf.getRecent()   // Last 20 load entries
```

## Tips

- The biggest wins come from reducing image sizes for above-fold content
- Images on the homepage and letter detail page have the most impact on LCP
- WebP is significantly smaller than JPEG at the same quality — verify the Accept header is being sent
- Cached images (immutable headers) won't benefit from size reductions for repeat visitors, but first-visit performance matters most
- The 32px thumbnails are ~1KB and load nearly instantly — they're already optimized
