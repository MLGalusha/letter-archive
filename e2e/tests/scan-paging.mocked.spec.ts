import { expect, test } from '@playwright/test';
import { API_BASE_URL } from './utils/test-helpers';
import { openReader } from './utils/reader-viewer-fixture';

for (const width of [320, 390, 1440]) test(`@mocked 24 scan previews stay compact and direct selection arrives without traversing other pages at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await openReader(page, Array.from({ length: 24 }, (_, i) => ({
    id: `scan-${i}`, type: 'letter', pageNumber: i + 1, imageUrl: `/images/${i}.svg`, width: 600, height: 800,
  })));
  await page.getByRole('button', { name: 'Close viewer' }).click();
  const nav = page.locator('.scan-navigation');
  await expect(nav.getByRole('status')).toHaveText('1 / 24');
  expect((await nav.boundingBox())!.height).toBeLessThanOrEqual(48);
  await expect(page.getByRole('region', { name: 'Scan pages' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Pages', exact: true }).click();
  const drawer = page.getByRole('region', { name: 'Scan pages' });
  await expect(drawer.getByRole('button')).toHaveCount(24);
  // Labels are accessible names; the visual drawer contains only previews.
  expect(await drawer.locator('button').evaluateAll(buttons => buttons.every(el => el.textContent!.trim() === ''))).toBe(true);
  expect(await drawer.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const results = await page.evaluate(async () => {
    const carousel = document.querySelector('.scan-carousel')!;
    const drawer = document.querySelector('.viewer-page-drawer--inline')!;
    const samples = [];
    for (const index of [23, 0, 12, 2, 23]) {
      (drawer.children[index] as HTMLElement).click();
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      const slide = carousel.children[index].getBoundingClientRect();
      const frame = carousel.getBoundingClientRect();
      samples.push({ index, centerError: Math.abs(slide.left + slide.width / 2 - frame.left - frame.width / 2),
        counter: document.querySelector('.scan-navigation [role="status"]')!.textContent });
    }
    return samples;
  });
  for (const result of results) {
    expect(result.centerError).toBeLessThan(1);
    expect(result.counter).toBe(`${result.index + 1} / 24`);
  }
  await page.getByRole('button', { name: 'Next scan', exact: true }).click();
  await expect(nav.getByRole('status')).toHaveText('1 / 24');
  await page.getByRole('button', { name: 'Pages', exact: true }).click();
  await expect(drawer).toHaveCount(0);
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
    await page.getByRole('button', { name: 'Pages', exact: true }).click();
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
