/**
 * Image Performance Benchmark
 *
 * Measures image load times across public pages using Playwright with
 * simulated network throttling (4G). Outputs a single P75 LCP metric.
 *
 * Usage (from e2e/):
 *   npx playwright test --config=benchmark.config.ts
 *
 * Requires both servers running:
 *   - Frontend: npm run dev (in frontend/)
 *   - Backend:  npm run dev (in backend/)
 */
import { test } from '@playwright/test';

const API_BASE = process.env.BENCHMARK_API_URL || 'http://localhost:3002';
const API_PREFIX = process.env.BENCHMARK_API_PREFIX || '';

// Simulated 4G conditions via Chrome DevTools Protocol
const THROTTLE_4G = {
  offline: false,
  downloadThroughput: (4 * 1024 * 1024) / 8, // 4 Mbps
  uploadThroughput: (3 * 1024 * 1024) / 8,   // 3 Mbps
  latency: 20,                                 // 20ms RTT
};

const ITERATIONS = 3;

interface PageResult {
  page: string;
  url: string;
  lcpMs: number;
  totalImageBytes: number;
  imageCount: number;
  firstImageMs: number;
}

/** Fetch a letter ID and collection code from the API (no throttling). */
async function discoverUrls(): Promise<{ letterUrl?: string; collectionUrl?: string }> {
  const result: { letterUrl?: string; collectionUrl?: string } = {};
  try {
    const lettersRes = await fetch(`${API_BASE}${API_PREFIX}/letters?limit=1`);
    if (lettersRes.ok) {
      const data = await lettersRes.json();
      const letters = data.letters ?? data;
      if (Array.isArray(letters) && letters.length > 0) {
        result.letterUrl = `/letter/${letters[0].id}`;
      }
    }
  } catch { /* no letters available */ }
  try {
    const collectionsRes = await fetch(`${API_BASE}${API_PREFIX}/collections`);
    if (collectionsRes.ok) {
      const collections = await collectionsRes.json();
      if (Array.isArray(collections) && collections.length > 0) {
        result.collectionUrl = `/collections/${collections[0].code}`;
      }
    }
  } catch { /* no collections available */ }
  return result;
}

async function measurePage(
  page: import('@playwright/test').Page,
  url: string,
  label: string,
): Promise<PageResult> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  // Wait for network idle + extra settle time
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);

  // Collect LCP from PerformanceObserver
  const lcp = await page.evaluate(() => {
    return new Promise<number>((resolve) => {
      let lastLcp = 0;
      const existing = performance.getEntriesByType('largest-contentful-paint');
      if (existing.length > 0) {
        lastLcp = existing[existing.length - 1].startTime;
      }
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          lastLcp = Math.max(lastLcp, entry.startTime);
        }
      });
      try {
        observer.observe({ type: 'largest-contentful-paint', buffered: true });
      } catch { /* buffered not supported */ }
      setTimeout(() => {
        observer.disconnect();
        resolve(lastLcp);
      }, 500);
    });
  });

  // Collect image resource timing
  const imageStats = await page.evaluate(() => {
    const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    const images = entries.filter(
      (e) => e.initiatorType === 'img' || e.name.match(/\.(jpg|jpeg|png|webp|gif)/i),
    );
    const totalBytes = images.reduce((sum, e) => sum + (e.transferSize || 0), 0);
    const firstImage = images.length > 0 ? Math.min(...images.map((e) => e.responseEnd)) : 0;
    return {
      totalImageBytes: totalBytes,
      imageCount: images.length,
      firstImageMs: Math.round(firstImage),
    };
  });

  return {
    page: label,
    url,
    lcpMs: Math.round(lcp),
    ...imageStats,
  };
}

test('image performance benchmark', async ({ page, context }) => {
  // Discover real URLs from the API (unthrottled)
  const { letterUrl, collectionUrl } = await discoverUrls();

  // Apply network throttling via CDP
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.emulateNetworkConditions', THROTTLE_4G);

  const pages = [
    { label: 'homepage', url: '/' },
    ...(collectionUrl ? [{ label: 'collection', url: collectionUrl }] : []),
    ...(letterUrl ? [{ label: 'letter-detail', url: letterUrl }] : []),
  ];

  const allResults: PageResult[][] = [];

  for (let iter = 0; iter < ITERATIONS; iter++) {
    const iterResults: PageResult[] = [];
    for (const p of pages) {
      await cdp.send('Network.clearBrowserCache');
      const result = await measurePage(page, p.url, p.label);
      iterResults.push(result);
    }
    allResults.push(iterResults);
  }

  // Compute medians per page
  const medians: PageResult[] = pages.map((p, idx) => {
    const lcps = allResults.map((r) => r[idx].lcpMs).sort((a, b) => a - b);
    const bytes = allResults.map((r) => r[idx].totalImageBytes).sort((a, b) => a - b);
    const firsts = allResults.map((r) => r[idx].firstImageMs).sort((a, b) => a - b);
    const mid = Math.floor(lcps.length / 2);
    return {
      page: p.label,
      url: p.url,
      lcpMs: lcps[mid],
      totalImageBytes: bytes[mid],
      imageCount: allResults[0][idx].imageCount,
      firstImageMs: firsts[mid],
    };
  });

  // Compute P75 LCP across all pages
  const allLcps = medians.map((r) => r.lcpMs).sort((a, b) => a - b);
  const p75Idx = Math.ceil(0.75 * allLcps.length) - 1;
  const p75Lcp = allLcps[Math.max(0, p75Idx)];

  // Output results
  console.log('\n========== IMAGE PERFORMANCE BENCHMARK ==========');
  console.log(`Network: Simulated 4G (4 Mbps down, 3 Mbps up, 20ms RTT)`);
  console.log(`Iterations: ${ITERATIONS} per page (median reported)\n`);

  for (const r of medians) {
    console.log(`  ${r.page}:`);
    console.log(`    LCP: ${r.lcpMs}ms`);
    console.log(`    Images: ${r.imageCount} (${(r.totalImageBytes / 1024).toFixed(0)} KB)`);
    console.log(`    First image: ${r.firstImageMs}ms`);
  }

  console.log(`\n  ──────────────────────────`);
  console.log(`  p75_lcp_ms: ${p75Lcp}`);
  console.log(`  ──────────────────────────\n`);

  await cdp.detach();
});
