import { expect, test } from '@playwright/test';
import { openReader } from './utils/reader-viewer-fixture';

test('@mocked fullscreen Close clears simulated phone safe areas and remains clickable', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'CDP inset override is Chromium-only, not physical iOS validation.');
  await page.setViewportSize({ width: 390, height: 844 });
  const { opener } = await openReader(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 59, bottom: 34, left: 0, right: 0 } });
  const close = page.getByRole('button', { name: 'Close viewer' });
  await expect.poll(async () => (await close.boundingBox())!.y).toBeGreaterThanOrEqual(59);
  expect((await close.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const toolbar = page.locator('.viewer-toolbar');
  expect((await toolbar.boundingBox())!.y + (await toolbar.boundingBox())!.height).toBeLessThanOrEqual(844 - 34);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, bottom: 21, left: 47, right: 47 } });
  await page.setViewportSize({ width: 844, height: 390 });
  await expect.poll(async () => (await close.boundingBox())!.x + (await close.boundingBox())!.width).toBeLessThanOrEqual(844 - 47);
  await close.click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(opener).toBeFocused();
  // Rotation may clamp the document's old position; focus and unlocking must survive.
  expect(await page.locator('body').evaluate(el => el.style.position)).not.toBe('fixed');
});

for (const width of [320, 844, 1440]) test(`@mocked drawer reserves scan space at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 844 ? 390 : 844 });
  await openReader(page, [
    { id: 'scan-1', type: 'letter', pageNumber: 1, imageUrl: '/images/1.svg', width: 600, height: 800 },
    { id: 'scan-2', type: 'cover', pageNumber: 2, imageUrl: '/images/2.svg', width: 1000, height: 400 },
  ]);
  const dialog = page.getByRole('dialog');
  const toggle = dialog.getByRole('button', { name: 'Pages', exact: true });
  await toggle.click();
  const choice = dialog.getByRole('button', { name: 'Go to scan 2: cover' });
  await choice.click();
  await expect(dialog.locator('.viewer-page-counter')).toHaveText('2 / 2');
  await expect(choice).toHaveAttribute('aria-current', 'page');
  await expect(dialog.locator('.viewer-image')).toHaveCSS('opacity', '1');
  const boxes = await dialog.evaluate(el => {
    const box = (s: string) => el.querySelector(s)!.getBoundingClientRect().toJSON();
    return { stage: box('.viewer-container'), drawer: box('.viewer-page-drawer'), image: box('.viewer-image'),
      toolbar: box('.viewer-toolbar'), close: box('.viewer-close'), overflow: document.documentElement.scrollWidth > innerWidth,
      controls: [...el.querySelectorAll('.viewer-toolbar button')].map(button => button.getBoundingClientRect().toJSON()) };
  });
  expect(boxes.overflow).toBe(false);
  expect(boxes.image.width / boxes.image.height).toBeCloseTo(2.5, 1);
  expect(boxes.image.top).toBeGreaterThanOrEqual(boxes.stage.top - 1);
  expect(boxes.image.bottom).toBeLessThanOrEqual(boxes.stage.bottom + 1);
  expect(boxes.toolbar.top).toBeGreaterThanOrEqual(boxes.stage.bottom);
  expect(boxes.close.bottom).toBeLessThanOrEqual(boxes.stage.top);
  if (width < 760) expect(boxes.drawer.top).toBeGreaterThanOrEqual(boxes.stage.bottom);
  else expect(boxes.drawer.right).toBeLessThanOrEqual(boxes.stage.left);
  for (const box of boxes.controls) {
    expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.right).toBeLessThanOrEqual(width);
  }
  await toggle.focus(); await toggle.press('Enter');
  await expect(dialog.getByRole('region', { name: 'Scan pages' })).toHaveCount(0);
  await expect(toggle).toBeFocused();
});

test('@mocked drawer loads only nearby thumbnails after opening', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const requested = new Set<string>();
  page.on('request', request => { if (new URL(request.url()).searchParams.get('w') === '200') requested.add(request.url()); });
  await openReader(page, Array.from({ length: 32 }, (_, i) => ({ id: `scan-${i + 1}`, type: 'letter', pageNumber: i + 1,
    imageUrl: `/images/${i + 1}.svg`, width: 600, height: 800 })));
  expect(requested.size).toBe(0);
  await page.getByRole('button', { name: 'Pages', exact: true }).click();
  const drawer = page.getByRole('region', { name: 'Scan pages' });
  await expect.poll(() => requested.size).toBeGreaterThan(0);
  expect(requested.size).toBeLessThan(12);
  await drawer.evaluate(el => el.scrollTo({ left: el.scrollWidth, behavior: 'instant' }));
  const last = drawer.getByRole('button', { name: 'Go to scan 32: letter' });
  await expect.poll(() => last.locator('img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  await last.click();
  await expect(page.locator('.viewer-page-counter')).toHaveText('32 / 32');
  await expect(page.locator('.viewer-zoom-badge')).toHaveText('100%');
  expect(requested.size).toBeLessThan(20);
});

test('@mocked zoom keeps its transform and clear preview through a delayed resolution upgrade', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await openReader(page);
  const image = page.locator('.viewer-image'); await expect(image).toHaveCSS('opacity', '1');
  const surface = await page.locator('.viewer-transform').elementHandle();
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/images/1.svg?**', async route => {
    if (Number(new URL(route.request().url()).searchParams.get('w')) >= 800) await held;
    await route.fallback();
  });
  try {
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await expect(page.locator('.viewer-zoom-badge')).toHaveText('140%');
    await expect(page.locator('.viewer-image-thumb')).toBeVisible();
    expect(await surface!.evaluate(el => el === document.querySelector('.viewer-transform') && el.isConnected)).toBe(true);
    await expect.poll(() => page.locator('.viewer-transform').evaluate(el => new DOMMatrixReadOnly(getComputedStyle(el).transform).a)).toBeCloseTo(1.4, 2);
    const width = (await page.locator('.viewer-transform').boundingBox())!.width;
    release(); await expect(image).toHaveCSS('opacity', '1');
    expect(await surface!.evaluate(el => el === document.querySelector('.viewer-transform') && el.isConnected)).toBe(true);
    expect((await page.locator('.viewer-transform').boundingBox())!.width).toBeCloseTo(width, 0);
  } finally { release(); }
});

test('@mocked synthetic swipe takeover, zoomed pan and pinch keep their gesture owner', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await openReader(page);
  await expect(page.locator('.viewer-image')).toHaveCSS('opacity', '1');
  await page.evaluate(() => {
    (window as any).viewerTouch = (type: string, points: number[][]) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'touches', { value: points.map(([clientX, clientY]) => ({ clientX, clientY })) });
      document.querySelector('.viewer-container')!.dispatchEvent(event);
    };
  });
  const capture = await page.evaluate(async () => {
    const touch = (window as any).viewerTouch; const frame = () => new Promise(requestAnimationFrame);
    touch('touchstart', [[300, 250]]); touch('touchmove', [[160, 250]]);
    await frame(); await frame(); touch('touchend', []);
    await new Promise(resolve => setTimeout(resolve, 70));
    const carriage = document.querySelector('.viewer-carriage')!;
    // Freeze the animation clock so WebKit's separate computed-style reads
    // compare the same instant, even when this test shares a busy worker host.
    const animations = carriage.getAnimations();
    animations.forEach(animation => animation.pause());
    await Promise.all(animations.map(animation => animation.ready));
    const before = new DOMMatrixReadOnly(getComputedStyle(carriage).transform).m41;
    touch('touchstart', [[160, 250]]); await frame(); await frame();
    const after = new DOMMatrixReadOnly(getComputedStyle(carriage).transform).m41;
    touch('touchmove', [[160 - before, 250]]); await frame(); await frame(); touch('touchcancel', []);
    return { before, after };
  });
  expect(capture.before).toBeLessThan(-100); expect(capture.after).toBeCloseTo(capture.before, 0);
  await expect(page.locator('.viewer-page-counter')).toHaveText('1 / 3');
  await page.waitForTimeout(350); // Past the cancelled fallback: no late commit.
  await expect(page.locator('.viewer-page-counter')).toHaveText('1 / 3');
  await page.locator('.viewer-container').dblclick();
  await expect(page.locator('.viewer-zoom-badge')).toHaveText('250%');
  await expect.poll(() => page.locator('.viewer-transform').evaluate(el => new DOMMatrixReadOnly(getComputedStyle(el).transform).a)).toBeCloseTo(2.5, 2);
  await page.evaluate(async () => {
    const touch = (window as any).viewerTouch;
    touch('touchstart', [[260, 250]]); touch('touchmove', [[140, 250]]);
    await new Promise(requestAnimationFrame); touch('touchend', []);
  });
  await expect(page.locator('.viewer-page-counter')).toHaveText('1 / 3');
  await expect.poll(() => page.locator('.viewer-transform').evaluate(el => new DOMMatrixReadOnly(getComputedStyle(el).transform).m41)).toBeLessThan(-50);
  await page.getByRole('button', { name: 'Fit scan' }).click();
  await expect.poll(() => page.locator('.viewer-transform').evaluate(el => new DOMMatrixReadOnly(getComputedStyle(el).transform).a)).toBe(1);
  await page.evaluate(async () => {
    const touch = (window as any).viewerTouch;
    touch('touchstart', [[300, 250]]); touch('touchmove', [[180, 250]]); await new Promise(requestAnimationFrame);
    touch('touchstart', [[100, 250], [200, 250]]); touch('touchmove', [[50, 250], [250, 250]]);
    await new Promise(requestAnimationFrame); touch('touchend', []);
  });
  await expect(page.locator('.viewer-zoom-badge')).toHaveText('200%');
  await expect(page.locator('.viewer-page-counter')).toHaveText('1 / 3');
});

test('@mocked a touch takes over the visible zoom before its target arrives', async ({ page }) => {
  await openReader(page);
  await expect(page.locator('.viewer-image')).toHaveCSS('opacity', '1');
  const values = await page.evaluate(async () => {
    const surface = document.querySelector('.viewer-transform')!;
    const read = () => new DOMMatrixReadOnly(getComputedStyle(surface).transform).a;
    // Observe a real animation frame, then touch in that same browser task.
    const target = 1.4;
    document.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')!.click();
    let before = 1;
    for (let frame = 0; frame < 10 && before === 1; frame++) {
      await new Promise(requestAnimationFrame);
      before = read();
    }
    const animations = surface.getAnimations();
    animations.forEach(animation => animation.pause());
    await Promise.all(animations.map(animation => animation.ready));
    before = read();
    const event = new Event('touchstart', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'touches', { value: [{ clientX: 260, clientY: 250 }] });
    document.querySelector('.viewer-container')!.dispatchEvent(event);
    await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
    const after = read();
    document.querySelector('.viewer-container')!.dispatchEvent(new Event('touchcancel', { bubbles: true }));
    return { before, after, target };
  });
  expect(values.before).toBeGreaterThan(1);
  expect(values.before).toBeLessThan(values.target);
  expect(values.after).toBeCloseTo(values.before, 3);
});

test('@mocked reduced motion removes zoom interpolation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await openReader(page);
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(page.locator('.viewer-transform')).toHaveCSS('transition-duration', '0s');
  await expect(page.locator('.viewer-image')).toHaveCSS('transition-duration', '0s');
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.locator('.viewer-page-counter')).toHaveText('2 / 3');
  await expect(page.locator('.viewer-zoom-badge')).toHaveText('100%');
});
