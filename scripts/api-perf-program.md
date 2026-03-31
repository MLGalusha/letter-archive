# Backend API Performance Optimization Loop

Modeled after [Karpathy's autoresearch](https://github.com/karpathy/autoresearch) — an autonomous ratchet loop where you iteratively improve a measurable metric.

## Goal

Minimize **P75 response time** across public API endpoints on localhost.

## How to Run the Benchmark

Backend must be running first (in a separate terminal):
```bash
cd backend && npm run dev    # port 3002
```

Then run the benchmark:
```bash
cd e2e && npx playwright test api-benchmark.spec.ts --config=benchmark.config.ts
```

The output includes target metric lines:
```
p75_api_ms: XX.XX
total_api_ms: XX.XX
```

Lower is better. The benchmark runs 7 measured iterations per endpoint (after 2 warmup iterations) and reports medians.

## Endpoints Measured

| Endpoint | Description | Typical Bottleneck |
|----------|-------------|-------------------|
| `GET /letters?limit=12` | Letter list with pagination | Loads ALL letters then paginates in-memory |
| `GET /collections` | Collections with aggregations | 4 parallel DB queries (counts, dates, senders, recipients) |
| `GET /letters/:id` | Single letter with relations | 2 queries (letter + related items) |
| `GET /letters/:id/adjacent` | Prev/next in collection | Loads ALL published letters in collection |
| `GET /collections/:code` | Collection with letters | Loads all published letters in collection |
| `GET /letters/search?search=letter` | Full-text archive search | Complex CTE with ILIKE on multiple fields |
| `GET /letters/summaries` | Bulk summaries | Loads ALL then paginates in-memory |

## Optimization Levers

### Database Query Optimization
1. **Push pagination to DB** — `GET /letters` and `/letters/summaries` load all records then `.slice()` in JS. Use SQL `LIMIT/OFFSET` or a CTE with row numbering.
2. **Reduce columns fetched** — `/letters/summaries` fetches `transcriptionText` (can be large) even though it only needs summary fields.
3. **Add missing indexes** — Search uses ILIKE on sender/recipient/summary without full-text indexes.
4. **Combine sequential queries** — Collections route runs 4 separate aggregation queries; some could be combined into one query with multiple aggregates.
5. **Use materialized views** — For slowly-changing aggregation data (collection stats).

### Response Payload Optimization
6. **Trim response payloads** — Remove unnecessary fields from list endpoints (e.g., full transcription text in summaries).
7. **Conditional fields** — Only include `pages` data when client needs image URLs.

### Caching
8. **In-memory cache for collections** — Collections change rarely; cache the aggregation results with TTL.
9. **ETag/304 responses** — Return `304 Not Modified` when data hasn't changed.
10. **Cache adjacent letters** — Adjacent query result only changes when letters are published/unpublished.

### Connection & Runtime
11. **Connection pool tuning** — Currently 10 (prod) / 20 (dev). May need adjustment.
12. **Query parallelization** — Letter detail fetches letter then related items sequentially; could parallelize.

## Constraints

- All existing tests must pass: `cd backend && npm test`
- No breaking API contract changes (frontend depends on response shapes)
- No new npm dependencies
- Changes should be simple and focused — one lever per iteration
- Don't start/stop the backend server — it's already running

## The Ratchet Loop

1. Run the benchmark and record the baseline `p75_api_ms` value
2. Review current query patterns and form a hypothesis about what to change
3. Make ONE focused change (edit a single file or setting)
4. Run the benchmark again
5. **If `p75_api_ms` improved**: Keep the change. Log the result.
6. **If `p75_api_ms` stayed the same or got worse**: `git reset --hard HEAD~1` to revert
7. Run `cd backend && npm test` to verify tests still pass
8. Go back to step 2

## Logging

After each iteration, append a line to `scripts/api-benchmark-results.tsv`:
```
commit_hash	p75_api_ms	total_api_ms	status	description
abc1234	45.2	187.5	improved	Push pagination to DB for GET /letters
def5678	52.1	210.3	reverted	Combined collection aggregation queries — parsing overhead offset gains
```

## Tips

- The biggest wins come from eliminating "load everything then filter in JS" patterns
- `GET /letters` is the most impactful endpoint — it's called on every archive page load
- Watch `total_api_ms` as a secondary metric — individual endpoint improvements matter even if they don't move P75
- Database query time dominates — network/serialization is minimal on localhost
- Check `EXPLAIN ANALYZE` output for slow queries to understand what the DB is doing
- The warmup iterations ensure connection pool is primed — first-request latency is not measured
