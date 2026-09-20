import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';
import { API_BASE_URL } from './utils/test-helpers';

test.use({ isMobile: true, hasTouch: true });
// Geometry assertions must not race an external font changing heading wrapping.
// Real-font appearance is reviewed separately against the live preview.
test.beforeEach(async ({ page }) => {
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
});
async function openCards(page: Page, path = '/collections/003', withNotes = true) {
  await page.setViewportSize({ width: 390, height: 844 });
  const collection = { id: 'collection-003', collectionCode: '003', title: 'Carousel collection', description: withNotes ? 'Carousel browser checks' : '', createdAt: '2026-01-01', letterCount: 24 };
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
    if (path === '/content/featured-letter') return route.fulfill({ json: { id: 'item-0', collectionCode: '003', imageUrl: '/images/scan-0', hook: 'A letter from home' } });
    if (path === '/letters/item-0') return route.fulfill({ json: { id: 'item-0', images: [{ id: 'one', type: 'letter', imageUrl: '/images/scan-0' }, { id: 'two', type: 'letter', imageUrl: '/images/scan-1' }] } });
    if (path === '/blog') return route.fulfill({ json: { posts: [], total: 0 } });
    if (path === '/settings/public') return route.fulfill({ json: {} });
    if (path === '/letters/search') return route.fulfill({ json: {
      letters: Array.from({ length: 24 }, (_, index) => ({ id: `archive-${index}`, title: `Archive item ${index}`, imageType: 'letter' })),
      page: 1, limit: 24, total: 24,
      facets: { formats: [], collections: [], correspondents: [], places: [], years: [], topics: [], tones: [], relationships: [] },
    } });
    return route.fulfill({ status: 404, json: { error: 'Not found' } });
  });
  await page.goto(path);
  const carousel = page.locator('.card-carousel');
  await expect(carousel.locator('.card-carousel-dot')).toHaveCount(2);
  await page.evaluate(() => document.fonts.ready);
  await carousel.scrollIntoViewIfNeeded();
  return carousel;
}

for (const path of ['/', '/collections/003']) {
  test(`@mocked manual cards never rotate and preserve selection across layouts: ${path}`, async ({ page }) => {
    await page.clock.install();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const carousel = await openCards(page, path);
    await page.clock.fastForward(60000);
    const dots = carousel.locator('.card-carousel-dot');
    await expect(dots.first()).toHaveAttribute('aria-current', 'true');
    await dots.nth(1).click();
    await expect(dots.nth(1)).toHaveAttribute('aria-current', 'true');
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(carousel).toHaveAttribute('data-layout', 'static');
    await expect(carousel.locator('[inert]')).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(dots.nth(1)).toHaveAttribute('aria-current', 'true');
    await page.clock.fastForward(60000);
    await expect(dots.nth(1)).toHaveAttribute('aria-current', 'true');
  });

  test(`@mocked mouse drags do not open cards, keyboard stops at the ends: ${path}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const carousel = await openCards(page, path);
    const viewport = carousel.locator('.card-carousel-viewport');
    const dots = carousel.locator('.card-carousel-dot');
    await dots.nth(1).click();
    await expect(dots.nth(1)).toHaveAttribute('aria-current', 'true');
    await viewport.scrollIntoViewIfNeeded();
    const box = (await viewport.boundingBox())!;
    await page.mouse.move(box.x + 90, box.y + 90);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 20, box.y + 95, { steps: 10 });
    await page.mouse.up();
    await expect(dots.first()).toHaveAttribute('aria-current', 'true');
    await expect(page).toHaveURL(new RegExp(path === '/' ? '/$' : '/collections/003$'));
    await viewport.focus();
    await page.keyboard.press('End');
    await expect(dots.nth(1)).toHaveAttribute('aria-current', 'true');
    await page.keyboard.press('ArrowRight');
    await expect(dots.nth(1)).toHaveAttribute('aria-current', 'true');
    await page.keyboard.press('Home');
    await expect(dots.first()).toHaveAttribute('aria-current', 'true');
  });

  test(`@mocked rapid reversals settle on the last requested card: ${path}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const carousel = await openCards(page, path);
    const dots = carousel.locator('.card-carousel-dot');
    await dots.nth(1).click();
    await dots.first().click();
    await dots.nth(1).click();
    await expect(dots.nth(1)).toHaveAttribute('aria-current', 'true');
    const viewport = carousel.locator('.card-carousel-viewport');
    await expect.poll(() => viewport.evaluate(el => Math.abs(el.scrollLeft - el.clientWidth))).toBeLessThan(1);
    await dots.first().click();
    await expect.poll(() => viewport.evaluate(el => el.scrollLeft)).toBe(0);
    await expect.poll(() => viewport.evaluate(el => getComputedStyle(el).scrollSnapType)).toBe('x mandatory');
  });
}

test('@mocked releasing the mouse outside the frame does not leave a stale drag', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const carousel = await openCards(page);
  const viewport = carousel.locator('.card-carousel-viewport');
  const box = (await viewport.boundingBox())!;
  await page.mouse.move(box.x + box.width - 40, box.y + box.height - 4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 40, box.y + box.height + 20);
  await page.mouse.up();
  await page.mouse.move(box.x + 40, box.y + box.height - 20);
  await expect(viewport).not.toHaveAttribute('data-dragging', 'true');
  await expect.poll(() => viewport.evaluate(el => el.scrollLeft)).toBe(0);
  expect(errors).toEqual([]);
});

for (const width of [320, 390, 430, 640]) {
  test(`@mocked collection cards share a fixed rounded frame and a straight seam at ${width}px`, async ({ page }) => {
    const carousel = await openCards(page, '/collections/003', false);
    await page.setViewportSize({ width, height: 844 });
    const frame = carousel.locator('.card-carousel-frame');
    const before = await frame.boundingBox();
    // This fixture has no People panel. Desktop's reserved sidebar width must
    // not shrink the mobile carousel when collection metadata is absent.
    await expect(page.locator('.cd-people-col')).toHaveCount(0);
    const lane = (await page.locator('.cd-explore').boundingBox())!;
    expect(before!.width).toBeCloseTo(lane.width, 1);
    expect((await carousel.locator('.cd-highlight-card').first().boundingBox())!.width).toBeCloseTo(lane.width, 1);
    const viewport = carousel.locator('.card-carousel-viewport');
    await viewport.evaluate(el => { (el as HTMLElement).style.scrollSnapType = 'none'; el.scrollLeft = 120; });
    const seam = await carousel.locator('.card-carousel-slide > *').evaluateAll(es => ({
      gap: es[1].getBoundingClientRect().left - es[0].getBoundingClientRect().right,
      radii: es.map(el => getComputedStyle(el).borderRadius),
    }));
    expect(seam).toEqual({ gap: 0, radii: ['0px', '0px'] });
    expect(await frame.boundingBox()).toEqual(before);
    expect(await frame.evaluate(el => getComputedStyle(el).borderRadius)).toBe('24px');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('@mocked native diagonal touch moves continuously without custom direction locking', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'CDP delivers real touch input only in Chromium; physical Safari remains a separate check.');
  const carousel = await openCards(page);
  const box = (await carousel.locator('.card-carousel-viewport').boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const y = box.y + 100;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 270, y }] });
  for (const [x, dy] of [[246, 16], [215, 17], [160, 18], [60, 19]]) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + dy }] });
  }
  await expect.poll(() => carousel.locator('.card-carousel-viewport').evaluate(el => el.scrollLeft)).toBeGreaterThan(100);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(carousel.locator('.card-carousel-dot').nth(1)).toHaveAttribute('aria-current', 'true');
  await expect(page).toHaveURL(/collections\/003$/);
});

test.describe('desktop wheel input', () => {
  test.use({ isMobile: false, hasTouch: false });
test('@mocked native wheel scrolling changes cards while vertical wheel scrolling stays on the page', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit' && process.platform !== 'darwin',
    'Native WebKit wheel coverage runs in the macOS job; Linux WebKit blocks root overscroll wheels (docs/qa/reader-page-picker.md).');
  const carousel = await openCards(page);
  const viewport = carousel.locator('.card-carousel-viewport');
  const box = (await viewport.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 90);
  await page.mouse.wheel(260, 0);
  await expect(carousel.locator('.card-carousel-dot').nth(1)).toHaveAttribute('aria-current', 'true');
  const before = await page.evaluate(() => scrollY);
  await page.mouse.wheel(0, 200);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(before);
  await expect(page).toHaveURL(/collections\/003$/);
});

});
