import { expect, test, type Page } from '@playwright/test';
import { API_BASE_URL } from './utils/test-helpers';

async function openReader(page: Page) {
  await page.route(`${API_BASE_URL}/**`, route => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith('/images/')) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="tan"/></svg>' });
    if (path === '/settings/public') return route.fulfill({ json: {} });
    if (path.endsWith('/adjacent')) return route.fulfill({ json: { prev: { id: 'previous' }, next: { id: 'next' }, position: 2, total: 3, collectionCode: '001' } });
    if (path.startsWith('/letters/')) return route.fulfill({ json: {
      id: path.split('/')[2], collectionCode: '001', metadata: { hook: 'A letter from home', verified: true },
      images: [1, 2, 3].map(pageNumber => ({ id: `scan-${pageNumber}`, type: 'letter', pageNumber, imageUrl: `/images/${pageNumber}.svg`, width: 600, height: 800 })),
      transcript: { pages: [], fullText: 'A long letter. '.repeat(200), verified: true },
      status: 'published', visibility: 'PUBLISHED', transcriptPublished: true, metadataPublished: true,
      transcriptStatus: 'VERIFIED', metadataContentStatus: 'VERIFIED', extraContentStatus: 'EMPTY',
    } });
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto('/letter/current');
  const opener = page.locator('[aria-label="View page 1 full size"]');
  await expect(opener).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await opener.scrollIntoViewIfNeeded();
  // Explicit focus also models keyboard activation in WebKit, where mouse clicks
  // intentionally do not focus buttons.
  await opener.focus();
  const y = await page.evaluate(() => window.scrollY);
  const styles = await page.locator('body').evaluate(el => el.style.cssText);
  await opener.press('Enter');
  return { opener, y, styles };
}

for (const width of [390, 1440]) {
  test(`@mocked fullscreen owns focus and scan keys at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const { opener, y, styles } = await openReader(page);
    const dialog = page.getByRole('dialog', { name: 'Original scans' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Close viewer' })).toBeFocused();
    await expect(page.locator('#root')).toHaveAttribute('inert', '');
    for (let i = 0; i < 16; i++) {
      await page.keyboard.press(i < 8 ? 'Tab' : 'Shift+Tab');
      expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
    }
    await opener.evaluate(el => (el as HTMLElement).focus());
    expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('ArrowRight');
    await expect(dialog.locator('.viewer-page-counter')).toHaveText('2 / 3');
    await expect(page).toHaveURL(/\/letter\/current$/);
    await dialog.locator('.viewer-container').dblclick();
    await expect(dialog.locator('.viewer-zoom-badge')).toHaveText('250%');
    await dialog.getByRole('button', { name: 'Close viewer' }).focus();
    await page.keyboard.press('ArrowLeft');
    await expect(dialog.locator('.viewer-page-counter')).toHaveText('1 / 3');
    await expect(dialog.locator('.viewer-zoom-badge')).toHaveText('100%');
    await page.keyboard.press('ArrowLeft');
    await expect(dialog.locator('.viewer-page-counter')).toHaveText('3 / 3');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    await expect(page.locator('#root')).not.toHaveAttribute('inert');
    expect((await page.locator('body').evaluate(el => el.style.cssText)) || '').toBe(styles || '');
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeCloseTo(y, 0);
    // Closing gives the reader its normal adjacent-letter shortcut back.
    await page.keyboard.press('ArrowRight');
    await expect(page).toHaveURL(/\/letter\/next$/);
  });
}

test('@mocked leaving the route while fullscreen restores background interaction', async ({ page }) => {
  await page.goto('/about');
  await openReader(page);
  await expect(page.getByRole('dialog', { name: 'Original scans' })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/about$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('#root')).not.toHaveAttribute('inert');
  expect(await page.locator('body').evaluate(el => el.style.position)).toBe('');
});

test('@mocked pointer opening restores focus to its actual scan trigger', async ({ page }) => {
  const { opener } = await openReader(page);
  await page.keyboard.press('Escape');
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Original scans' });
  await expect(dialog.getByRole('button', { name: 'Close viewer' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Close viewer' }).click();
  await expect(opener).toBeFocused();
});
