import { expect, test } from '@playwright/test';
import { openReader, closeReader } from './utils/reader-viewer-fixture';

for (const width of [390, 1440]) test(`@mocked focus mode zooms edge to edge and restores the page at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  const { y, opener } = await openReader(page);
  const dialog = page.getByRole('dialog', { name: 'Original scans' });
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
  await expect(dialog.locator('.letter-viewer')).toHaveAttribute('data-zoom', '1');
  await expect(dialog.locator('.viewer-page-counter')).toHaveText('2 / 3');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.scan-navigation [role="status"]')).toHaveText('2 / 3');
  await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(y, 0);
  await expect(page.locator('#root')).not.toHaveAttribute('inert');
  await expect(opener).toBeFocused();
});

for (const reduce of [false, true]) test(`@mocked focus entry and exit share the image geometry, reduced motion ${reduce}`, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: reduce ? 'reduce' : 'no-preference' });
  const { opener } = await openReader(page);
  await closeReader(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const before = await page.locator('.scan-slide-img').first().boundingBox();
  await opener.click();
  if (!reduce) {
    await expect(page.locator('.reader-focus-backdrop')).toHaveAttribute('data-phase', 'entering');
    const flight = (await page.locator('.reader-focus-flight').boundingBox())!;
    expect(flight.width).toBeGreaterThan(0);
    expect(await page.locator('.reader-focus-flight').evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.locator('.scan-slide-img').first().boundingBox()).toEqual(before);
  await opener.click();
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
  await scan.evaluate(el => el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -30 })));
  await expect(page.locator('.reader-focus-backdrop')).toHaveAttribute('data-phase', 'entering');
  await expect(page.locator('.reader-focus-backdrop')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(page.locator('.reader-focus-backdrop')).toHaveCSS('--viewer-surface', '#f5ede1');
  await page.locator('.viewer-container').evaluate(el => el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -40 })));
  await expect.poll(() => page.locator('.letter-viewer--focus').getAttribute('data-zoom').then(Number)).toBeCloseTo(Math.pow(1.01, 70), 2);
  const geometry = await page.evaluate(async () => {
    await new Promise(resolve => setTimeout(resolve, 150));
    const flight = document.querySelector('.reader-focus-flight')!.getBoundingClientRect();
    const image = document.querySelector('.viewer-transform')!.getBoundingClientRect();
    return { flight: flight.width, image: image.width };
  });
  expect(geometry.flight).toBeGreaterThan(geometry.image * .65);
  await expect(page.locator('.reader-focus-backdrop')).toHaveAttribute('data-phase', 'focused');
  await page.keyboard.press('Escape');
  await expect(page.locator('.reader-focus-backdrop')).toHaveAttribute('data-phase', 'exiting');
  await expect(page.locator('.reader-focus-backdrop')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

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
  await page.locator('.reader-focus-strip').getByRole('button', { name: 'Go to scan 2: letter', exact: true }).click();
  await expect(page.locator('.letter-viewer--focus')).toHaveAttribute('data-zoom', '1');
  await closeReader(page);
});

for (const width of [390, 1440]) test(`@mocked solid thumbnail surfaces match their number notches at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  await openReader(page);
  const strip = page.locator('.reader-focus-strip');
  const thumbnail = strip.locator('.viewer-page-choice').first();
  const before = (await thumbnail.boundingBox())!;
  const notch = thumbnail.locator('.viewer-page-notch');
  const color = await notch.evaluate(el => getComputedStyle(el).backgroundColor);
  await expect(thumbnail).toHaveCSS('background-color', color);
  await expect(thumbnail).toHaveCSS('backdrop-filter', 'none');
  await expect(strip).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  const radius = await thumbnail.evaluate(el => getComputedStyle(el).borderRadius);
  await expect(thumbnail.locator('.preview-image')).toHaveCSS('border-radius', radius);
  expect((await notch.boundingBox())!.y + 18).toBe(before.y + before.height);
  await page.keyboard.press('+');
  await expect(thumbnail).toHaveCSS('background-color', color);
  expect(await thumbnail.boundingBox()).toEqual(before);
});
