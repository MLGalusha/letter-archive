/**
 * Frontend Performance Benchmark
 *
 * Measures page load performance (LCP, CLS) and page transition times
 * across public pages. No network throttling — measures React render
 * performance, not download speed.
 *
 * Usage (from e2e/):
 *   npx playwright test perf-benchmark.spec.ts --config=benchmark.config.ts
 *
 * Requires both servers running:
 *   - Frontend: npm run dev (in frontend/, port 5174)
 *   - Backend:  npm run dev (in backend/, port 3002)
 */
import { test } from '@playwright/test';

const API_BASE = process.env.BENCHMARK_API_URL || 'http://localhost:3002';
const API_PREFIX = process.env.BENCHMARK_API_PREFIX || '';
const ITERATIONS = 3;

interface PageMetrics {
  label: string;
  url: string;
  lcpMs: number;
  cls: number;
  domLoadedMs: number;
  loadCompleteMs: number;
}

interface TransitionMetrics {
  label: string;
  durationMs: number;
}

/** Discover real URLs from the API so we test against actual content. */
async function discoverUrls(): Promise<{
  letterUrl?: string;
  collectionUrl?: string;
  blogUrl?: string;
}> {
  const result: Record<string, string> = {};

  try {
    const res = await fetch(`${API_BASE}${API_PREFIX}/letters?limit=1&visibility=PUBLISHED`);
    if (res.ok) {
      const data = await res.json();
      const letters = data.letters ?? data;
      if (Array.isArray(letters) && letters.length > 0) {
        result.letterUrl = `/letter/${letters[0].id}`;
      }
    }
  } catch { /* no letters available */ }

  try {
    const res = await fetch(`${API_BASE}${API_PREFIX}/collections`);
    if (res.ok) {
      const collections = await res.json();
      if (Array.isArray(collections) && collections.length > 0) {
        result.collectionUrl = `/collections/${collections[0].code}`;
      }
    }
  } catch { /* no collections available */ }

  try {
    const res = await fetch(`${API_BASE}${API_PREFIX}/blog?limit=1`);
    if (res.ok) {
      const data = await res.json();
      const posts = data.posts ?? data;
      if (Array.isArray(posts) && posts.length > 0) {
        result.blogUrl = `/blog/${posts[0].slug}`;
      }
    }
  } catch { /* no blog posts available */ }

  return result;
}

/** Measure LCP and CLS for a page via PerformanceObserver. */
async function measurePage(
  page: import('@playwright/test').Page,
  cdp: import('@playwright/test').CDPSession,
  url: string,
  label: string,
): Promise<PageMetrics> {
  await cdp.send('Network.clearBrowserCache');
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);

  // Collect LCP
  const lcpMs = await page.evaluate(() => {
    return new Promise<number>((resolve) => {
      let lastLcp = 0;
      const existing = performance.getEntriesByType('largest-contentful-paint');
      if (existing.length > 0) {
        lastLcp = (existing[existing.length - 1] as PerformanceEntry).startTime;
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
        resolve(Math.round(lastLcp));
      }, 500);
    });
  });

  // Collect CLS
  const cls = await page.evaluate(() => {
    return new Promise<number>((resolve) => {
      let clsValue = 0;
      const existing = performance.getEntriesByType('layout-shift') as (PerformanceEntry & { value: number; hadRecentInput: boolean })[];
      for (const entry of existing) {
        if (!entry.hadRecentInput) clsValue += entry.value;
      }
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
          if (!shift.hadRecentInput) clsValue += shift.value;
        }
      });
      try {
        observer.observe({ type: 'layout-shift', buffered: true });
      } catch { /* buffered not supported */ }
      setTimeout(() => {
        observer.disconnect();
        resolve(Math.round(clsValue * 1000) / 1000);
      }, 500);
    });
  });

  // Collect navigation timing
  const timing = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    return {
      domLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd) : 0,
      loadCompleteMs: nav ? Math.round(nav.loadEventEnd) : 0,
    };
  });

  return { label, url, lcpMs, cls, ...timing };
}

/** Measure transition: click element on current page, wait for target selector. */
async function measureTransition(
  page: import('@playwright/test').Page,
  clickSelector: string,
  waitSelector: string,
  label: string,
): Promise<TransitionMetrics | null> {
  try {
    const clickTarget = page.locator(clickSelector).first();
    if (!(await clickTarget.isVisible({ timeout: 3000 }))) return null;

    const startTime = await page.evaluate(() => performance.now());
    await clickTarget.click();
    await page.waitForSelector(waitSelector, { timeout: 10000 });
    const endTime = await page.evaluate(() => performance.now());

    return { label, durationMs: Math.round(endTime - startTime) };
  } catch {
    return null;
  }
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

test('frontend performance benchmark', async ({ page, context }) => {
  const urls = await discoverUrls();

  const cdp = await context.newCDPSession(page);

  const pages = [
    { label: 'homepage', url: '/' },
    ...(urls.letterUrl ? [{ label: 'letter-detail', url: urls.letterUrl }] : []),
    { label: 'collections', url: '/collections' },
    ...(urls.collectionUrl ? [{ label: 'collection-detail', url: urls.collectionUrl }] : []),
    { label: 'blog', url: '/blog' },
    ...(urls.blogUrl ? [{ label: 'blog-detail', url: urls.blogUrl }] : []),
  ];

  // --- Page load metrics ---
  const allResults: PageMetrics[][] = [];

  for (let iter = 0; iter < ITERATIONS; iter++) {
    const iterResults: PageMetrics[] = [];
    for (const p of pages) {
      const result = await measurePage(page, cdp, p.url, p.label);
      iterResults.push(result);
    }
    allResults.push(iterResults);
  }

  // Compute medians per page
  const medians: PageMetrics[] = pages.map((p, idx) => {
    const lcps = allResults.map((r) => r[idx].lcpMs).sort((a, b) => a - b);
    const clss = allResults.map((r) => r[idx].cls).sort((a, b) => a - b);
    const domLoads = allResults.map((r) => r[idx].domLoadedMs).sort((a, b) => a - b);
    const loads = allResults.map((r) => r[idx].loadCompleteMs).sort((a, b) => a - b);
    const mid = Math.floor(lcps.length / 2);
    return {
      label: p.label,
      url: p.url,
      lcpMs: lcps[mid],
      cls: clss[mid],
      domLoadedMs: domLoads[mid],
      loadCompleteMs: loads[mid],
    };
  });

  // --- Transition metrics ---
  const transitionResults: TransitionMetrics[][] = [];

  for (let iter = 0; iter < ITERATIONS; iter++) {
    const iterTransitions: TransitionMetrics[] = [];

    // Transition 1: Homepage -> letter detail
    if (urls.letterUrl) {
      await cdp.send('Network.clearBrowserCache');
      await page.goto('/', { waitUntil: 'networkidle' });
      await page.waitForTimeout(300);
      const t = await measureTransition(
        page,
        '.letter-card',
        '.letter-article',
        'home->letter',
      );
      if (t) iterTransitions.push(t);
    }

    // Transition 2: Collections -> collection detail
    if (urls.collectionUrl) {
      await cdp.send('Network.clearBrowserCache');
      await page.goto('/collections', { waitUntil: 'networkidle' });
      await page.waitForTimeout(300);
      const t = await measureTransition(
        page,
        '.public-collection-card',
        '.collection-detail-public',
        'collections->detail',
      );
      if (t) iterTransitions.push(t);
    }

    transitionResults.push(iterTransitions);
  }

  // Compute median transitions
  const transitionLabels = [...new Set(transitionResults.flat().map((t) => t.label))];
  const medianTransitions: TransitionMetrics[] = transitionLabels.map((label) => {
    const durations = transitionResults
      .map((iter) => iter.find((t) => t.label === label)?.durationMs)
      .filter((d): d is number => d != null)
      .sort((a, b) => a - b);
    const mid = Math.floor(durations.length / 2);
    return { label, durationMs: durations[mid] ?? 0 };
  });

  // --- Compute aggregate metrics ---
  const allLcps = medians.map((r) => r.lcpMs);
  const allCls = medians.map((r) => r.cls);
  const allTransitions = medianTransitions.map((t) => t.durationMs);

  const p75Lcp = percentile(allLcps, 0.75);
  const p75Cls = Math.round(percentile(allCls, 0.75) * 1000) / 1000;
  const p75Transition = allTransitions.length > 0 ? percentile(allTransitions, 0.75) : 0;

  // --- Output ---
  console.log('\n========== FRONTEND PERFORMANCE BENCHMARK ==========');
  console.log(`Iterations: ${ITERATIONS} per page (median reported)`);
  console.log(`Network: unthrottled (measuring React render performance)\n`);

  console.log('  Page Load Metrics:');
  for (const r of medians) {
    console.log(`    ${r.label}: LCP=${r.lcpMs}ms  CLS=${r.cls}  DOMLoaded=${r.domLoadedMs}ms  Load=${r.loadCompleteMs}ms`);
  }

  console.log('\n  Page Transitions:');
  for (const t of medianTransitions) {
    console.log(`    ${t.label}: ${t.durationMs}ms`);
  }

  console.log(`\n  ──────────────────────────`);
  console.log(`  p75_lcp_ms: ${p75Lcp}`);
  console.log(`  p75_cls: ${p75Cls}`);
  console.log(`  p75_transition_ms: ${p75Transition}`);
  console.log(`  ──────────────────────────\n`);

  await cdp.detach();
});
