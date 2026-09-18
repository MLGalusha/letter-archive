import { expect, test } from '@playwright/test';
import { API_BASE_URL } from './utils/test-helpers';

for (const width of [390, 1440]) for (const reducedMotion of ['reduce', 'no-preference'] as const) {
  test(`@mocked scan dots preserve document position at ${width}px (${reducedMotion})`, async ({ page }) => {
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
    const dot = page.getByRole('button', { name: 'Go to page 2', exact: true });
    await expect(dot).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await dot.evaluate(el => window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - 260, behavior: 'instant' }));
    const y = await page.evaluate(() => window.scrollY);
    expect(y).toBeGreaterThan(0);
    await dot.click();
    await expect(dot).toHaveClass(/active/);
    const carousel = page.locator('.scan-carousel');
    await expect.poll(() => carousel.evaluate(el => el.scrollLeft)).toBeGreaterThan(100);
    // Wait past native scrolling to detect any unwanted document animation too.
    await page.waitForTimeout(700);
    expect(await page.evaluate(() => window.scrollY)).toBeCloseTo(y, 0);
    await page.getByRole('button', { name: 'Go to page 1', exact: true }).click();
    await expect.poll(() => carousel.evaluate(el => el.scrollLeft)).toBeCloseTo(0, 0);
    expect(await page.evaluate(() => window.scrollY)).toBeCloseTo(y, 0);
  });
}
