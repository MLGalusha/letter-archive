import { expect, test } from '@playwright/test';
import { API_BASE_URL } from './utils/test-helpers';

for (const width of [320, 390, 900, 901, 1440]) {
  test(`@mocked A3 keeps text, complete scans and sparse metadata clear at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route(`${API_BASE_URL}/**`, route => {
      const path = new URL(route.request().url()).pathname;
      if (path.startsWith('/images/')) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="#e8d8b9"/><rect x="8" y="8" width="584" height="784" fill="none" stroke="#6d5f51"/><text x="45" y="90" font-size="25">My dearest friend,</text><text x="45" y="140" font-size="20">We arrived safely on Tuesday.</text></svg>' });
      if (path === '/settings/public') return route.fulfill({ json: {} });
      if (path.endsWith('/adjacent')) return route.fulfill({ json: { position: 2, total: 3, collectionCode: '001', prev: { id: 'previous' }, next: { id: 'next' } } });
      if (path === '/letters/reading') return route.fulfill({ json: {
        id: 'reading', collectionCode: '001', metadata: { date: 'August 10, 1947', description: 'A long summary. '.repeat(100), verified: true },
        images: [1, 2].map(pageNumber => ({ id: `scan-${pageNumber}`, type: 'letter', pageNumber, imageUrl: `/images/${pageNumber}.svg`, width: 600, height: 800 })),
        transcript: { pages: [], fullText: 'The original wording.', verified: true },
        readingText: 'My dearest friend,\n\nWe arrived safely on Tuesday. The house is quiet, and the garden is full of flowers.\n\nWith love,\nAlice.\n\nP.S. Please write soon.',
        extraContentItems: [{ type: 'card', label: 'Enclosed card', transcript: 'A separate message.\n' + 'A long note stays in the reading flow. '.repeat(50), imageIds: ['scan-2'] }],
        status: 'published', visibility: 'PUBLISHED', transcriptPublished: true, metadataPublished: true,
        transcriptStatus: 'VERIFIED', metadataContentStatus: 'VERIFIED', extraContentStatus: 'VERIFIED',
      } });
      return route.fulfill({ status: 404, json: {} });
    });
    await page.goto('/letter/reading?from=highlight&image=scan-2');
    await expect(page.getByRole('status', { name: 'Scan page' })).toHaveText('2 / 2');
    await page.evaluate(() => document.fonts.ready);
    await expect(page.getByText('My dearest friend,', { exact: false }).first()).toBeVisible();
    // Observe beyond the former entry timers and their animation lifetime.
    await page.waitForTimeout(1200);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    const scanImage = page.locator('.scan-slide[data-index="1"] .progressive-image__full');
    await expect.poll(() => scanImage.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    await expect(scanImage).toHaveCSS('opacity', '1');
    const boxes = await page.evaluate(() => {
      const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect().toJSON();
      return { heading: rect('.letter-hero-section h1'), header: rect('header.header'),
        text: rect('#letter-transcript'), scan: rect('.letter-scan-figure'),
        image: rect('.scan-slide[data-index="1"] .scan-slide-img'),
        docWidth: document.documentElement.scrollWidth, viewport: innerWidth };
    });
    expect(boxes.heading.top - boxes.header.bottom).toBeGreaterThanOrEqual(15);
    expect(boxes.docWidth).toBeLessThanOrEqual(boxes.viewport);
    expect(boxes.image.width / boxes.image.height).toBeCloseTo(.75, 2);
    if (width <= 900) {
      expect(boxes.text.top).toBeGreaterThan(boxes.scan.bottom);
      // WebKit's fractional flex sizing can differ by just over half a pixel.
      expect(boxes.image.width).toBeLessThanOrEqual(width - 24);
      expect(boxes.image.height).toBeLessThanOrEqual(558);
      expect(boxes.heading.top).toBeGreaterThanOrEqual(boxes.scan.bottom);
    } else {
      expect(boxes.image.height).toBeGreaterThan(513);
      expect(boxes.scan.bottom).toBeLessThanOrEqual(900);
      expect(boxes.image.left + boxes.image.width / 2).toBeCloseTo(width / 2, 0);
      expect(boxes.heading.top).toBeGreaterThanOrEqual(boxes.scan.bottom);
      expect(boxes.text.top).toBeGreaterThan(boxes.heading.bottom);
    }
    await testInfo.attach('A3 geometry', { body: JSON.stringify(boxes), contentType: 'application/json' });
    await testInfo.attach('A3 reader', { body: await page.screenshot(), contentType: 'image/png' });
    const source = page.getByRole('button', { name: 'View on scan 2 ↗', exact: true });
    await source.scrollIntoViewIfNeeded();
    const y = await page.evaluate(() => window.scrollY);
    await source.click();
    await expect(page.locator('.viewer-page-counter')).toHaveText('2 / 2');
    await page.keyboard.press('Escape');
    await expect(source).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBeCloseTo(y, 0);
  });
}
