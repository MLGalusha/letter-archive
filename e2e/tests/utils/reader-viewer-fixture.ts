import { expect, type Page } from '@playwright/test';
import { API_BASE_URL } from './test-helpers';

export const viewerImages = [1, 2, 3].map(pageNumber => ({ id: `scan-${pageNumber}`, type: 'letter', pageNumber, imageUrl: `/images/${pageNumber}.svg`, width: 600, height: 800 }));
export async function mockReader(page: Page, images = viewerImages) {
  await page.route(`${API_BASE_URL}/**`, route => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith('/images/')) {
      const image = images.find(image => image.imageUrl === path) ?? images[0];
      return route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="${image.width}" height="${image.height}"><rect width="100%" height="100%" fill="tan"/><text x="20" y="40">Scan ${image.pageNumber}</text></svg>` });
    }
    if (path === '/settings/public') return route.fulfill({ json: {} });
    if (path.endsWith('/adjacent')) return route.fulfill({ json: { prev: { id: 'previous' }, next: { id: 'next' }, position: 2, total: 3, collectionCode: '001' } });
    if (path.startsWith('/letters/')) return route.fulfill({ json: {
      id: path.split('/')[2], collectionCode: '001', metadata: { hook: 'A letter from home', verified: true },
      images,
      transcript: { pages: [], fullText: 'A long letter. '.repeat(200), verified: true },
      status: 'published', visibility: 'PUBLISHED', transcriptPublished: true, metadataPublished: true,
      transcriptStatus: 'VERIFIED', metadataContentStatus: 'VERIFIED', extraContentStatus: 'EMPTY',
    } });
    return route.fulfill({ status: 404, json: {} });
  });
}

export async function openReader(page: Page, images = viewerImages) {
  await mockReader(page, images);
  await page.goto('/letter/current');
  const opener = page.locator('[aria-label="Select page 1"]');
  await expect(opener).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await opener.scrollIntoViewIfNeeded();
  // Explicit focus also models keyboard activation in WebKit, where mouse clicks
  // intentionally do not focus buttons.
  await opener.focus();
  const y = await page.evaluate(() => window.scrollY);
  const styles = await page.locator('body').evaluate(el => el.style.cssText);
  await opener.press('+');
  await expect(page.locator('.reader-focus-backdrop')).toHaveAttribute('data-phase', 'focused');
  // Most viewer assertions start at fit; entry itself now requires zoom.
  await page.keyboard.press('0');
  await expect(page.locator('.viewer-transform')).not.toHaveClass(/animating/);
  return { opener, y, styles };
}


export async function closeReader(page: Page) {
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Original scans' })).toHaveCount(0);
}
