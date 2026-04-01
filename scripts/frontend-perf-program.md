# Frontend Performance Optimization — Autoresearch Program

## Goal
Minimize P75 LCP and page transition time across public pages.

## Target Metrics
| Metric | Description |
|--------|-------------|
| `p75_lcp_ms` | P75 Largest Contentful Paint across all tested pages (primary) |
| `p75_cls` | P75 Cumulative Layout Shift (secondary) |
| `p75_transition_ms` | P75 page-to-page navigation time (secondary) |

## How to Run
Both servers must be running (frontend on 5174, backend on 3002):
```bash
cd e2e && npx playwright test perf-benchmark.spec.ts --config=benchmark.config.ts
```

## Pages Tested
- Homepage (`/`)
- Letter detail (`/letter/:id`)
- Collections (`/collections`)
- Collection detail (`/collections/:code`)
- Person (`/people/:id`)
- Blog listing (`/blog`)
- Blog detail (`/blog/:slug`)

## Transitions Tested
1. Homepage → letter detail (click `.letter-card` → wait `.letter-article`)
2. Collections → collection detail (click `.public-collection-card` → wait `.collection-detail-public`)

## Constraints
- All tests must pass (`cd frontend && npm test` + `cd e2e && npm run test:mocked`)
- No new npm dependencies
- No breaking changes
- One change per iteration
- Never start servers from Claude's terminal

## Optimization Levers (ordered by expected impact)
1. React.memo on Footer (static, every public page)
2. React.memo on Header (every public page, prevents parent re-render cascade)
3. Memoize ReactMarkdown custom components (UpdateDetailPage)
4. useCallback for SearchBar handlers (toggleFormatFilter, clearAll)
5. Reduce font weights (remove Playfair Display 800)
6. Route prefetching on nav link hover (Blog, About)
7. content-visibility: auto on more list containers
8. React.memo on FacetRow (SearchBar child)
9. React.memo on FilterChoiceField (SearchBar child)
10. Extract HomePage hero into separate component (isolate re-renders)
11. CSS will-change on header scroll-reveal
12. useCallback for Modal overlay handler (admin, low priority)

## Ratchet Loop
1. Run benchmark, record baseline
2. Make ONE change
3. Run tests (frontend + mocked e2e)
4. Re-run benchmark
5. If improved → commit, log "improved" in TSV
6. If not → `git checkout -- .`, log "reverted" in TSV
7. Repeat
