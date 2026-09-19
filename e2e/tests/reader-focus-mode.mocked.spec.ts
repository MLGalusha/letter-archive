import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';
import { openReader, closeReader, mockReader, viewerImages } from './utils/reader-viewer-fixture';

// Record actual canvas paints, including their source crop and backing-store size.
async function recordReturnPaints(page: Page) {
  const record = () => {
    (window as any).returnPaints = [];
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    const round = CanvasRenderingContext2D.prototype.roundRect;
    const sources = new WeakMap<HTMLCanvasElement, string>();
    let radiusRatio = 0;
    CanvasRenderingContext2D.prototype.roundRect = function (...args) {
      if (this.canvas.classList.contains('reader-focus-return')) radiusRatio = Number(args[4]) / args[2];
      return round.apply(this, args);
    };
    CanvasRenderingContext2D.prototype.drawImage = function (...args: any[]) {
      if (args[0] instanceof HTMLImageElement) sources.set(this.canvas, args[0].currentSrc);
      if (this.canvas.classList.contains('reader-focus-return')) {
        const [image, sx, sy, sw, sh, dx, dy, dw, dh] = args;
        (window as any).returnPaints.push({ source: sources.get(image), naturalWidth: image.width,
          sx, sy, sw, sh, dx, dy, dw, dh, radiusRatio,
          backingWidth: this.canvas.width, backingHeight: this.canvas.height,
          carousel: document.querySelector('.scan-carousel')?.scrollLeft,
          strip: document.querySelector('.reader-focus-strip .viewer-page-drawer')?.scrollLeft,
          selected: document.querySelector('.reader-focus-strip [aria-current="page"]')?.getAttribute('aria-label') });
      }
      return (draw as Function).apply(this, args);
    };
  };
  await page.addInitScript(record);
  await page.evaluate(record);
}

for (const width of [390, 1440]) for (const reducedMotion of ['reduce', 'no-preference'] as const) {
  test(`@mocked scan clicks select and return to the top without zoom at ${width}px with ${reducedMotion}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion });
    await mockReader(page);
    await page.goto('/letter/current');
    const clickVisibleImage = async (index: number) => {
      const rect = (await page.locator('.scan-slide-img').nth(index).boundingBox())!;
      const left = Math.max(0, rect.x), right = Math.min(width, rect.x + rect.width);
      expect(right - left).toBeGreaterThan(10);
      await page.mouse.click((left + right) / 2, Math.max(220, Math.min(450, rect.y + rect.height / 2)));
    };
    await expect(page.locator('.scan-slide-img').first()).toBeVisible();
    await page.evaluate(() => window.scrollTo({ top: 120, behavior: 'instant' }));
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(120);
    await clickVisibleImage(0);
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await clickVisibleImage(0);
    expect(await page.evaluate(() => scrollY)).toBe(0);
    await expect(page.locator('.scan-navigation [role="status"]')).toHaveText('1 / 3');
    if (width === 390) {
      // Side scans are offscreen on phones; exercise the selected second scan.
      await page.locator('.letter-scan-figure .viewer-page-choice').nth(1).click();
      await expect.poll(() => page.locator('.scan-slide').nth(1).evaluate(el => {
        const rect = el.getBoundingClientRect();
        return Math.abs(rect.left + rect.width / 2 - innerWidth / 2);
      })).toBeLessThan(2);
    }
    await page.evaluate(() => window.scrollTo({ top: 120, behavior: 'instant' }));
    await clickVisibleImage(1);
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
    await expect(page.locator('.scan-navigation [role="status"]')).toHaveText('2 / 3');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.scan-slide').nth(1)).toHaveAttribute('aria-pressed', 'true');
    await page.evaluate(() => window.scrollTo({ top: 120, behavior: 'instant' }));
    await page.locator('.scan-slide').nth(1).press('Enter');
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
}

test('@mocked dragging the main scan does not trigger click-to-top', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 844 });
  await mockReader(page);
  await page.goto('/letter/current');
  await expect(page.locator('.scan-slide-img').first()).toBeVisible();
  await page.evaluate(() => window.scrollTo({ top: 120, behavior: 'instant' }));
  await page.mouse.move(750, 400);
  await page.mouse.down();
  await page.mouse.move(500, 400, { steps: 10 });
  await page.mouse.up();
  expect(await page.evaluate(() => scrollY)).toBe(120);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

for (const width of [390, 1440]) for (const selected of [1, 2]) for (const zoomSteps of [2, 12]) {
  test(`@mocked thumbnail ${selected} exits directly from zoom to regular mode at ${width}px after ${zoomSteps} zoom steps`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await recordReturnPaints(page);
    await openReader(page);
    if (zoomSteps === 12) {
      await closeReader(page);
      await page.evaluate(() => { (window as any).returnPaints = []; });
      await page.locator('.scan-slide').first().evaluate(el => el.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true, cancelable: true, ctrlKey: true, deltaY: -1,
      })));
      await expect(page.locator('.reader-focus-backdrop')).toHaveAttribute('data-direct-zoom', 'true');
    }
    for (let step = 0; step < zoomSteps; step++) await page.keyboard.press('+');
    await expect.poll(() => page.locator('.viewer-transform').evaluate(el => el.getAnimations().length)).toBe(0);
    // Include a panned return: it must start at the current view, not at fit.
    await page.mouse.move(width / 2, 350);
    await page.mouse.down();
    await page.mouse.move(width / 2 + 80, 430, { steps: 5 });
    await page.mouse.up();
    const zoomed = (await page.locator('.viewer-transform').boundingBox())!;
    await page.locator('.reader-focus-strip').getByRole('button', { name: `Go to scan ${selected}: letter`, exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const paints = await page.evaluate(() => (window as any).returnPaints as any[]);
    expect(paints.length).toBeGreaterThan(3);
    expect(paints[0].naturalWidth * paints[0].dw / paints[0].sw).toBeCloseTo(zoomed.width, 0);
    expect(new Set(paints.map(paint => paint.source)).size).toBe(1);
    expect(paints[0].source).toMatch(/\/images\/1\.svg/);
    for (const paint of paints) {
      expect(paint.carousel).toBeCloseTo(0);
      expect(paint.strip).toBeCloseTo(paints[0].strip);
      expect(paint.selected).toBe('Go to scan 1: letter');
    }
    for (const paint of paints) {
      expect(paint.dw).toBeLessThanOrEqual(width);
      expect(paint.dh).toBeLessThanOrEqual(844);
      expect(paint.backingWidth).toBeLessThanOrEqual(width * 2);
      expect(paint.backingHeight).toBeLessThanOrEqual(844 * 2);
    }
    // The ending frame reveals the entire image rather than a shrunken crop.
    expect(paints.at(-1).sx).toBeCloseTo(0);
    expect(paints.at(-1).sy).toBeCloseTo(0);
    expect(paints.at(-1).sw).toBeCloseTo(paints.at(-1).naturalWidth);
    await expect(page.locator('.scan-navigation [role="status"]')).toHaveText(`${selected} / 3`);
    await expect.poll(() => page.evaluate(() => history.state?.readerFocus ?? null)).toBeNull();
    const scan = page.locator('.scan-slide').nth(selected - 1);
    await expect.poll(() => scan.evaluate(el => {
      const rect = el.getBoundingClientRect(); return Math.abs(rect.left + rect.width / 2 - innerWidth / 2);
    })).toBeLessThan(2);
    await scan.press('+');
    await expect(page.locator('.reader-focus-backdrop')).toHaveAttribute('data-phase', 'focused');
    await expect(page.locator('.letter-viewer--focus')).toHaveAttribute('data-zoom', '1.4');
    await closeReader(page);
  });
}

for (const reducedMotion of ['reduce', 'no-preference'] as const) {
  test(`@mocked queued thumbnail return supports backward navigation and latest choice with ${reducedMotion}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 844 });
    await page.emulateMedia({ reducedMotion });
    await recordReturnPaints(page);
    await mockReader(page);
    await page.goto('/letter/current');
    await page.locator('.letter-scan-figure .viewer-page-choice').nth(2).click();
    const centered = (index: number) => expect.poll(() => page.locator('.scan-slide').nth(index).evaluate(el => {
      const rect = el.getBoundingClientRect(); return Math.abs(rect.left + rect.width / 2 - innerWidth / 2);
    })).toBeLessThan(2);
    await centered(2);
    await page.locator('.scan-slide').nth(2).press('+');
    await expect(page.locator('.reader-focus-backdrop')).toHaveAttribute('data-phase', 'focused');
    await page.keyboard.press('+');
    await expect(page.locator('.viewer-transform')).not.toHaveClass(/animating/);
    // Both clicks occur before the return can finish; the latest destination wins.
    await page.locator('.reader-focus-strip').evaluate(el => {
      const buttons = el.querySelectorAll<HTMLButtonElement>('.viewer-page-choice');
      buttons[1].click();
      buttons[0].click();
    });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await centered(0);
    await expect(page.locator('.scan-navigation [role="status"]')).toHaveText('1 / 3');
    const paints = await page.evaluate(() => (window as any).returnPaints as any[]);
    if (reducedMotion === 'no-preference') {
      expect(paints.length).toBeGreaterThan(3);
      for (const paint of paints) expect(paint.source).toMatch(/\/images\/3\.svg/);
    }
  });
}

for (const width of [390, 1440]) for (const selected of [1, 2]) {
  test(`@mocked zoom return to scan ${selected} uses a complete preview while original is pending at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await recordReturnPaints(page);
    await openReader(page, [viewerImages[0], { ...viewerImages[1], width: 1000, height: 500 }]);
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route(/\/images\/[12]\.svg$/, async route => { await held; await route.fallback(); });
    try {
      for (let step = 0; step < 12; step++) await page.keyboard.press('+');
      await expect(page.locator('.reader-focus .viewer-image-thumb')).toBeVisible();
      await page.locator('.reader-focus-strip button').nth(selected - 1).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      const paints = await page.evaluate(() => (window as any).returnPaints as any[]);
      expect(paints.length).toBeGreaterThan(3);
      expect(new Set(paints.map(paint => paint.source)).size).toBe(1);
      expect(paints[0].source).toMatch(/\/images\/1\.svg\?/);
      expect(paints.at(-1).sw).toBeCloseTo(paints.at(-1).naturalWidth);
      await expect(page.locator('.scan-navigation [role="status"]')).toHaveText(`${selected} / 2`);
    } finally { release(); }
  });
}

for (const width of [390, 1440]) test(`@mocked scan brightness stays standard when zoom loads the original at ${width}px`, async ({ page }) => {
  test.skip(!await page.evaluate(() => CSS.supports('dynamic-range-limit', 'standard')),
    'This browser build predates HDR dynamic-range control.');
  await page.setViewportSize({ width, height: 844 });
  const { opener } = await openReader(page);
  const image = page.locator('.reader-focus .viewer-image');
  await expect(image).toHaveAttribute('src', /[?&]w=\d+/);
  await expect(image).toHaveCSS('dynamic-range-limit', 'standard');
  await expect(page.locator('.reader-focus-flight')).toHaveCSS('dynamic-range-limit', 'standard');
  await expect(page.locator('.reader-focus-strip img').first()).toHaveCSS('dynamic-range-limit', 'standard');
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/images/1.svg', async route => { await held; await route.fallback(); });
  try {
    for (let i = 0; i < 5; i++) await page.keyboard.press('+');
    await expect(image).toHaveAttribute('src', /\/images\/1\.svg$/);
    await expect(page.locator('.reader-focus .viewer-image-thumb')).toHaveCSS('dynamic-range-limit', 'standard');
  } finally { release(); }
  // Cross the rendition threshold: preserve original pixels without enabling
  // HDR brightness. Physical HDR luminance cannot be checked in headless SDR.
  await expect(image).toHaveAttribute('src', /\/images\/1\.svg$/);
  await expect(image).toHaveCSS('opacity', '1');
  await expect(image).toHaveCSS('dynamic-range-limit', 'standard');
  await page.locator('.reader-focus-strip').getByRole('button', { name: 'Go to scan 1: letter', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(opener.locator('img').last()).toHaveCSS('dynamic-range-limit', 'standard');
});

for (const width of [390, 1440]) test(`@mocked focus mode zooms edge to edge and restores the page at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  const { y, opener } = await openReader(page);
  const dialog = page.getByRole('dialog', { name: 'Original scans' });
  await expect(dialog.getByRole('button', { name: 'Close viewer' })).toHaveCount(0);
  const stage = dialog.locator('.viewer-container');
  const strip = dialog.locator('.viewer-page-drawer');
  const stripBefore = (await strip.boundingBox())!;
  const image = (await dialog.locator('.viewer-transform').boundingBox())!;
  expect(image.y).toBeGreaterThanOrEqual(0);
  expect(image.y + image.height).toBeLessThanOrEqual(stripBefore.y);
  await expect(page.locator('.reader-focus-backdrop')).toHaveCSS('background-color', 'rgb(245, 237, 225)');
  expect((await stage.boundingBox())!.width).toBe(width);
  await expect(dialog.locator('.viewer-toolbar')).toHaveCount(0);
  await stage.evaluate(el => {
    for (const [type, touches] of [
      ['touchstart', [{ clientX: 280, clientY: 300 }]],
      ['touchmove', [{ clientX: 70, clientY: 300 }]], ['touchend', []],
    ] as const) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'touches', { value: touches }); el.dispatchEvent(event);
    }
  });
  await expect(dialog.locator('.viewer-page-counter')).toHaveText('1 / 3');
  await expect(dialog.locator('.viewer-carriage')).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  for (let i = 0; i < 5; i++) await page.keyboard.press('+');
  await expect.poll(async () => (await dialog.locator('.viewer-transform').boundingBox())!.width).toBeGreaterThan(width);
  await expect.poll(async () => (await dialog.locator('.viewer-transform').boundingBox())!.y).toBeLessThan(0);
  const zoom = (await dialog.locator('.viewer-transform').boundingBox())!;
  expect(zoom.y).toBeLessThan(0);
  expect(zoom.y + zoom.height).toBeGreaterThan(844);
  expect(await strip.boundingBox()).toEqual(stripBefore);
  expect(await strip.evaluate(el => {
    const box = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
  })).toBe(true);
  await strip.getByRole('button', { name: 'Go to scan 2: letter', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.scan-navigation [role="status"]')).toHaveText('2 / 3');
  await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(y, 0);
  await expect(page.locator('#root')).not.toHaveAttribute('inert');
  await expect(opener).toBeFocused();
});

for (const width of [390, 1440, 1920]) test(`@mocked focus entry visibly slides neighbors away and eases the header at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await mockReader(page);
  await page.goto('/letter/current');
  await page.locator('.letter-scan-figure .viewer-page-choice').nth(1).click();
  await expect.poll(() => page.locator('.scan-slide').nth(1).evaluate(el => {
    const r = el.getBoundingClientRect(); return Math.abs(r.left + r.width / 2 - innerWidth / 2);
  })).toBeLessThan(2);
  const measure = () => page.evaluate(() => {
    const scans = [...document.querySelectorAll('.scan-slide-img')].map(el => {
      const r = el.getBoundingClientRect(); return { left: r.left, right: r.right };
    });
    return { scans, headerBottom: document.querySelector('.header')!.getBoundingClientRect().bottom };
  });
  const before = await measure();
  await page.locator('.scan-slide').nth(1).press('+');
  await expect(page.locator('.reader-focus-backdrop')).toHaveAttribute('data-phase', 'entering');
  await page.evaluate(() => {
    // Inspect a real intermediate animation frame without a wall-clock race.
    for (const animation of document.getAnimations()) { animation.pause(); animation.currentTime = 150; }
  });
  const during = await measure();
  expect(during.headerBottom).toBeGreaterThan(before.headerBottom * .4);
  expect(during.headerBottom).toBeLessThan(before.headerBottom - 5);
  if (width > 900) {
    expect(during.scans[0].right).toBeGreaterThan(2);
    expect(during.scans[0].right).toBeLessThan(before.scans[0].right - 10);
    expect(during.scans[2].left).toBeLessThan(width - 2);
    expect(during.scans[2].left).toBeGreaterThan(before.scans[2].left + 10);
    await expect(page.locator('.reader-focus-backdrop')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  }
  await page.evaluate(() => document.getAnimations().forEach(animation => animation.play()));
  await expect(page.locator('.reader-focus-backdrop')).toHaveAttribute('data-phase', 'focused');
  const after = await measure();
  expect(after.scans[0].right).toBeLessThanOrEqual(0);
  expect(after.scans[2].left).toBeGreaterThanOrEqual(width);
  await closeReader(page);
  const returned = await measure();
  expect(returned.headerBottom).toBeCloseTo(before.headerBottom, 0);
  expect(returned.scans).toEqual(before.scans);
});

for (const reduce of [false, true]) test(`@mocked focus entry and exit share the image geometry, reduced motion ${reduce}`, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: reduce ? 'reduce' : 'no-preference' });
  const { opener } = await openReader(page);
  await closeReader(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const before = await page.locator('.scan-slide-img').first().boundingBox();
  await opener.press('+');
  if (!reduce) {
    await expect(page.locator('.reader-focus-backdrop')).toHaveAttribute('data-phase', 'entering');
    const flight = (await page.locator('.reader-focus-flight').boundingBox())!;
    expect(flight.width).toBeGreaterThan(0);
    expect(await page.locator('.reader-focus-flight').evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.locator('.scan-slide-img').first().boundingBox()).toEqual(before);
  await opener.press('+');
  await expect(page.locator('.reader-focus-backdrop')).toHaveAttribute('data-phase', 'focused');
  await page.goBack();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).toHaveURL(/\/letter\/current$/);
});

test('@mocked deliberate pinch past fit exits while ordinary fit stays open', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Native multitouch uses CDP; physical Safari is checked separately.');
  await page.setViewportSize({ width: 390, height: 844 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
  await openReader(page);
  const pinch = async (start: number, distances: number[]) => {
    const points = (distance: number) => [{ x: 195 - distance / 2, y: 350, id: 1 }, { x: 195 + distance / 2, y: 350, id: 2 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(start) });
    for (const distance of distances) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(distance) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  await pinch(100, [120, 150, 200]);
  await expect.poll(() => page.locator('.letter-viewer--focus').getAttribute('data-zoom').then(Number)).toBeCloseTo(2, 2);
  await pinch(200, [170, 140, 100]);
  await expect(page.locator('.letter-viewer--focus')).toHaveAttribute('data-zoom', '1');
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await pinch(150, [130, 110, 90]);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => visualViewport!.scale)).toBe(1);
});

for (const width of [390, 1440]) test(`@mocked inline zoom enters focus without a dark transition at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  await openReader(page);
  await closeReader(page);
  const scan = page.locator('.scan-slide').first();
  const original = (await page.locator('.scan-slide-img').first().boundingBox())!;
  await scan.evaluate(el => el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -30 })));
  await expect(page.locator('.reader-focus-backdrop')).toHaveAttribute('data-phase', 'focused');
  await expect(page.locator('.reader-focus-backdrop')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(page.locator('.reader-focus-backdrop')).toHaveCSS('--viewer-surface', '#f5ede1');
  await page.locator('.viewer-container').evaluate(el => el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -40 })));
  await expect.poll(() => page.locator('.letter-viewer--focus').getAttribute('data-zoom').then(Number)).toBeCloseTo(Math.pow(1.01, 70), 2);
  const geometry = (await page.locator('.viewer-transform').boundingBox())!;
  expect(geometry.width).toBeCloseTo(original.width * Math.pow(1.01, 70), 0);
  await expect(page.locator('.reader-focus-flight')).toHaveCSS('visibility', 'hidden');
  await expect(page.locator('.reader-focus-backdrop')).toHaveAttribute('data-phase', 'focused');
  await page.keyboard.press('Escape');
  await expect(page.locator('.reader-focus-backdrop')).toHaveAttribute('data-phase', 'exiting');
  await expect(page.locator('.reader-focus-backdrop')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

for (const width of [390, 1440]) test(`@mocked tiny wheel steps cross the document zoom boundary without a dead zone at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  await mockReader(page);
  await page.goto('/letter/current');
  await expect(page.locator('.scan-slide-img').first()).toBeVisible();
  const samples = await page.evaluate(async () => {
    const read = () => {
      const image = document.querySelector('.viewer-transform') ?? document.querySelector('.scan-slide-img')!;
      const r = image.getBoundingClientRect();
      return { width: r.width, top: r.top, left: r.left, focus: Boolean(document.querySelector('.reader-focus-backdrop')) };
    };
    const samples = [read()];
    for (let i = 0; i < 3; i++) {
      for (const deltaY of [-1, -1, 1, 1]) {
        const target = document.querySelector('.reader-focus .viewer-container') ?? document.querySelector('.scan-slide')!;
        target.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY }));
        await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
        samples.push(read());
      }
    }
    return samples;
  });
  for (let i = 1; i < samples.length; i++) {
    const step = (i - 1) % 4;
    expect(samples[i].width).toBeCloseTo(samples[0].width * 1.01 ** [1, 2, 1, 0][step], 0);
    expect(samples[i].focus).toBe(step !== 3);
    if (step === 3) {
      expect(samples[i].top).toBeCloseTo(samples[0].top, 0);
      expect(samples[i].left).toBeCloseTo(samples[0].left, 0);
    }
  }
});

for (const width of [390, 1440]) for (const reducedMotion of ['reduce', 'no-preference'] as const) {
  test(`@mocked zoom chrome completes mode animations independently of the gesture at ${width}px with ${reducedMotion}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion });
    await mockReader(page);
    await page.goto('/letter/current');
    await page.locator('.letter-scan-figure .viewer-page-choice').nth(1).click();
    await expect.poll(() => page.locator('.scan-slide').nth(1).evaluate(el => {
      const r = el.getBoundingClientRect(); return Math.abs(r.left + r.width / 2 - innerWidth / 2);
    })).toBeLessThan(2);
    const measure = () => page.evaluate(() => ({
      header: document.querySelector('.header')!.getBoundingClientRect().bottom,
      left: document.querySelectorAll('.scan-slide-img')[0].getBoundingClientRect().right,
      right: document.querySelectorAll('.scan-slide-img')[2].getBoundingClientRect().left,
    }));
    const before = await measure();
    const wheel = (deltaY: number) => page.evaluate(deltaY => {
      const target = document.querySelector('.reader-focus .viewer-container') ?? document.querySelector('.scan-slide[aria-pressed="true"]')!;
      target.dispatchEvent(new WheelEvent('wheel', { deltaY, ctrlKey: true, bubbles: true, cancelable: true }));
    }, deltaY);
    await wheel(-1);
    await expect.poll(async () => (await measure()).header).toBeLessThan(0);
    expect((await measure()).left).toBeLessThanOrEqual(0);
    expect((await measure()).right).toBeGreaterThanOrEqual(width);
    await expect(page.locator('.letter-viewer--focus')).toHaveAttribute('data-zoom', '1.01');
    // Oscillating above document size must not bring any chrome back.
    await wheel(-1); await wheel(1);
    expect((await measure()).header).toBeLessThan(0);
    await wheel(1);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('#root')).not.toHaveAttribute('inert');
    if (reducedMotion === 'no-preference') {
      await page.evaluate(() => {
        for (const animation of document.getAnimations()) { animation.pause(); animation.currentTime = 150; }
      });
      const returning = await measure();
      expect(returning.header).toBeGreaterThan(0);
      expect(returning.header).toBeLessThan(before.header - 1);
      // Re-enter while the return is incomplete; it reverses from here.
      await wheel(-1);
      await expect.poll(async () => (await measure()).header).toBeLessThan(0);
      expect((await measure()).left).toBeLessThanOrEqual(0);
      expect((await measure()).right).toBeGreaterThanOrEqual(width);
      await wheel(1);
    }
    await expect.poll(async () => (await measure()).header).toBeCloseTo(before.header, 0);
    await expect.poll(async () => Math.abs((await measure()).left - before.left)).toBeLessThan(2);
    await expect.poll(async () => Math.abs((await measure()).right - before.right)).toBeLessThan(2);
    await expect(page.locator('.scan-slide').first()).toHaveCSS('transform', 'none');
    // The returned header really receives pointer hits again.
    expect(await page.locator('.header .page-selector').first().evaluate(el => {
      const r = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
    })).toBe(true);
  });
}

test('@mocked native pinch starts on the inline scan and continues through focus entry', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Native multitouch uses CDP.');
  await page.setViewportSize({ width: 390, height: 844 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
  await openReader(page);
  await closeReader(page);
  const scan = (await page.locator('.scan-slide-img').first().boundingBox())!;
  const x = scan.x + scan.width / 2, y = Math.max(150, scan.y + scan.height / 2);
  const points = (distance: number) => [{ x: x - distance / 2, y, id: 1 }, { x: x + distance / 2, y, id: 2 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(100) });
  for (const distance of [110, 130, 160, 200]) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(distance) });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('.reader-focus-backdrop')).toHaveAttribute('data-phase', 'focused');
  await expect.poll(() => page.locator('.letter-viewer--focus').getAttribute('data-zoom').then(Number)).toBeCloseTo(2, 2);
  expect(await page.evaluate(() => visualViewport!.scale)).toBe(1);
  await expect(page.locator('.viewer-page-counter')).toHaveText('1 / 3');
  // A new pinch can cross back to the document and re-enter without lifting.
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(200) });
  for (const distance of [180, 150, 120, 101, 100]) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(distance) });
  }
  await expect(page.locator('.letter-viewer--focus')).toHaveAttribute('data-zoom', '1');
  expect((await page.locator('.viewer-transform').boundingBox())!.width).toBeCloseTo(scan.width, 0);
  for (const distance of [105, 120, 160]) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(distance) });
  }
  await expect.poll(() => page.locator('.letter-viewer--focus').getAttribute('data-zoom').then(Number)).toBeCloseTo(1.6, 2);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.locator('.reader-focus-strip').getByRole('button', { name: 'Go to scan 2: letter', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.scan-navigation [role="status"]')).toHaveText('2 / 3');
  // On release at document size, the temporary touch surface is removed.
  const second = (await page.locator('.scan-slide-img').nth(1).boundingBox())!;
  const secondPoints = (distance: number) => [{ x: 195 - distance / 2, y: second.y + second.height / 2, id: 1 },
    { x: 195 + distance / 2, y: second.y + second.height / 2, id: 2 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: secondPoints(100) });
  for (const distance of [120, 150, 120, 100]) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: secondPoints(distance) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await page.locator('.scan-slide-img').nth(1).boundingBox())!.width).toBeCloseTo(second.width, 0);
});

for (const width of [390, 1440]) test(`@mocked solid thumbnail surfaces match their number notches at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  await openReader(page);
  const strip = page.locator('.reader-focus-strip');
  const thumbnail = strip.locator('.viewer-page-choice').first();
  await expect.poll(() => thumbnail.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  // The image itself must fill its box without letterboxing; padding alone
  // previously looked equal while the actual photo had larger top/bottom gaps.
  for (const choice of (await strip.locator('.viewer-page-choice').all()).slice(0, 2)) {
    const geometry = await choice.evaluate(el => {
      const frame = el.getBoundingClientRect();
      const img = el.querySelector('img')!;
      const photo = img.getBoundingClientRect();
      return { insets: [photo.left - frame.left, frame.right - photo.right, photo.top - frame.top, frame.bottom - photo.bottom],
        renderedRatio: photo.width / photo.height, naturalRatio: img.naturalWidth / img.naturalHeight };
    });
    for (const inset of geometry.insets) expect(inset).toBeCloseTo(4, 1);
    expect(geometry.renderedRatio).toBeCloseTo(geometry.naturalRatio, 2);
  }
  const before = (await thumbnail.boundingBox())!;
  const notch = thumbnail.locator('.viewer-page-notch');
  const color = await notch.evaluate(el => getComputedStyle(el).backgroundColor);
  await expect(thumbnail).toHaveCSS('background-color', color);
  await expect(thumbnail).toHaveCSS('backdrop-filter', 'none');
  await expect(strip).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(thumbnail).toHaveCSS('border-radius', '6px');
  expect(await thumbnail.locator('.preview-image').evaluate(el => parseFloat(getComputedStyle(el).borderTopLeftRadius))).toBeLessThan(1.5);
  expect((await notch.boundingBox())!.y + 18).toBe(before.y + before.height);
  await page.keyboard.press('+');
  await expect(thumbnail).toHaveCSS('background-color', color);
  expect(await thumbnail.boundingBox()).toEqual(before);
  const next = strip.locator('.viewer-page-choice').nth(1);
  const restingColor = await next.evaluate(el => getComputedStyle(el).backgroundColor);
  await expect(thumbnail).toHaveCSS('border-width', '0px');
  await expect(notch).toHaveCSS('color', restingColor);
  await next.click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const regularChoices = page.locator('.letter-scan-figure .viewer-page-choice');
  await expect(regularChoices.nth(1)).toHaveAttribute('aria-current', 'page');
  await expect(regularChoices.nth(1)).toHaveCSS('background-color', color);
  await expect(regularChoices.nth(1).locator('.viewer-page-notch')).toHaveCSS('background-color', color);
  await expect(regularChoices.first()).toHaveCSS('background-color', restingColor);
  await expect(regularChoices.first().locator('.viewer-page-notch')).toHaveCSS('background-color', restingColor);
});

for (const width of [390, 1440]) test(`@mocked scan corners keep the regular image proportion across sizes at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  const { opener } = await openReader(page);
  await closeReader(page);
  const ratio = (selector: string) => page.locator(selector).first().evaluate(el => {
    const style = getComputedStyle(el);
    return parseFloat(style.borderTopLeftRadius) / parseFloat(style.width);
  });
  const reference = await ratio('.scan-slide-img');
  expect(reference).toBeGreaterThan(0);
  await expect.poll(() => ratio('.letter-scan-figure .preview-image')).toBeCloseTo(reference, 5);
  await opener.press('+');
  await expect(page.locator('.reader-focus-backdrop')).toHaveAttribute('data-phase', 'entering');
  expect(await ratio('.reader-focus-flight')).toBeCloseTo(reference, 5);
  await expect(page.locator('.reader-focus-backdrop')).toHaveAttribute('data-phase', 'focused');
  expect(await ratio('.reader-focus .viewer-image')).toBeCloseTo(reference, 5);
  expect(await ratio('.reader-focus .preview-image')).toBeCloseTo(reference, 5);
  await page.keyboard.press('+');
  await page.keyboard.press('+');
  expect(await ratio('.reader-focus .viewer-image')).toBeCloseTo(reference, 5);
  await page.setViewportSize({ width: width === 390 ? 1440 : 390, height: 844 });
  await expect.poll(async () => Math.abs(await ratio('.reader-focus .viewer-image') - await ratio('.scan-slide-img'))).toBeLessThan(.00001);
  await expect.poll(async () => Math.abs(await ratio('.reader-focus .preview-image') - await ratio('.scan-slide-img'))).toBeLessThan(.00001);
  await recordReturnPaints(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const returnRatios = await page.evaluate(() => (window as any).returnPaints.map((paint: any) => paint.radiusRatio) as number[]);
  expect(returnRatios.length).toBeGreaterThan(0);
  for (const value of returnRatios) expect(value).toBeCloseTo(await ratio('.scan-slide-img'), 5);
});


for (const width of [390, 1440]) test(`@mocked fresh scans use full rendition proportions before navigation at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  await mockReader(page, Array.from({ length: 7 }, (_, i) => ({
    id: `scan-${i + 1}`, type: 'letter', pageNumber: i + 1,
    imageUrl: `/images/${i + 1}.svg`, width: 3024, height: 4032,
  })));
  await page.route('**/images/**', async route => {
    // Real image renditions round to whole pixels: 32x43 and 800x1067
    // have different proportions. Identically sized mocks hid this regression.
    const renditionWidth = Number(new URL(route.request().url()).searchParams.get('w')) || 800;
    if (renditionWidth > 32) await new Promise(resolve => setTimeout(resolve, 100));
    await route.fulfill({ contentType: 'image/png', path: join(__dirname, 'fixtures',
      renditionWidth === 32 ? 'reader-preview-32x43.png' : 'reader-scan-800x1067.png') });
  });
  await page.goto('/letter/current');
  const choices = page.locator('.letter-scan-figure .viewer-page-choice');
  const assertNoLetterboxing = async (index: number) => {
    const photo = page.locator('.scan-slide-img').nth(index);
    await expect.poll(() => photo.locator('.progressive-image__full').evaluate((img: HTMLImageElement) =>
      img.complete && img.naturalWidth > 32 && !img.classList.contains('progressive-image__full--loading'))).toBe(true);
    await expect.poll(() => photo.evaluate(el => {
      const img = el.querySelector<HTMLImageElement>('.progressive-image__full')!;
      const box = el.getBoundingClientRect();
      return Math.abs(box.height - box.width * img.naturalHeight / img.naturalWidth);
    })).toBeLessThan(.1);
  };
  for (let index = 0; index < 7; index++) {
    if (index) await choices.nth(index).click();
    await assertNoLetterboxing(index);
    // Ready neighbors must also fit, before ever being selected.
    if (index < 6) await assertNoLetterboxing(index + 1);
  }
  await choices.first().click();
  await assertNoLetterboxing(0);
  await page.reload();
  await assertNoLetterboxing(0);
});

test('@mocked keyboard focus stays on the scan instead of outlining the empty slide', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 844 });
  const { opener } = await openReader(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expect(opener).toHaveCSS('outline-style', 'none');
  await expect(opener.locator('.scan-slide-img')).toHaveCSS('outline-style', 'none');
  expect(await opener.locator('.scan-slide-img').evaluate(el => getComputedStyle(el, '::after').content)).toBe('none');
  // Retain keyboard access after restoring focus.
  await opener.press('+');
  await expect(page.locator('.reader-focus-backdrop')).toHaveAttribute('data-phase', 'focused');
  await closeReader(page);
  await page.locator('.letter-scan-figure .viewer-page-choice').nth(1).click();
  expect(await opener.locator('.scan-slide-img').evaluate(el => getComputedStyle(el, '::after').content)).toBe('none');
});

for (const width of [390, 1440]) test(`@mocked only extreme thumbnails crop while full scans stay complete at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  const images = [
    { width: 600, height: 800 }, // Ordinary letter: 3:4.
    { width: 800, height: 600 }, // Ordinary envelope: 4:3.
    { width: 800, height: 200 }, // Wide clipping: 4:1.
    { width: 200, height: 800 }, // Narrow receipt: 1:4.
  ].map((size, index) => ({ ...size, id: `scan-${index + 1}`, type: 'letter', pageNumber: index + 1, imageUrl: `/images/${index + 1}.png` }));
  await mockReader(page, images);
  // Raster fixtures preserve natural dimensions in both Chromium and WebKit.
  const bodies = await Promise.all(images.map(image => page.evaluate(({ width, height }) => {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d')!;
    context.fillStyle = 'tan'; context.fillRect(0, 0, width, height);
    return canvas.toDataURL('image/png').split(',')[1];
  }, image)));
  await page.route('**/images/**', route => {
    const index = images.findIndex(image => image.imageUrl === new URL(route.request().url()).pathname);
    return route.fulfill({ contentType: 'image/png', body: Buffer.from(bodies[index], 'base64') });
  });
  await page.goto('/letter/current');
  const checkStrip = async (selector: string) => {
    const choices = page.locator(`${selector} .viewer-page-choice`);
    for (let index = 0; index < images.length; index++) {
      const choice = choices.nth(index);
      await choice.scrollIntoViewIfNeeded();
      await expect.poll(() => choice.locator('img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
      const geometry = await choice.evaluate(el => {
        const frame = el.getBoundingClientRect();
        const image = el.querySelector('img')!.getBoundingClientRect();
        const notch = el.querySelector('.viewer-page-notch')!.getBoundingClientRect();
        return { width: image.width, height: image.height,
          insets: [image.left - frame.left, frame.right - image.right, image.top - frame.top, frame.bottom - image.bottom],
          uncoveredHeight: notch.top - image.top };
      });
      expect(geometry.width).toBeCloseTo(48, 1);
      expect(geometry.height).toBeCloseTo([64, 36, 32, 96][index], 1);
      for (const inset of geometry.insets) expect(inset).toBeCloseTo(4, 1);
      expect(geometry.uncoveredHeight).toBeGreaterThanOrEqual(18);
    }
  };
  await checkStrip('.letter-scan-figure');
  await page.locator('.letter-scan-figure .viewer-page-choice').nth(2).click();
  const wideScan = page.locator('.scan-slide').nth(2);
  await expect.poll(() => wideScan.locator('.progressive-image__full').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth === 800)).toBe(true);
  await expect.poll(() => wideScan.locator('.scan-slide-img').evaluate(el => {
    const box = el.getBoundingClientRect(); return box.width / box.height;
  })).toBeCloseTo(4, 2);
  await wideScan.press('+');
  await expect(page.locator('.reader-focus-backdrop')).toHaveAttribute('data-phase', 'focused');
  await checkStrip('.reader-focus-strip');
  for (const index of [2, 3]) {
    await page.locator('.reader-focus-strip .viewer-page-choice').nth(index).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.locator('.scan-slide').nth(index).press('+');
    await expect(page.locator('.reader-focus-backdrop')).toHaveAttribute('data-phase', 'focused');
    await expect.poll(() => page.locator('.viewer-transform').evaluate(el => {
      const box = el.getBoundingClientRect(); return box.width / box.height;
    })).toBeCloseTo(images[index].width / images[index].height, 2);
  }
});
