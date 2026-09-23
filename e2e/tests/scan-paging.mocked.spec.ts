import { expect, test } from '@playwright/test';
import { API_BASE_URL } from './utils/test-helpers';
import { openReader, closeReader, mockReader } from './utils/reader-viewer-fixture';

for (const width of [390, 1440, 1920]) test(`@mocked thumbnail clicks animate the main scan without changing the chosen page at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openReader(page);
  await closeReader(page);
  const carousel = page.locator('.scan-carousel');
  await expect(carousel.locator('.progressive-image__full').first()).toHaveJSProperty('complete', true);
  const samples = await page.evaluate(async () => {
    const carousel = document.querySelector('.scan-carousel')!;
    const drawer = document.querySelector('.viewer-page-drawer--inline')!;
    const targetSlide = carousel.children[2].getBoundingClientRect();
    const frame = carousel.getBoundingClientRect();
    const target = carousel.scrollLeft + targetSlide.left + targetSlide.width / 2 - frame.left - frame.width / 2;
    // Observe the requested native behavior directly. CI compositor stalls can
    // consume the entire animation between two JS samples, even with rAF.
    const requests: (ScrollBehavior | undefined)[] = [];
    const scrollTo = carousel.scrollTo.bind(carousel);
    carousel.scrollTo = ((options: ScrollToOptions) => {
      requests.push(options.behavior); scrollTo(options);
    }) as typeof carousel.scrollTo;
    (drawer.children[2] as HTMLElement).click();
    const samples: { x: number; counter: string | null; outgoingLoaded: boolean }[] = [];
    const start = performance.now();
    do {
      await new Promise(requestAnimationFrame);
      const outgoing = carousel.children[0].querySelector<HTMLImageElement>('.progressive-image__full')!;
      samples.push({ x: carousel.scrollLeft, counter: document.querySelector('.scan-navigation [role="status"]')!.textContent,
        outgoingLoaded: !!outgoing.getAttribute('src') && outgoing.complete && outgoing.naturalWidth > 0 });
    } while (Math.abs(carousel.scrollLeft - target) > 0.1 && performance.now() - start < 2000);
    return { samples, target, requests };
  });
  expect(samples.requests).toContain('smooth');
  expect(samples.samples.length).toBeGreaterThan(0);
  expect(samples.samples.every(sample => sample.outgoingLoaded)).toBe(true);
  expect(samples.samples.slice(1).every(sample => sample.counter === '3 / 3')).toBe(true);
  expect(samples.samples.at(-1)!.x).toBeCloseTo(samples.target, 0);

  // Reverse an in-flight click without leaving a stale selection or snap target.
  await page.getByRole('button', { name: 'Go to scan 1: letter', exact: true }).evaluate(el => el.click());
  await expect.poll(() => carousel.evaluate(el => el.scrollLeft)).toBeLessThan(samples.target - 10);
  await page.getByRole('button', { name: 'Go to scan 3: letter', exact: true }).evaluate(el => el.click());
  await expect.poll(() => carousel.evaluate(el => el.scrollLeft)).toBeCloseTo(samples.target, 0);
  await expect(page.locator('.scan-navigation [role="status"]')).toHaveText('3 / 3');
});

for (const width of [390, 1440]) for (const reducedMotion of ['reduce', 'no-preference'] as const) {
  test(`@mocked scan thumbnail selection preserves document position at ${width}px (${reducedMotion})`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion });
    await page.route(`${API_BASE_URL}/**`, route => {
      const path = new URL(route.request().url()).pathname;
      if (path.startsWith('/images/')) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="tan"/></svg>' });
      if (path === '/settings/public') return route.fulfill({ json: {} });
      if (path.endsWith('/adjacent')) return route.fulfill({ json: null });
      if (path === '/letters/paging') return route.fulfill({ json: {
        id: 'paging', collectionCode: '001', metadata: { hook: 'A letter from home', description: 'A letter about the garden and the journey home. '.repeat(40), verified: true },
        images: [1, 2, 3].map(pageNumber => ({ id: `scan-${pageNumber}`, type: 'letter', pageNumber, imageUrl: `/images/${pageNumber}.svg`, width: 600, height: 800 })),
        transcript: { pages: [], fullText: 'A long letter. '.repeat(200), verified: true },
        status: 'published', visibility: 'PUBLISHED', transcriptPublished: true, metadataPublished: true,
        transcriptStatus: 'VERIFIED', metadataContentStatus: 'VERIFIED', extraContentStatus: 'EMPTY',
      } });
      return route.fulfill({ status: 404, json: {} });
    });
    await page.goto('/letter/paging');
      const dot = page.getByRole('button', { name: 'Go to scan 2: letter', exact: true });
    await expect(dot).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await dot.evaluate(el => window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - 260, behavior: 'instant' }));
    const y = await page.evaluate(() => window.scrollY);
    expect(y).toBeGreaterThan(0);
    await dot.click();
    await expect(dot).toHaveAttribute('aria-current', 'page');
    const carousel = page.locator('.scan-carousel');
    await expect.poll(() => carousel.evaluate(el => el.scrollLeft)).toBeGreaterThan(100);
    // Wait past native scrolling to detect any unwanted document animation too.
    await page.waitForTimeout(700);
    expect(await page.evaluate(() => window.scrollY)).toBeCloseTo(y, 0);
    await page.getByRole('button', { name: 'Go to scan 1: letter', exact: true }).click();
    await expect.poll(() => carousel.evaluate(el => el.scrollLeft)).toBeCloseTo(0, 0);
    expect(await page.evaluate(() => window.scrollY)).toBeCloseTo(y, 0);
  });
}
