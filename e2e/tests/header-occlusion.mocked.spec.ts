import { expect, test, type Page } from '@playwright/test';
import { openReader, closeReader } from './utils/reader-viewer-fixture';

async function scrollTo(page: Page, y: number) {
  await page.evaluate(y => window.scrollTo({ top: y, behavior: 'instant' }), y);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(y);
  // Let the scroll listener observe each direction before the next movement.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

function expectColor(pixel: number[], expected: number[]) {
  // The floating card's soft shadow can darken the gap by a few RGB levels.
  pixel.forEach((channel, index) => expect(Math.abs(channel - expected[index])).toBeLessThanOrEqual(3));
}

async function paintedPixels(page: Page, points: { x: number; y: number }[]) {
  const screenshot = await page.screenshot({ scale: 'css' });
  return page.evaluate(async ({ data, points }) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width; canvas.height = img.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    return points.map(({ x, y }) => Array.from(ctx.getImageData(x, y, 1, 1).data).slice(0, 3));
  }, { data: screenshot.toString('base64'), points });
}

async function checkCover(page: Page) {
  await expect(page.locator('.header')).not.toHaveAttribute('inert');
  await expect.poll(() => page.locator('.header').evaluate(el => el.getBoundingClientRect().top)).toBe(0);
  // Settle dock expansion/collapse before measuring its midpoint. This keeps
  // the pixel samples tied to the same geometry as the captured frame.
  await page.locator('.header').evaluate(async el => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await Promise.allSettled(el.getAnimations({ subtree: true }).map(animation => animation.finished));
  });
  const card = (await page.locator('.header-inner').boundingBox())!;
  const midpoint = card.y + card.height / 2;
  // Read actual painted pixels, not just a CSS declaration. Magenta stands for
  // scrolled content and must remain visible immediately below the midpoint.
  const pixels = await paintedPixels(page, [1, page.viewportSize()!.width - 2].flatMap(x =>
    [2, Math.floor(midpoint - 2), Math.ceil(midpoint + 2)].map(y => ({ x, y }))));
  for (const offset of [0, 3]) {
    for (const pixel of pixels.slice(offset, offset + 2)) {
      expect(pixel[1], 'letter pixels must be covered above the midpoint').toBeGreaterThan(180);
    }
    expect(pixels[offset + 2][1], 'content below the midpoint must remain visible').toBeLessThan(80);
    expect(pixels[offset + 2][0]).toBeGreaterThan(180);
    expect(pixels[offset + 2][2]).toBeGreaterThan(180);
  }
}

for (const reducedMotion of ['no-preference', 'reduce'] as const) for (const width of [390, 1440]) {
  test(`@mocked letter header occludes content only above its midpoint at ${width}px (${reducedMotion})`, async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion });
    await page.setViewportSize({ width, height: 844 });
    const { opener } = await openReader(page);
    await closeReader(page);
    await page.route('**/letters/summaries**', route => route.fulfill({ json: {
      total: 3, letters: ['previous', 'current', 'next'].map(id => ({ id })),
    } }));
    await page.reload();
    await expect(page.getByRole('slider')).toHaveAttribute('aria-disabled', 'false');
    await page.evaluate(() => document.fonts.ready);
    await scrollTo(page, 0);
    // A full-width document paint probe catches leaks at both viewport edges,
    // including content made full-bleed by the independent swipe-edge change.
    await page.evaluate(() => {
      // This probe represents ordinary document content. Large desktop scans
      // have their own cover exception, tested separately below.
      document.querySelector<HTMLElement>('.scan-carousel')!.style.visibility = 'hidden';
      const probe = document.createElement('div');
      probe.id = 'scroll-paint-probe';
      probe.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:4000px;background:#f0f;z-index:2;pointer-events:none';
      document.body.append(probe);
    });
    await checkCover(page);
    await scrollTo(page, 500);
    if (width < 901 && reducedMotion === 'no-preference') {
      await expect.poll(() => page.locator('.header').evaluate(el => el.getBoundingClientRect().bottom)).toBeLessThan(0);
      // No leftover cover when the header slides offscreen.
      const [edge] = await paintedPixels(page, [{ x: 1, y: 1 }]);
      // The offscreen card's existing shadow can darken the exposed content.
      expect(edge[0]).toBeGreaterThan(240);
      expect(edge[1]).toBeLessThan(10);
      expect(edge[2]).toBeGreaterThan(240);
      await scrollTo(page, 420);
    }
    await checkCover(page);
    await testInfo.attach('scrolled-header', { body: await page.screenshot(), contentType: 'image/png' });
    // Simulate a larger top inset; the cover boundary must derive from the card.
    await page.locator('.header').evaluate(el => (el as HTMLElement).style.setProperty('--header-top-padding', '47px'));
    await checkCover(page);
    await page.locator('.header').evaluate(el => (el as HTMLElement).style.removeProperty('--header-top-padding'));
    await checkCover(page);
    await scrollTo(page, 0);
    await page.setViewportSize({ width: width === 390 ? 1440 : 390, height: 844 });
    await checkCover(page);
    await page.evaluate(() => {
      document.querySelector('#scroll-paint-probe')!.remove();
      document.querySelector<HTMLElement>('.scan-carousel')!.style.removeProperty('visibility');
    });
    await scrollTo(page, 0);
    await expect(page.locator('.header-dock-region')).not.toHaveAttribute('inert');
    await expect(page.locator('.header-dock-region')).toHaveCSS('opacity', '1');
    const next = page.getByRole('button', { name: 'Next', exact: true });
    await expect(next).toHaveAttribute('aria-disabled', 'false');
    await next.focus();
    await expect(next).toBeFocused();
    await opener.focus();
    await expect(opener).toBeFocused();
    await opener.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Original scans' })).toBeVisible();
    await expect(page.locator('.reader-focus-backdrop')).toHaveAttribute('data-phase', 'focused');
    expect(await page.locator('.reader-focus-strip [aria-current="page"]').evaluate(el => {
      const r = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    })).toBe(true);
    await closeReader(page);
    await expect(opener).toBeFocused();
    await scrollTo(page, 500);
    await scrollTo(page, 420);
    await expect(page.locator('.header')).not.toHaveAttribute('inert');
    await testInfo.attach('reader-without-paint-probe', { body: await page.screenshot({ path: testInfo.outputPath('reader.png') }), contentType: 'image/png' });
  });
}

for (const width of [390, 900, 901, 1440, 1920]) {
  test(`@mocked only large desktop scans pass above the header cover at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openReader(page);
    await closeReader(page);
    await page.getByRole('button', { name: 'Go to scan 2: letter', exact: true }).evaluate(el => el.click());
    const scans = page.locator('.scan-carousel .progressive-image__full');
    await expect.poll(() => scans.evaluateAll(images => images.every(image => (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
    await page.evaluate(() => {
      const image = document.querySelectorAll('.scan-slide-img')[1];
      window.scrollBy({ top: image.getBoundingClientRect().top + 60, behavior: 'instant' });
    });
    await expect.poll(() => page.locator('.header').evaluate(el => el.getBoundingClientRect().top)).toBe(0);
    await page.locator('.header').evaluate(async el => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await Promise.allSettled(el.getAnimations({ subtree: true }).map(animation => animation.finished));
    });
    const points = await page.locator('.scan-slide-img').evaluateAll((images, width) => images.flatMap(image => {
      const rect = image.getBoundingClientRect();
      const left = Math.max(0, rect.left), right = Math.min(width, rect.right);
      return right - left > 20 ? [{ x: Math.floor((left + right) / 2), y: 4 }] : [];
    }), width);
    if (width >= 1440) expect(points).toHaveLength(3);
    const pixels = await paintedPixels(page, points);
    for (const pixel of pixels) {
      expectColor(pixel, width > 900 ? [210, 180, 140] : [245, 237, 225]);
    }
    const card = (await page.locator('.header-inner').boundingBox())!;
    expect(await page.locator('.header-inner').evaluate(el => {
      const r = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    })).toBe(true);
    const [cardPixel] = await paintedPixels(page, [{ x: Math.floor(card.x + card.width / 2), y: Math.floor(card.y + card.height - 8) }]);
    expectColor(cardPixel, [255, 250, 242]);

    // Scroll actual thumbnail and text containers into the top gap. Their paint
    // must still be covered, even though the large scans were visible there.
    for (const selector of ['.scan-navigation', '.letter-hero-section']) {
      await page.locator(selector).evaluate(el => {
        (el as HTMLElement).style.background = '#f0f';
        // Sample inside the control/text, clear of the preceding scan's shadow.
        window.scrollBy({ top: el.getBoundingClientRect().top + 24, behavior: 'instant' });
      });
      const [pixel] = await paintedPixels(page, [{ x: Math.floor(width / 2), y: 4 }]);
      expectColor(pixel, [245, 237, 225]);
    }
  });
}
