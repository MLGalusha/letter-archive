import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';
import { API_BASE_URL } from './utils/test-helpers';

test.use({ isMobile: true, hasTouch: true });
// Geometry assertions must not race an external font changing heading wrapping.
// Real-font appearance is reviewed separately against the live preview.
test.beforeEach(async ({ page }) => {
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
});
async function openCards(page: Page, path = '/collections/003', withNotes = true, multiScan = false) {
  await page.setViewportSize({ width: 390, height: 844 });
  const collection = { id: 'collection-003', collectionCode: '003', title: 'Carousel collection', description: withNotes ? 'Carousel browser checks' : '', createdAt: '2026-01-01', letterCount: 24 };
  const letters = ['letter', 'photo'].map((type, index) => ({
    id: `item-${index}`, images: Array.from({ length: multiScan ? 3 : 1 }, (_, scan) => ({ id: `scan-${index}-${scan}`, type, imageUrl: `/images/scan-${index}-${scan}` })),
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
  const carousel = page.locator('.home-showcase, .cd-highlights-col');
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
    await expect(carousel.locator(':scope > .card-carousel-frame > .card-carousel-viewport > .card-carousel-slide[inert]')).toHaveCount(0);
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

  test(`@mocked card endpoints stay flush during outward drags: ${path}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const carousel = await openCards(page, path);
    const viewport = carousel.locator('.card-carousel-viewport');
    // Safari exposes native rubber-banding with contain, even though Chromium
    // already clamps scrollLeft. Require the shared native boundary policy too.
    await expect(viewport).toHaveCSS('overscroll-behavior-x', 'none');
    for (const index of [0, 1]) {
      await carousel.locator('.card-carousel-dot').nth(index).click();
      await expect(carousel.locator(':scope > .card-carousel-frame')).toHaveAttribute('data-settled-slide', String(index));
      const box = (await viewport.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + 80);
      await page.mouse.down();
      await page.mouse.move(box.x + (index === 0 ? box.width - 10 : 10), box.y + 80, { steps: 8 });
      expect(await viewport.evaluate(el => el.scrollLeft)).toBe(index * box.width);
      const slide = (await carousel.locator('.card-carousel-slide').nth(index).boundingBox())!;
      expect(slide.x).toBeCloseTo(box.x, 1);
      expect(slide.width).toBeCloseTo(box.width, 1);
      await page.mouse.up();
    }
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
    const frame = carousel.locator(':scope > .card-carousel-frame');
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

test('@mocked diagonal horizontal touch follows the finger and settles on release', async ({ page, browserName }) => {
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

test('@mocked homepage outline only surrounds the settled text card', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const carousel = await openCards(page, '/');
  const frame = carousel.locator(':scope > .card-carousel-frame');
  const viewport = carousel.locator('.card-carousel-viewport');
  const outline = () => frame.evaluate(el => getComputedStyle(el, '::after').visibility);
  await expect.poll(outline).toBe('visible');
  await expect(carousel.locator('.home-hero-copy')).toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)');
  await expect(carousel.locator('.home-hero-copy')).toHaveCSS('border-radius', '0px');
  const box = (await viewport.boundingBox())!;
  await page.mouse.move(box.x + 280, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 80, { steps: 6 });
  await expect.poll(outline).toBe('hidden');
  await page.waitForTimeout(200); // Hold a partial drag beyond the scrollend fallback.
  await expect.poll(outline).toBe('hidden');
  await page.mouse.up();
  await expect.poll(outline).toBe('visible');
  await carousel.locator('.card-carousel-dot').nth(1).click();
  await expect(frame).toHaveAttribute('data-settled-slide', '1');
  await expect.poll(outline).toBe('hidden');
  await carousel.locator('.card-carousel-dot').first().click();
  await expect(frame).toHaveAttribute('data-settled-slide', '0');
  await expect.poll(outline).toBe('visible');
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(carousel).toHaveAttribute('data-layout', 'static');
  await expect(carousel.locator('.home-hero-copy')).toHaveCSS('border-top-color', 'rgba(217, 207, 191, 0.95)');
  await expect.poll(() => frame.evaluate(el => getComputedStyle(el, '::after').content)).toBe('none');
});


test.describe('wide image cards', () => {
  test.use({ isMobile: false, hasTouch: false });
  for (const path of ['/', '/collections/003']) test(`@mocked wide cards reuse swipe paging and keep image selection across layouts: ${path}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const outer = await openCards(page, path, true, true);
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(outer).toHaveAttribute('data-layout', 'static');
    const cards = page.locator(path === '/' ? '.home-hero-feature-card' : '.cd-highlight-card');
    const card = cards.first();
    const counter = page.locator(path === '/' ? '.home-hero-page-counter:visible' : '.cd-highlight-page-counter:visible').first();
    const initialHref = await card.locator('a').first().getAttribute('href');
    const expectedImage = path === '/' ? 'two' : `scan-${initialHref?.includes('item-0') ? 0 : 1}-1`;
    const inner = card.locator('.card-media-carousel');
    const viewport = inner.locator('.card-carousel-viewport');
    await expect(card.locator('button')).toHaveCount(0);
    await viewport.scrollIntoViewIfNeeded();
    const dimensions = await card.evaluate(el => {
      const card = el.getBoundingClientRect();
      const viewport = el.querySelector('.card-carousel-viewport')!.getBoundingClientRect();
      return { widthDifference: viewport.width - card.width, heightDifference: viewport.height - card.height };
    });
    expect(dimensions.widthDifference).toBeCloseTo(0, 0);
    expect(dimensions.heightDifference).toBeCloseTo(0, 0);
    const box = (await viewport.boundingBox())!;
    await page.mouse.move(box.x + box.width - 35, box.y + 90);
    await page.mouse.down();
    await page.mouse.move(box.x + 35, box.y + 90, { steps: 12 });
    await page.mouse.up();
    await expect(counter).toHaveText(path === '/' ? '2/2' : '2/3');
    await expect(page).toHaveURL(new RegExp(path === '/' ? '/$' : '/collections/003$'));
    if (path !== '/') await expect(cards.nth(1).locator('.cd-highlight-page-counter')).toHaveText('1/3');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(outer).toHaveAttribute('data-layout', 'carousel');
    if (path === '/') await outer.locator('.card-carousel-dot').nth(1).click();
    await expect(card.locator('.card-media-carousel')).toHaveCount(0);
    await expect(counter).toHaveText(path === '/' ? '2/2' : '2/3');
    await outer.getByRole('button', { name: path === '/' ? 'Previous page' : 'Previous', exact: true }).click();
    await expect(counter).toHaveText(path === '/' ? '1/2' : '1/3');
    await page.setViewportSize({ width: 1280, height: 900 });
    await viewport.focus();
    await page.keyboard.press('ArrowRight');
    await expect(counter).toHaveText(path === '/' ? '2/2' : '2/3');
    await expect(card.locator('button')).toHaveCount(0);
    await expect(card.locator('.card-media-carousel')).toHaveCount(1);
    await card.locator('.card-carousel-slide:not([inert]) a').click();
    await expect(page).toHaveURL(new RegExp(`image=${expectedImage}`));
  });
});

test.describe('image page button feedback', () => {
  for (const path of ['/', '/collections/003']) test(`@mocked touch page controls retain clipping and clear press feedback: ${path}`, async ({ page }) => {
    const outer = await openCards(page, path, true, true);
    if (path === '/') await outer.locator('.card-carousel-dot').nth(1).click();
    const card = page.locator(path === '/' ? '.home-hero-feature-card' : '.cd-highlight-card').first();
    const next = page.locator('.stationary-card-overlay:not([hidden]) .image-page-control--next').first();
    const counter = page.locator(path === '/' ? '.home-hero-page-counter:visible' : '.cd-highlight-page-counter:visible').first();
    await expect(next).toHaveCSS('-webkit-tap-highlight-color', 'rgba(0, 0, 0, 0)');
    await expect(next).toHaveCSS('opacity', '1');
    const geometry = await next.evaluate(el => {
      const r = el.getBoundingClientRect();
      const frame = el.closest('.card-carousel-frame')!;
      return { width: r.width, overflow: getComputedStyle(frame).overflow, radius: getComputedStyle(frame).borderRadius };
    });
    expect(geometry.width).toBeGreaterThanOrEqual(44);
    expect(geometry.overflow).toBe('hidden');
    expect(geometry.radius).not.toBe('0px');
    await next.scrollIntoViewIfNeeded();
    await next.hover();
    await page.mouse.down();
    await expect.poll(() => next.evaluate(el => Number(getComputedStyle(el, '::before').opacity))).toBe(0.85);
    await page.mouse.up();
    await expect(counter).toHaveText(path === '/' ? '2/2' : '2/3');
    await expect.poll(() => next.evaluate(el => Number(getComputedStyle(el, '::before').opacity))).toBe(0.3);
    await next.click();
    await expect(counter).toHaveText(path === '/' ? '1/2' : '3/3');
    await expect(page).toHaveURL(new RegExp(path === '/' ? '/$' : '/collections/003$'));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(next).toHaveCSS('transition-duration', '0s');
  });
  test.describe('mouse', () => {
    test.use({ isMobile: false, hasTouch: false });
    test('@mocked compact mouse controls reveal smoothly and remain keyboard accessible', async ({ page }) => {
      await openCards(page, '/collections/003', true, true);
      const card = page.locator('.cd-highlight-card').first();
      const next = page.locator('.stationary-card-overlay:not([hidden]) .image-page-control--next').first();
      await page.mouse.move(0, 0);
      await expect(next).toHaveCSS('opacity', '0');
      await next.hover();
      await expect(next).toHaveCSS('opacity', '1');
      await expect.poll(() => next.evaluate(el => Number(getComputedStyle(el, '::before').opacity))).toBe(0.65);
      await page.mouse.move(0, 0);
      // WebKit's default tab policy can skip buttons. Establish keyboard
      // modality before focusing the control to test its focus-visible state.
      await page.keyboard.press('Tab');
      await next.focus();
      await expect(next).toBeFocused();
      await expect(next).toHaveCSS('opacity', '1');
      await expect(next).toHaveCSS('outline-offset', '-5px');
      await page.keyboard.press('Enter');
      await expect(page.locator('.cd-highlight-page-counter:visible').first()).toHaveText('2/3');
    });
  });
});

test('@mocked touch release settles promptly and hands off to the next tap or vertical scroll', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Real touch delivery uses CDP; physical Safari must also be checked.');
  const outer = await openCards(page, '/collections/003', true, true);
  const viewport = outer.locator(':scope > .card-carousel-frame > .card-carousel-viewport');
  const cdp = await page.context().newCDPSession(page);
  const touch = async (type: string, x = 0, y = 0) => cdp.send('Input.dispatchTouchEvent', {
    type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }],
  });
  const box = (await viewport.boundingBox())!;
  const y = box.y + 110;
  await touch('touchStart', box.x + box.width - 30, y);
  for (const fraction of [0.7, 0.5, 0.3]) await touch('touchMove', box.x + box.width * fraction, y);
  const released = Date.now();
  await touch('touchEnd');
  await expect.poll(() => viewport.evaluate(el => Math.abs(el.scrollLeft - el.clientWidth)), { intervals: [16], timeout: 400 }).toBeLessThan(1);
  expect(Date.now() - released).toBeLessThan(400);
  const next = outer.locator('.stationary-card-overlay:not([hidden]) .image-page-control--next');
  await next.tap();
  await expect(outer.locator('.cd-highlight-page-counter:visible')).toHaveText('2/3');
  // Start a new vertical gesture immediately after releasing a reverse swipe,
  // while its short settling animation is still pending.
  const reverse = (await viewport.boundingBox())!;
  await touch('touchStart', reverse.x + 30, reverse.y + 110);
  for (const fraction of [0.3, 0.5, 0.7]) await touch('touchMove', reverse.x + reverse.width * fraction, reverse.y + 110);
  await touch('touchEnd');
  const startY = await page.evaluate(() => window.scrollY);
  const current = (await viewport.boundingBox())!;
  await touch('touchStart', current.x + current.width / 2, current.y + 230);
  await touch('touchMove', current.x + current.width / 2, current.y + 190);
  await touch('touchMove', current.x + current.width / 2, current.y + 90);
  await touch('touchEnd');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(startY + 40);
  await expect(page).toHaveURL(/collections\/003$/);
});

test('@mocked overlays stay anchored during card swipes and control the selected card', async ({ page }) => {
  const outer = await openCards(page, '/collections/003', true, true);
  const viewport = outer.locator(':scope > .card-carousel-frame > .card-carousel-viewport');
  const overlay = outer.locator('.stationary-card-overlay:not([hidden])');
  const next = overlay.locator('.image-page-control--next');
  await expect(next).toBeVisible();
  const before = await next.evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width }; });
  const box = (await viewport.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.8, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.2, box.y + 100, { steps: 10 });
  await expect.poll(() => viewport.evaluate(el => el.scrollLeft)).toBeGreaterThan(box.width / 2);
  await expect.poll(() => outer.evaluate(el => {
    const button = el.querySelector('.stationary-card-overlay:not([hidden]) .image-page-control--next')!;
    const r = button.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width) };
  })).toEqual({ x: Math.round(before.x), y: Math.round(before.y), width: Math.round(before.width) });
  await expect(viewport.locator('.cd-highlight-label, .cd-highlight-content, .image-page-controls')).toHaveCount(0);
  await page.mouse.up();
  await expect(outer.locator('.card-carousel-dot').nth(1)).toHaveAttribute('aria-current', 'true');
  await next.click();
  await expect(overlay.locator('.cd-highlight-page-counter')).toHaveText('2/3');
  await outer.locator('.card-carousel-dot').first().click();
  await expect(overlay.locator('.cd-highlight-page-counter')).toHaveText('1/3');
});

for (const path of ['/', '/collections/003']) {
  test(`@mocked grabbing a settling card keeps its current position: ${path}`, async ({ page }) => {
    const outer = await openCards(page, path);
    const viewport = outer.locator(':scope > .card-carousel-frame > .card-carousel-viewport');
    await page.clock.install();
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
    await outer.locator('.card-carousel-dot').nth(1).click();
    await page.clock.runFor(48);
    const before = await viewport.evaluate(el => el.scrollLeft);
    const box = (await viewport.boundingBox())!;
    expect(before).toBeGreaterThan(0);
    expect(before).toBeLessThan(box.width - 5);
    await page.mouse.move(box.x + box.width / 2, box.y + 100);
    await page.mouse.down();
    expect(await viewport.evaluate(el => el.scrollLeft)).toBeCloseTo(before, 0);
    await page.clock.runFor(200);
    expect(await viewport.evaluate(el => el.scrollLeft)).toBeCloseTo(before, 0);
    await page.mouse.move(box.x + box.width / 2 + 20, box.y + 100);
    expect(await viewport.evaluate(el => el.scrollLeft)).toBeCloseTo(before - 20, 0);
    await page.mouse.up();
  });

  test(`@mocked reversing an outward drag responds immediately: ${path}`, async ({ page }) => {
    const outer = await openCards(page, path);
    const viewport = outer.locator(':scope > .card-carousel-frame > .card-carousel-viewport');
    const box = (await viewport.boundingBox())!;
    await page.mouse.move(box.x + 100, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(box.x + 180, box.y + 100, { steps: 8 });
    expect(await viewport.evaluate(el => el.scrollLeft)).toBe(0);
    await page.mouse.move(box.x + 160, box.y + 100);
    expect(await viewport.evaluate(el => el.scrollLeft)).toBeCloseTo(20, 0);
    await page.mouse.up();
  });
}

test('@mocked homepage overlay travels with its image without darkening the introduction', async ({ page }) => {
  const outer = await openCards(page, '/');
  const viewport = outer.locator(':scope > .card-carousel-frame > .card-carousel-viewport');
  const box = (await viewport.boundingBox())!;
  await page.mouse.move(box.x + box.width - 30, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 30, box.y + 100, { steps: 10 });
  const photo = (await outer.locator('.home-hero-feature-card').boundingBox())!;
  const overlay = (await outer.locator('.home-hero-overlay').boundingBox())!;
  expect(overlay.x).toBeCloseTo(photo.x, 0);
  expect(overlay.width).toBeCloseTo(photo.width, 0);
  expect(photo.x).toBeGreaterThan(box.x + 10);
  await expect(outer.locator('.card-carousel-overlay-host .home-hero-overlay')).toHaveCount(0);
  await page.mouse.up();
});

test('@mocked touch reversals and interrupted settling follow the finger without dead travel', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'CDP supplies real touch input; physical Safari remains a separate check.');
  const outer = await openCards(page, '/collections/003', true, true);
  const viewport = outer.locator(':scope > .card-carousel-frame > .card-carousel-viewport');
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: string, x = 0, y = 0) => cdp.send('Input.dispatchTouchEvent', {
    type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }],
  });
  const box = (await viewport.boundingBox())!;
  const y = box.y + 100;
  await touch('touchStart', box.x + 100, y);
  await touch('touchMove', box.x + 140, y);
  await touch('touchMove', box.x + 180, y);
  expect(await viewport.evaluate(el => el.scrollLeft)).toBe(0);
  await touch('touchMove', box.x + 160, y);
  expect(await viewport.evaluate(el => el.scrollLeft)).toBeCloseTo(20, 0);
  await touch('touchEnd');
  await outer.locator('.card-carousel-dot').first().click();
  await expect.poll(() => viewport.evaluate(el => el.scrollLeft)).toBe(0);
  await page.clock.install();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await outer.locator('.card-carousel-dot').nth(1).click();
  await page.clock.runFor(48);
  const before = await viewport.evaluate(el => el.scrollLeft);
  expect(before).toBeGreaterThan(20);
  expect(before).toBeLessThan(box.width - 5);
  await touch('touchStart', box.x + box.width / 2, y);
  expect(await viewport.evaluate(el => el.scrollLeft)).toBeCloseTo(before, 0);
  await touch('touchMove', box.x + box.width / 2 + 20, y);
  expect(await viewport.evaluate(el => el.scrollLeft)).toBeCloseTo(before - 20, 0);
  await touch('touchEnd');
});

for (const path of ['/', '/collections/003']) {
  test(`@mocked mouse drags from either image-page control swipe cards without paging images: ${path}`, async ({ page }) => {
    const outer = await openCards(page, path, true, true);
    const viewport = outer.locator(':scope > .card-carousel-frame > .card-carousel-viewport');
    const startIndex = path === '/' ? 1 : 0;
    await outer.locator('.card-carousel-dot').nth(startIndex).click();
    await expect(outer.locator(':scope > .card-carousel-frame')).toHaveAttribute('data-settled-slide', String(startIndex));
    for (const side of ['previous', 'next']) {
      const button = outer.locator(`.stationary-card-overlay:not([hidden]) .image-page-control--${side}`).first();
      const counter = outer.locator('.home-hero-page-counter:visible, .cd-highlight-page-counter:visible').first();
      const text = await counter.textContent();
      const box = (await button.boundingBox())!;
      const frame = (await viewport.boundingBox())!;
      const x = box.x + box.width / 2, y = box.y + box.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + (startIndex ? 1 : -1) * frame.width * 0.7, y, { steps: 12 });
      await page.mouse.up();
      await expect(outer.locator('.card-carousel-dot').nth(1 - startIndex)).toHaveAttribute('aria-current', 'true');
      await expect(page).toHaveURL(new RegExp(path === '/' ? '/$' : '/collections/003$'));
      await outer.locator('.card-carousel-dot').nth(startIndex).click();
      await expect(outer.locator(':scope > .card-carousel-frame')).toHaveAttribute('data-settled-slide', String(startIndex));
      await expect(counter).toHaveText(text!);
      // The next genuine click still works after suppressing the drag's click.
      await button.click();
      await expect(counter).not.toHaveText(text!);
    }
  });
}

for (const path of ['/', '/collections/003']) {
  test(`@mocked touch can swipe from page controls and still tap them afterward: ${path}`, async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'CDP supplies real touch input; physical Safari remains a separate check.');
    const outer = await openCards(page, path, true, true);
    const viewport = outer.locator(':scope > .card-carousel-frame > .card-carousel-viewport');
    const startIndex = path === '/' ? 1 : 0;
    await outer.locator('.card-carousel-dot').nth(startIndex).click();
    await expect(outer.locator(':scope > .card-carousel-frame')).toHaveAttribute('data-settled-slide', String(startIndex));
    const side = startIndex ? 'previous' : 'next';
    const button = outer.locator(`.stationary-card-overlay:not([hidden]) .image-page-control--${side}`).first();
    const counter = outer.locator('.home-hero-page-counter:visible, .cd-highlight-page-counter:visible').first();
    const text = await counter.textContent();
    const box = (await button.boundingBox())!;
    const frame = (await viewport.boundingBox())!;
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: string, px = 0) => cdp.send('Input.dispatchTouchEvent', {
      type, touchPoints: type === 'touchEnd' ? [] : [{ x: px, y }],
    });
    await touch('touchStart', x);
    for (const fraction of [0.15, 0.35, 0.7]) await touch('touchMove', x + (startIndex ? 1 : -1) * frame.width * fraction);
    await touch('touchEnd');
    await expect(outer.locator('.card-carousel-dot').nth(1 - startIndex)).toHaveAttribute('aria-current', 'true');
    await expect(page).toHaveURL(new RegExp(path === '/' ? '/$' : '/collections/003$'));
    await outer.locator('.card-carousel-dot').nth(startIndex).click();
    await expect(outer.locator(':scope > .card-carousel-frame')).toHaveAttribute('data-settled-slide', String(startIndex));
    await expect(counter).toHaveText(text!);
    await button.tap();
    await expect(counter).not.toHaveText(text!);
  });
}
