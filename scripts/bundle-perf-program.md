# Frontend Bundle Size Optimization Loop

Modeled after [Karpathy's autoresearch](https://github.com/karpathy/autoresearch) — an autonomous ratchet loop where you iteratively improve a measurable metric.

## Goal

Minimize **total gzipped bundle size** (JS + CSS) of the production Vite build.

## How to Run the Benchmark

```bash
cd frontend && bash ../scripts/bundle-benchmark.sh
```

The output includes target metric lines:
```
total_gzip_kb: XXX.XX
total_js_gzip_kb: XXX.XX
initial_js_gzip_kb: XXX.XX
largest_chunk_gzip_kb: XXX.XX
```

Lower is better. Primary metric is `total_gzip_kb`. Secondary metrics track initial load and largest chunk.

## Baseline (2026-03-31)

| Metric | Value |
|--------|-------|
| Total (gzip) | 979.30 kB |
| Total JS (gzip) | 891.07 kB |
| Total CSS (gzip) | 88.22 kB |
| Initial JS (gzip) | 84.31 kB |
| Largest chunk | UpdateEditorPage 418.51 kB gzip (1,250 kB raw) |
| Chunk count | 58 |

## Big Chunks (admin-only, lazy-loaded)

| Chunk | Raw | Gzip | Likely Cause |
|-------|-----|------|-------------|
| UpdateEditorPage | 1,250 kB | 419 kB | @mdxeditor/editor |
| LetterReviewPage | 416 kB | 125 kB | @tiptap + editor deps |
| UsagePage | 391 kB | 114 kB | recharts + d3 |
| index (entry) | 268 kB | 86 kB | react + react-dom + router + shared utils |
| UpdateDetailPage | 162 kB | 49 kB | react-markdown + rehype |

## Optimization Levers

### Tree-shaking / Import Optimization
1. **Replace namespace d3 import with named imports** — `import * as d3` defeats tree-shaking; import only needed functions from `d3-scale`, `d3-selection`, etc.
2. **Audit recharts imports** — import only used chart types, not the full library.
3. **Check for barrel file re-exports** — index.ts files that re-export everything prevent tree-shaking.
4. **Remove unused exports** from shared utility modules.

### Code Splitting
5. **Split heavy dependencies into vendor chunks** — `manualChunks` in vite.config.ts to separate react, react-dom, router into a cacheable vendor chunk.
6. **Dynamic import heavy components within pages** — e.g., RelationshipGraph (D3) loaded on demand within LetterReviewPage.
7. **Lazy-load react-markdown** — only needed on blog/update pages.

### Dependency Optimization
8. **Replace heavy deps with lighter alternatives** — e.g., recharts → a lighter chart lib, or hand-rolled SVG for simple charts.
9. **Check for duplicate copies** of dependencies (e.g., multiple versions of the same package).
10. **Externalize or thin out @mdxeditor** — check if a lighter config is possible.

### CSS Optimization
11. **Remove unused CSS** — large page-specific CSS files may contain dead rules.
12. **Deduplicate shared CSS** — check for repeated patterns across page CSS files.

### Dead Code Removal
13. **Remove unused components/pages** — any routes or components no longer in use.
14. **Remove unused API client methods** — functions exported but never imported.
15. **Strip dev-only code** — console.log, debug panels, etc.

## Constraints

- All tests must pass: `cd frontend && npm test` and `cd e2e && npm run test:mocked`
- No new npm dependencies
- No breaking changes to functionality
- One change per iteration
- Never start backend/frontend servers — Mason runs them with direnv

## The Ratchet Loop

1. Run `cd frontend && bash ../scripts/bundle-benchmark.sh` and record `total_gzip_kb`
2. Review the build output and form a hypothesis about what to change
3. Make ONE focused change
4. Rebuild and re-measure
5. **If `total_gzip_kb` decreased**: Keep the change. Commit. Log the result.
6. **If `total_gzip_kb` stayed the same or increased**: `git reset --hard HEAD~1` to revert
7. Run `cd frontend && npm test` to verify tests still pass
8. Go back to step 2

## Logging

After each iteration, append a line to `scripts/bundle-benchmark-results.tsv`:
```
commit_hash	total_gzip_kb	total_js_gzip_kb	initial_js_gzip_kb	largest_chunk_gzip_kb	chunk_count	status	description
abc1234	950.00	865.00	84.00	400.00	58	improved	Tree-shake d3 imports in RelationshipGraph
```

## Tips

- The 3 biggest admin chunks (UpdateEditor, LetterReview, UsagePage) account for 657 kB gzip — 67% of total JS
- These are all admin-only pages already lazy-loaded, so optimizing them helps total size but doesn't affect public page load
- The entry chunk (86 kB) is what every visitor downloads — shrinking it has the most user-facing impact
- Use `npx vite-bundle-visualizer` (already installed as dev dep, or run ad-hoc) to inspect what's inside chunks
- Check for `import * as` patterns that defeat tree-shaking
