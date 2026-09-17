import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { API_BASE_URL } from './utils/test-helpers';

async function openCollection(page: Page, virtualClock = true) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  if (virtualClock) await page.clock.install({ time: new Date('2026-09-17T12:00:00Z') });
  // Observe delivery through the real browser APIs, rather than assuming a
  // wall-clock sleep also advances WebKit's virtual rendering clock.
  await page.addInitScript(() => {
    (window as any).carouselSignals = { intersecting: null, reducedMotion: null };
    const NativeObserver = window.IntersectionObserver;
    window.IntersectionObserver = class extends NativeObserver {
      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        super((entries, observer) => {
          callback(entries, observer);
          const entry = entries.find(value => value.target.classList.contains('cd-highlights-wrap'));
          if (entry) (window as any).carouselSignals.intersecting = entry.isIntersecting && entry.intersectionRatio >= 0.01;
        }, options);
      }
    };
    const motionDeliveries = new Map<EventListener, boolean | null>();
    const nativeMatchMedia = window.matchMedia.bind(window);
    window.matchMedia = (query) => {
      const media = nativeMatchMedia(query);
      if (query !== '(prefers-reduced-motion: reduce)') return media;
      const add = media.addEventListener.bind(media);
      const remove = media.removeEventListener.bind(media);
      const listeners = new Map<any, EventListener>();
      media.addEventListener = ((type: string, listener: any, options: any) => {
        if (type !== 'change') return add(type as 'change', listener, options);
        const wrapped: EventListener = (event) => {
          if (typeof listener === 'function') listener.call(media, event);
          else listener.handleEvent(event);
          motionDeliveries.set(wrapped, media.matches);
          // Other components subscribe too; wait until every actual listener
          // has received this setting, not just the first media-query object.
          (window as any).carouselSignals.reducedMotion = [...motionDeliveries.values()].every(value => value === media.matches)
            ? media.matches : null;
        };
        listeners.set(listener, wrapped);
        motionDeliveries.set(wrapped, null);
        add('change', wrapped, options);
      }) as typeof media.addEventListener;
      media.removeEventListener = ((type: string, listener: any, options: any) => {
        const wrapped = listeners.get(listener);
        remove(type as 'change', wrapped ?? listener, options);
        if (wrapped) motionDeliveries.delete(wrapped);
        listeners.delete(listener);
      }) as typeof media.removeEventListener;
      return media;
    };
  });
  const collection = { id: 'collection-003', collectionCode: '003', title: 'Carousel collection', description: 'Carousel browser checks', createdAt: '2026-01-01', letterCount: 24 };
  const letters = ['letter', 'photo'].map((type, index) => ({
    id: `item-${index}`, images: [{ id: `scan-${index}`, type, imageUrl: `/images/scan-${index}` }],
    metadata: { dateRaw: '19470810', date: '1947-08-10', hook: 'A public archive item', verified: true },
    transcriptStatus: 'VERIFIED', metadataContentStatus: 'VERIFIED', photoDescription: 'A family photograph',
  }));
  await page.route(`${API_BASE_URL}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith('/images/')) return route.fulfill({ contentType: 'image/png', path: join(__dirname, 'fixtures/archive-preview-480x640.png') });
    if (path === '/collections') return route.fulfill({ json: [collection] });
    if (path === '/collections/003') return route.fulfill({ json: { ...collection, letters } });
    if (path === '/collections/003/profile') return route.fulfill({ json: { startHere: { letterId: 'item-0' } } });
    if (path === '/settings/public') return route.fulfill({ json: {} });
    if (path === '/letters/search') return route.fulfill({ json: {
      letters: Array.from({ length: 24 }, (_, index) => ({ id: `archive-${index}`, title: `Archive item ${index}`, imageType: 'letter' })),
      page: 1, limit: 24, total: 24,
      facets: { formats: [], collections: [], correspondents: [], places: [], years: [], topics: [], tones: [], relationships: [] },
    } });
    return route.fulfill({ status: 404, json: { error: 'Not found' } });
  });
  await page.goto('/collections/003');
  const carousel = page.locator('.cd-highlights-wrap');
  await expect(carousel.getByRole('tab')).toHaveCount(2);
  if (virtualClock) await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now() + 1000)));
  await carousel.evaluate((node) => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await waitForSignal(page, 'intersecting', true, virtualClock);
  return carousel;
}
async function waitForSignal(page: Page, key: 'intersecting' | 'reducedMotion', expected: boolean, virtualClock = true) {
  await expect.poll(async () => {
    // Native observer/media delivery needs browser rendering opportunities while
    // the clock is paused. Advance one frame, then inspect actual callback delivery.
    if (virtualClock) await page.clock.runFor(16);
    return page.evaluate(key => (window as any).carouselSignals[key], key);
  }).toBe(expected);
}
async function advance(page: Page, ms: number) { await page.clock.runFor(ms); await page.waitForTimeout(50); }
async function trackChanges(page: Page) {
  await page.evaluate(() => {
    (window as any).carouselMutations = 0;
    new MutationObserver((records) => { (window as any).carouselMutations += records.length; })
      .observe(document.querySelector('.cd-highlights-track')!, { attributes: true, attributeFilter: ['style'] });
  });
}

test('@mocked collection autoplay stops outside the app scrollport and resumes without catch-up', async ({ page }) => {
  const carousel = await openCollection(page);
  await advance(page, 5100);
  await expect(carousel.getByRole('tab', { name: 'Slide 2' })).toHaveAttribute('aria-selected', 'true');
  await page.locator('#app-scroll').evaluate((node) => { node.scrollTop = node.scrollHeight; });
  await waitForSignal(page, 'intersecting', false);
  expect(await carousel.evaluate((node) => node.getBoundingClientRect().bottom)).toBeLessThan(0);
  await advance(page, 600);
  await trackChanges(page);
  await advance(page, 12000);
  expect(await page.evaluate(() => (window as any).carouselMutations)).toBe(0);
  await carousel.evaluate((node) => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await waitForSignal(page, 'intersecting', true);
  await advance(page, 4900);
  await expect(carousel.getByRole('tab', { name: 'Slide 2' })).toHaveAttribute('aria-selected', 'true');
  await advance(page, 700);
  await expect(carousel.getByRole('tab', { name: 'Slide 1' })).toHaveAttribute('aria-selected', 'true');
});

test('@mocked collection respects hidden state, live reduced motion, and manual pause', async ({ page }) => {
  const carousel = await openCollection(page);
  // Headless backgrounding differs by engine. Control the document state to
  // exercise its actual Page Visibility listener; this is not an OS sleep test.
  await page.evaluate(() => {
    let state = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    (window as any).setDocumentVisibility = (next: string) => { state = next; document.dispatchEvent(new Event('visibilitychange')); };
  });
  await page.evaluate(() => (window as any).setDocumentVisibility('hidden'));
  await trackChanges(page);
  await advance(page, 12000);
  expect(await page.evaluate(() => (window as any).carouselMutations)).toBe(0);
  await page.evaluate(() => (window as any).setDocumentVisibility('visible'));
  await advance(page, 4900);
  await expect(carousel.getByRole('tab', { name: 'Slide 1' })).toHaveAttribute('aria-selected', 'true');
  await advance(page, 200);
  await expect(carousel.getByRole('tab', { name: 'Slide 2' })).toHaveAttribute('aria-selected', 'true');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await waitForSignal(page, 'reducedMotion', true);
  await advance(page, 12000);
  await expect(carousel.getByRole('tab', { name: 'Slide 2' })).toHaveAttribute('aria-selected', 'true');
  await carousel.getByRole('tab', { name: 'Slide 1' }).click();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await waitForSignal(page, 'reducedMotion', false);
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => (window as any).setDocumentVisibility('hidden'));
    await page.evaluate(() => (window as any).setDocumentVisibility('visible'));
  }
  await advance(page, 25000);
  await expect(carousel.getByRole('tab', { name: 'Slide 1' })).toHaveAttribute('aria-selected', 'true');
  await advance(page, 5100);
  await expect(carousel.getByRole('tab', { name: 'Slide 2' })).toHaveAttribute('aria-selected', 'true');
});


// Keep the trace opt-in: it uses real time and is a diagnostic artifact, not a
// performance budget assertion affected by unrelated CI host load.
test('@mocked bounded carousel activity trace', async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== 'chromium' || process.env.MEASURE_CAROUSEL !== '1', 'Opt-in Chromium performance recording');
  test.setTimeout(60000);
  const carousel = await openCollection(page, false);
  await page.waitForTimeout(600);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const events: unknown[] = [];
  cdp.on('Tracing.dataCollected', ({ value }) => events.push(...value));
  await cdp.send('Tracing.start', { categories: 'devtools.timeline,blink.user_timing' });
  await trackChanges(page);
  const measurements = [];
  for (const phase of ['visible', 'offscreen']) {
    if (phase === 'offscreen') {
      await page.locator('#app-scroll').evaluate((node) => { node.scrollTop = node.scrollHeight; });
      await page.waitForTimeout(600);
      expect(await carousel.evaluate((node) => node.getBoundingClientRect().bottom)).toBeLessThan(0);
    }
    await page.evaluate((phase) => { (window as any).carouselMutations = 0; performance.mark(`carousel-${phase}-start`); }, phase);
    const before = (await cdp.send('Performance.getMetrics')).metrics;
    await page.waitForTimeout(12000);
    const after = (await cdp.send('Performance.getMetrics')).metrics;
    const metric = (name: string) => 1000 * (after.find((m) => m.name === name)!.value - before.find((m) => m.name === name)!.value);
    measurements.push({ phase, windowMs: 12000, styleMutations: await page.evaluate(() => (window as any).carouselMutations),
      pageScriptMs: metric('ScriptDuration'), pageLayoutMs: metric('LayoutDuration') });
    await page.evaluate((phase) => performance.mark(`carousel-${phase}-end`), phase);
  }
  const ended = new Promise<void>((resolve) => cdp.once('Tracing.tracingComplete', () => resolve()));
  await cdp.send('Tracing.end');
  await ended;
  const activityPath = testInfo.outputPath('carousel-activity.json');
  const tracePath = testInfo.outputPath('carousel-performance-trace.json');
  await writeFile(activityPath, JSON.stringify(measurements, null, 2));
  await writeFile(tracePath, JSON.stringify({ traceEvents: events }));
  await testInfo.attach('carousel-activity.json', { path: activityPath, contentType: 'application/json' });
  await testInfo.attach('carousel-performance-trace.json', { path: tracePath, contentType: 'application/json' });
  expect(measurements[0].styleMutations).toBeGreaterThan(0);
  expect(measurements[1].styleMutations).toBe(0);
});

// Diagnostic cross-check: native timers and native observer/media delivery, with
// no Playwright clock installed. Keep it opt-in rather than extending every CI run.
test('@mocked real-time carousel visibility and live reduced-motion check', async ({ page }) => {
  test.skip(process.env.VERIFY_CAROUSEL_REALTIME !== '1', 'Opt-in native-time correctness check');
  test.setTimeout(45000);
  const carousel = await openCollection(page, false);
  await expect(carousel.getByRole('tab', { name: 'Slide 2' })).toHaveAttribute('aria-selected', 'true', { timeout: 6500 });
  await page.locator('#app-scroll').evaluate(node => { node.scrollTop = node.scrollHeight; });
  await waitForSignal(page, 'intersecting', false, false);
  await trackChanges(page);
  await page.waitForTimeout(6000);
  expect(await page.evaluate(() => (window as any).carouselMutations)).toBe(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await waitForSignal(page, 'reducedMotion', true, false);
  await carousel.evaluate(node => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await waitForSignal(page, 'intersecting', true, false);
  await page.waitForTimeout(6000);
  expect(await page.evaluate(() => (window as any).carouselMutations)).toBe(0);
  await expect(carousel.getByRole('tab', { name: 'Slide 2' })).toHaveAttribute('aria-selected', 'true');
});
