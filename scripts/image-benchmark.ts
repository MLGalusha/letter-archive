/**
 * Image Performance Benchmark
 *
 * Measures image load times across public pages using Playwright with
 * simulated network throttling (4G). Outputs a single P75 LCP metric
 * plus supporting data.
 *
 * Usage:
 *   npx playwright test scripts/image-benchmark.ts --config=scripts/benchmark.config.ts
 *
 * Requires both servers running:
 *   - Frontend: npm run dev (in frontend/)
 *   - Backend:  npm run dev (in backend/)
 */
import { test } from '@playwright/test';

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

async function measurePage(
  page: import('@playwright/test').Page,
  url: string,
  label: string,
): Promise<PageResult> {
  // Set up LCP observer before navigation
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  // Wait for network idle + extra settle time
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Collect LCP from PerformanceObserver
  const lcp = await page.evaluate(() => {
    return new Promise<number>((resolve) => {
      let lastLcp = 0;
      // Check existing entries
      const existing = performance.getEntriesByType('largest-contentful-paint');
      if (existing.length > 0) {
        lastLcp = existing[existing.length - 1].startTime;
      }
      // Observe for new entries briefly
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          lastLcp = Math.max(lastLcp, entry.startTime);
        }
      });
      try {
        observer.observe({ type: 'largest-contentful-paint', buffered: true });
      } catch {
        // Some browsers don't support buffered
      }
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
  // Apply network throttling via CDP
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.emulateNetworkConditions', THROTTLE_4G);

  // Discover real content URLs from the homepage
  await page.goto('/', { waitUntil: 'networkidle' });

  // Find a letter link and collection link from the page
  const letterHref = await page.locator('a[href^="/letter/"]').first().getAttribute('href');
  const collectionHref = await page.locator('a[href^="/collections/"]').first().getAttribute('href');

  const pages = [
    { label: 'homepage', url: '/' },
    ...(collectionHref ? [{ label: 'collection', url: collectionHref }] : []),
    ...(letterHref ? [{ label: 'letter-detail', url: letterHref }] : []),
  ];

  const allResults: PageResult[][] = [];

  for (let iter = 0; iter < ITERATIONS; iter++) {
    const iterResults: PageResult[] = [];
    for (const p of pages) {
      // Clear cache between iterations
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
