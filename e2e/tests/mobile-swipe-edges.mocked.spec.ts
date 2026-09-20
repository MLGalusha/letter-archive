import { expect, test, type Page } from '@playwright/test';
import { API_BASE_URL } from './utils/test-helpers';
import { openReader, closeReader } from './utils/reader-viewer-fixture';

test.use({ isMobile: true, hasTouch: true });
test.beforeEach(async ({ page }) => {
  // Keep external font delivery from changing line wrapping between the two
  // geometry measurements. Real-font appearance is checked in the visual pass.
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
});

async function openHome(page: Page) {
  await page.route(`${API_BASE_URL}/**`, route => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith('/images/')) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="tan"/></svg>' });
    if (path === '/content/featured-letter') return route.fulfill({ json: { id: 'featured', collectionCode: '009', imageType: 'letter', imageUrl: '/images/featured.svg', hook: 'A letter from home' } });
    if (path === '/letters/featured') return route.fulfill({ json: { id: 'featured', images: [] } });
    if (path === '/letters/search') return route.fulfill({ json: { letters: [], page: 1, limit: 24, total: 0, facets: { formats: [], collections: [], correspondents: [], places: [], years: [], topics: [], tones: [], relationships: [] } } });
    if (path === '/settings/public') return route.fulfill({ json: {} });
    if (path === '/blog') return route.fulfill({ json: { posts: [], total: 0 } });
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto('/');
  await expect(page.locator('.home-hero-feature-card').first()).toBeAttached();
  await page.evaluate(() => document.fonts.ready);
}

async function boxes(page: Page, selectors: string[]) {
  return page.evaluate(selectors => selectors.map(selector => {
    const r = document.querySelector(selector)!.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }), selectors);
}

function sameGeometry(actual: Awaited<ReturnType<typeof boxes>>, expected: Awaited<ReturnType<typeof boxes>>) {
  for (let i = 0; i < actual.length; i++) {
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      // WebKit can round decoded image aspect ratios to a different subpixel.
      expect(Math.abs(actual[i][key] - expected[i][key]), `${i}.${key}`).toBeLessThan(1);
    }
  }
}

async function noDocumentOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
}

async function paintsAtEdges(page: Page, selector: string, y: number) {
  expect(await page.evaluate(({ selector, y }) => [1, innerWidth - 1].map(x => !!document.elementFromPoint(x, y)?.closest(selector)), { selector, y })).toEqual([true, true]);
}

for (const width of [320, 390, 430, 640]) {
  test(`@mocked homepage swipe paints to edges and preserves resting geometry at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openHome(page);
    const selectors = ['.hero-carousel-slide:nth-child(2) > *', '.hero-carousel-dots', '.home-archive-surface', '.header'];
    const resting = await boxes(page, selectors);
    // Reconstruct the old clipping geometry to compare content dimensions and
    // surrounding layout, rather than accepting changed sizes as a new baseline.
    const baseline = await page.addStyleTag({ content: '.hero-carousel-viewport {margin-inline:0;} .hero-carousel-slide {padding-inline:0;}' });
    sameGeometry(await boxes(page, selectors), resting);
    await baseline.evaluate(el => el.remove());
    const frame = (await page.locator('.hero-carousel-viewport').boundingBox())!;
    expect(frame.x).toBe(0);
    expect(frame.width).toBe(width);
    const card = page.locator('.hero-carousel-slide:nth-child(2) > *');
    const start = (await card.boundingBox())!;
    await page.mouse.move(width - 50, frame.y + 100);
    await page.mouse.down();
    await page.mouse.move(width - 50 - 150, frame.y + 100, { steps: 8 });
    expect((await card.boundingBox())!.x - start.x).toBeCloseTo(-150, 1);
    await paintsAtEdges(page, '.hero-carousel-slide', frame.y + 100);
    await noDocumentOverflow(page);
    await page.mouse.up();
    await expect(page.getByRole('tab', { name: 'Slide 2' })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('tab', { name: 'Slide 1' }).click();
    sameGeometry(await boxes(page, selectors), resting);
  });
}

for (const reducedMotion of ['reduce', 'no-preference'] as const) {
  test(`@mocked homepage keeps its activation distance, cancellation and infinite wrap (${reducedMotion})`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 1000 });
    await page.emulateMedia({ reducedMotion });
    await openHome(page);
    const first = page.getByRole('tab', { name: 'Slide 1' });
    const second = page.getByRole('tab', { name: 'Slide 2' });
    // Keep autoplay paused without changing gesture or transition behavior.
    await first.click();
    const frame = (await page.locator('.hero-carousel-viewport').boundingBox())!;
    const width = (await page.locator('.hero-carousel-wrap').boundingBox())!.width;
    const drag = async (dx: number) => {
      await page.mouse.move(200, frame.y + 100);
      await page.mouse.down();
      await page.mouse.move(200 + dx, frame.y + 100, { steps: 5 });
      await page.mouse.up();
    };
    await drag(-(width * .2 - 2));
    await expect(first).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => page.locator('.hero-carousel-slide:nth-child(2) > *').evaluate(el => el.getBoundingClientRect().x)).toBeCloseTo(16, 0);
    // This exceeds the old threshold but is below 20% of the wider viewport.
    await drag(-(width * .2 + 2));
    await expect(second).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => page.locator('.hero-carousel-slide:nth-child(3) > *').evaluate(el => el.getBoundingClientRect().x)).toBeCloseTo(16, 0);
    await drag(-100);
    await expect(first).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => page.locator('.hero-carousel-slide:nth-child(2) > *').evaluate(el => el.getBoundingClientRect().x)).toBeCloseTo(16, 0);
    await drag(100);
    await expect(second).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => page.locator('.hero-carousel-slide:nth-child(3) > *').evaluate(el => el.getBoundingClientRect().x)).toBeCloseTo(16, 0);
    await expect(page).toHaveURL(/\/$/); // Dragging the featured link never opens it.
  });
}

for (const width of [320, 390, 430, 844, 901, 1280, 1440, 1920]) {
  test(`@mocked inline scans preserve geometry, edge painting and endpoint selection at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openReader(page);
    await closeReader(page);
    // The fixture opens a tall scan at its center. Return to the top and let
    // the existing scroll-responsive header finish expanding before measuring.
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await expect(page.locator('.header')).not.toHaveClass(/header--dock-collapsed/);
    await page.locator('.header').evaluate(async el => {
      await new Promise(requestAnimationFrame);
      await Promise.all(el.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {})));
    });
    await page.locator('.scan-slide-img-inner').first().evaluate((el: HTMLImageElement) => el.decode());
    const selectors = ['.scan-slide', '.scan-slide-img', '.scan-navigation', '.letter-reading-column', '.header'];
    const resting = await boxes(page, selectors);
    const baseline = await page.addStyleTag({ content: '.scan-carousel {margin-inline:0; padding-inline:0;}' });
    sameGeometry(await boxes(page, selectors), resting);
    await baseline.evaluate(el => el.remove());
    const carousel = page.locator('.scan-carousel');
    const frame = (await carousel.boundingBox())!;
    expect(frame.x).toBeCloseTo(0, 0);
    expect(frame.width).toBeCloseTo(width, 0);
    const noSnap = await page.addStyleTag({ content: '.scan-carousel {scroll-snap-type:none !important;}' });
    if (width <= 900) {
      await carousel.evaluate(el => { el.scrollLeft = 120; });
      await paintsAtEdges(page, '.scan-slide', Math.max(frame.y + 100, 250));
    } else {
      // Put the incoming image halfway through the right screen edge, then
      // the outgoing image halfway through the left. Their boxes alone are
      // insufficient: hit testing detects an ancestor clipping their paint.
      for (const [index, edge] of [[1, width - 1], [0, 1]]) {
        await carousel.evaluate((el, { index, width }) => {
          const image = el.children[index].querySelector('.scan-slide-img')!.getBoundingClientRect();
          el.scrollLeft += image.left + image.width / 2 - (index === 1 ? width : 0);
        }, { index, width });
        const image = (await page.locator('.scan-slide-img').nth(index).boundingBox())!;
        const y = Math.max(image.y + 100, 250);
        expect(await page.evaluate(({ edge, y }) =>
          document.elementFromPoint(edge, y)?.closest('.scan-slide')?.getAttribute('data-index'),
        { edge, y })).toBe(String(index));
      }
    }
    // Finish the synthetic unsnapped paint probe at a real snap point before
    // testing user navigation. Otherwise WebKit can still be restoring the
    // probe's intermediate scroll position during the following click.
    await carousel.evaluate(el => { el.scrollLeft = 0; });
    await expect(page.locator('.scan-navigation [role="status"]')).toHaveText('1 / 3');
    await noSnap.evaluate(el => el.remove());
    await expect.poll(() => carousel.evaluate(el => el.scrollLeft)).toBe(0);
    for (const n of [3, 1, 2, 1]) {
      await page.getByRole('button', { name: `Go to scan ${n}: letter`, exact: true }).evaluate(el => el.click());
      await expect(page.locator('.scan-navigation [role="status"]')).toHaveText(`${n} / 3`);
      await expect.poll(() => carousel.evaluate((el, n) => {
        const frame = el.getBoundingClientRect(), slide = el.children[n - 1].getBoundingClientRect();
        return Math.abs(slide.x + slide.width / 2 - frame.x - frame.width / 2);
      }, n)).toBeLessThan(1);
    }
    sameGeometry(await boxes(page, selectors), resting);
    await noDocumentOverflow(page);
    await page.locator('.scan-slide').first().click();
    await expect(page.getByRole('dialog', { name: 'Original scans' })).toHaveCount(0);
    await page.locator('.scan-slide').first().focus();
    await page.keyboard.press('+');
    await expect(page.getByRole('dialog', { name: 'Original scans' })).toBeVisible();
  });
}

test('@mocked asymmetric safe-area geometry keeps both carousel content lanes and centers intact', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openHome(page);
  // These are synthetic layout values, not an emulation of an iPhone notch.
  await page.addStyleTag({ content: '.body-layout {--page-inset-left:60px;--page-inset-right:16px;}' });
  const homeCard = (await page.locator('.hero-carousel-slide:nth-child(2) > *').boundingBox())!;
  expect(homeCard.x).toBe(60);
  expect(homeCard.width).toBe(524);
  await noDocumentOverflow(page);
  await openReader(page);
  await closeReader(page);
  await page.addStyleTag({ content: '.letter-article {--reader-inset-left:56px;--reader-inset-right:12px;}' });
  const carousel = page.locator('.scan-carousel');
  for (const n of [3, 1]) {
    await page.getByRole('button', { name: `Go to scan ${n}: letter`, exact: true }).evaluate(el => el.click());
    await expect.poll(() => page.locator('.scan-slide').nth(n - 1).evaluate(el => el.getBoundingClientRect().x)).toBeCloseTo(56, 0);
  }
  expect((await carousel.boundingBox())!.x).toBe(0);
  await noDocumentOverflow(page);
});
