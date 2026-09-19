import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { openReader, closeReader, mockReader } from './utils/reader-viewer-fixture';

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
  await expect(next).toHaveAttribute('aria-current', 'page');
  await expect(next).toHaveCSS('background-color', color);
  await expect(next.locator('.viewer-page-notch')).toHaveCSS('background-color', color);
  await expect(thumbnail).toHaveCSS('background-color', restingColor);
  await expect(notch).toHaveCSS('background-color', restingColor);
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
  await opener.click();
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
  await page.keyboard.press('Escape');
  await expect(page.locator('.reader-focus-backdrop')).toHaveAttribute('data-phase', 'exiting');
  // The exit phase is set before its next-frame flight geometry is installed.
  await expect(page.locator('.reader-focus-flight')).toHaveCSS('visibility', 'visible');
  expect(await ratio('.reader-focus-flight')).toBeCloseTo(await ratio('.scan-slide-img'), 5);
  await expect(page.getByRole('dialog')).toHaveCount(0);
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
  expect(await opener.locator('.scan-slide-img').evaluate(el => getComputedStyle(el, '::after').content)).toBe('"Open full size"');
  // Retain keyboard access after restoring focus.
  await opener.press('Enter');
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
  await expect.poll(() => wideScan.locator('img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth === 800)).toBe(true);
  await expect.poll(() => wideScan.locator('.scan-slide-img').evaluate(el => {
    const box = el.getBoundingClientRect(); return box.width / box.height;
  })).toBeCloseTo(4, 2);
  await wideScan.press('Enter');
  await expect(page.locator('.reader-focus-backdrop')).toHaveAttribute('data-phase', 'focused');
  await checkStrip('.reader-focus-strip');
  for (const index of [2, 3]) {
    await page.locator('.reader-focus-strip .viewer-page-choice').nth(index).click();
    await expect.poll(() => page.locator('.viewer-transform').evaluate(el => {
      const box = el.getBoundingClientRect(); return box.width / box.height;
    })).toBeCloseTo(images[index].width / images[index].height, 2);
  }
});
