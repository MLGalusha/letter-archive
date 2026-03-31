/**
 * Backend API Performance Benchmark
 *
 * Measures response times for key public API endpoints.
 * Outputs a single P75 response time metric for the autoresearch ratchet loop.
 *
 * Usage (from e2e/):
 *   npx playwright test api-benchmark.spec.ts --config=benchmark.config.ts
 *
 * Requires backend running:
 *   - Backend: npm run dev (in backend/, port 3002)
 */
import { test } from '@playwright/test';

const API_BASE = process.env.BENCHMARK_API_URL || 'http://localhost:3002';

const ITERATIONS = 7; // More iterations since API calls are fast — better median stability
const WARMUP_ITERATIONS = 2; // Warm up DB connection pool + any caches

interface EndpointResult {
  endpoint: string;
  responseTimeMs: number;
  statusCode: number;
  bodySize: number;
}

async function measureEndpoint(url: string, label: string): Promise<EndpointResult> {
  const start = performance.now();
  const res = await fetch(url);
  const body = await res.text();
  const elapsed = performance.now() - start;

  return {
    endpoint: label,
    responseTimeMs: Math.round(elapsed * 100) / 100,
    statusCode: res.status,
    bodySize: body.length,
  };
}

test('api performance benchmark', async () => {
  // Discover real IDs from the API
  let letterId: string | undefined;
  let collectionCode: string | undefined;

  try {
    const lettersRes = await fetch(`${API_BASE}/letters?limit=1&visibility=PUBLISHED`);
    if (lettersRes.ok) {
      const data = await lettersRes.json();
      const lettersList = data.letters ?? data;
      if (Array.isArray(lettersList) && lettersList.length > 0) {
        letterId = lettersList[0].id;
      }
    }
  } catch { /* no letters available */ }

  try {
    const collectionsRes = await fetch(`${API_BASE}/collections`);
    if (collectionsRes.ok) {
      const collections = await collectionsRes.json();
      if (Array.isArray(collections) && collections.length > 0) {
        collectionCode = collections[0].collectionCode ?? collections[0].code;
      }
    }
  } catch { /* no collections available */ }

  const endpoints = [
    { label: 'GET /letters?limit=12', url: `${API_BASE}/letters?limit=12` },
    { label: 'GET /collections', url: `${API_BASE}/collections` },
    ...(letterId ? [
      { label: 'GET /letters/:id', url: `${API_BASE}/letters/${letterId}` },
      { label: 'GET /letters/:id/adjacent', url: `${API_BASE}/letters/${letterId}/adjacent` },
    ] : []),
    ...(collectionCode ? [
      { label: 'GET /collections/:code', url: `${API_BASE}/collections/${collectionCode}` },
    ] : []),
    { label: 'GET /letters/search?search=letter', url: `${API_BASE}/letters/search?search=letter&limit=12` },
    { label: 'GET /letters/summaries', url: `${API_BASE}/letters/summaries?limit=12&visibility=PUBLISHED` },
  ];

  // Warmup: hit each endpoint to prime connection pool and caches
  for (let w = 0; w < WARMUP_ITERATIONS; w++) {
    for (const ep of endpoints) {
      await fetch(ep.url).catch(() => {});
    }
  }

  // Measured iterations
  const allResults: EndpointResult[][] = [];
  for (let iter = 0; iter < ITERATIONS; iter++) {
    const iterResults: EndpointResult[] = [];
    for (const ep of endpoints) {
      const result = await measureEndpoint(ep.url, ep.label);
      iterResults.push(result);
    }
    allResults.push(iterResults);
  }

  // Compute medians per endpoint
  const medians = endpoints.map((ep, idx) => {
    const times = allResults.map((r) => r[idx].responseTimeMs).sort((a, b) => a - b);
    const mid = Math.floor(times.length / 2);
    return {
      endpoint: ep.label,
      medianMs: Math.round(times[mid] * 100) / 100,
      minMs: Math.round(times[0] * 100) / 100,
      maxMs: Math.round(times[times.length - 1] * 100) / 100,
      p95Ms: Math.round(times[Math.min(Math.ceil(0.95 * times.length) - 1, times.length - 1)] * 100) / 100,
      bodySize: allResults[0][idx].bodySize,
      statusCode: allResults[0][idx].statusCode,
    };
  });

  // Compute P75 across all endpoint medians
  const allMedians = medians.map((m) => m.medianMs).sort((a, b) => a - b);
  const p75Idx = Math.ceil(0.75 * allMedians.length) - 1;
  const p75 = allMedians[Math.max(0, p75Idx)];

  // Also compute total (sum of medians) — useful for overall throughput tracking
  const totalMs = Math.round(medians.reduce((sum, m) => sum + m.medianMs, 0) * 100) / 100;

  // Output results
  console.log('\n========== API PERFORMANCE BENCHMARK ==========');
  console.log(`Target: ${API_BASE}`);
  console.log(`Iterations: ${ITERATIONS} per endpoint (median reported)`);
  console.log(`Warmup: ${WARMUP_ITERATIONS} iterations\n`);

  for (const m of medians) {
    const status = m.statusCode === 200 ? '' : ` [${m.statusCode}]`;
    console.log(`  ${m.endpoint}:${status}`);
    console.log(`    Median: ${m.medianMs}ms (min: ${m.minMs}, max: ${m.maxMs}, p95: ${m.p95Ms})`);
    console.log(`    Response: ${(m.bodySize / 1024).toFixed(1)} KB`);
  }

  console.log(`\n  ──────────────────────────`);
  console.log(`  p75_api_ms: ${p75}`);
  console.log(`  total_api_ms: ${totalMs}`);
  console.log(`  ──────────────────────────\n`);
});
