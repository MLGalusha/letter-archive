import { expect, test } from '@playwright/test';
import { openReader, closeReader, mockReader, viewerImages } from './utils/reader-viewer-fixture';

for (const width of [390, 1440]) for (const reducedMotion of ['reduce', 'no-preference'] as const) {
  test(`@mocked one activation contract at ${width}px with ${reducedMotion}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion });
    await mockReader(page);
    await page.goto('/letter/current');
    const carousel = page.locator('.scan-carousel');
    await expect(carousel).toBeVisible();
    const before = await carousel.boundingBox();
    const calls = await carousel.evaluate(el => {
      const calls: string[] = []; const original = el.scrollTo.bind(el);
      el.scrollTo = ((options: ScrollToOptions) => { calls.push(options.behavior!); original(options); }) as typeof el.scrollTo;
      (window as any).readerScrollCalls = calls; return calls;
    });
    expect(calls).toEqual([]);
    await page.getByRole('button', { name: 'Go to scan 3: letter', exact: true }).click();
    await expect(page.locator('.scan-navigation [role="status"]')).toHaveText('3 / 3');
    expect(await page.evaluate(() => (window as any).readerScrollCalls)).toContain(reducedMotion === 'reduce' ? 'instant' : 'smooth');
    await expect.poll(() => carousel.evaluate(el => Math.abs(el.children[2].getBoundingClientRect().left + el.children[2].getBoundingClientRect().width / 2 - el.getBoundingClientRect().left - el.clientWidth / 2))).toBeLessThan(1);
    expect((await carousel.boundingBox())!.height).toBe(before!.height);
    await page.getByRole('button', { name: 'Open scan 3 full screen' }).click();
    const dialog = page.getByRole('dialog', { name: 'Original scans' });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('+');
    await expect(dialog.locator('.letter-viewer')).toHaveAttribute('data-zoom', '1.4');
    await dialog.getByRole('button', { name: 'Go to scan 1: letter', exact: true }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.letter-viewer')).toHaveAttribute('data-zoom', '1');
    await expect(dialog.locator('[aria-current="page"]')).toHaveAccessibleName('Go to scan 1: letter');
    await expect(page.locator('.reader-focus-flight, .reader-focus-return')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Close viewer' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.scan-navigation [role="status"]')).toHaveText('1 / 3');
    await expect(page.locator('body')).not.toHaveCSS('position', 'fixed');
  });
}

for (const width of [390, 1440]) test(`@mocked mixed scan proportions keep navigation stable at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const images = viewerImages.map((image, i) => ({ ...image, width: [600, 1800, 300][i], height: [800, 600, 1400][i] }));
  await mockReader(page, images); await page.goto('/letter/current');
  const stage = page.locator('.scan-carousel'); await expect(stage).toBeVisible();
  const height = (await stage.boundingBox())!.height;
  const stripY = (await page.locator('.scan-navigation').boundingBox())!.y;
  for (const index of [2, 1, 0]) {
    await page.locator('.viewer-page-choice').nth(index).click();
    await expect.poll(() => stage.evaluate((el, index) => Math.abs(el.children[index].getBoundingClientRect().left + el.children[index].getBoundingClientRect().width / 2 - el.getBoundingClientRect().left - el.clientWidth / 2), index)).toBeLessThan(1);
    expect((await stage.boundingBox())!.height).toBe(height);
    expect((await page.locator('.scan-navigation').boundingBox())!.y).toBe(stripY);
    const image = page.locator('.scan-slide-img').nth(index);
    await expect(image.locator('img').last()).toHaveJSProperty('complete', true);
    // DOM completion can precede the progressive image's decoded-ratio commit.
    await expect.poll(async () => {
      const box = (await image.boundingBox())!;
      return box.width / box.height;
    }).toBeCloseTo(images[index].width / images[index].height, 2);
  }
});

test('@mocked Back and Forward restore the selected fullscreen page without extra history entries', async ({ page }) => {
  await openReader(page);
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Go to scan 2: letter', exact: true }).click();
  await page.goBack(); await expect(dialog).toHaveCount(0);
  await page.goForward(); await expect(dialog).toBeVisible();
  await expect(dialog.locator('[aria-current="page"]')).toHaveAccessibleName('Go to scan 2: letter');
  await page.reload(); await expect(dialog).toBeVisible();
  await expect(dialog.locator('[aria-current="page"]')).toHaveAccessibleName('Go to scan 2: letter');
  await closeReader(page);
});

test('@mocked inline pinch continues across opening without selecting a different scan', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockReader(page); await page.goto('/letter/current');
  const scan = page.locator('.scan-slide').first(); await expect(scan).toBeVisible();
  const send = async (type: string, distance: number) => scan.evaluate((el, { type, distance }) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'touches', { value: distance ? [{clientX:195-distance/2,clientY:300},{clientX:195+distance/2,clientY:300}] : [] });
    el.dispatchEvent(event);
  }, { type, distance });
  await send('touchstart', 100); await send('touchmove', 140);
  await expect(page.getByRole('dialog')).toBeVisible();
  await send('touchmove', 200);
  await expect(page.locator('.letter-viewer')).toHaveAttribute('data-zoom', '2');
  const single = async (type: string, x: number, y: number) => scan.evaluate((el, point) => {
    const event = new Event(point.type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'touches', { value: [{ clientX: point.x, clientY: point.y }] });
    el.dispatchEvent(event);
  }, { type, x, y });
  await single('touchend', 295, 300);
  const beforePan = await page.locator('.viewer-image').evaluate(el => el.getBoundingClientRect().left);
  await single('touchmove', 265, 330);
  await expect.poll(() => page.locator('.viewer-image').evaluate(el => el.getBoundingClientRect().left)).toBeLessThan(beforePan - 10);
  await expect(page.locator('.letter-viewer')).toHaveAttribute('data-zoom', '2');
  await send('touchmove', 90); await send('touchend', 0);
  await expect(page.locator('.letter-viewer')).toHaveAttribute('data-zoom', '1');
  await expect(page.getByRole('dialog')).toBeVisible();
  await closeReader(page);
});

test('@mocked loading a sharper scan retains the decoded preview', async ({ page }) => {
  await openReader(page);
  await expect(page.locator('.viewer-image')).toHaveCSS('opacity', '1');
  await page.route('**/images/1.svg', async route => { await new Promise(resolve => setTimeout(resolve, 500)); await route.fallback(); });
  for (let i=0; i<6; i++) await page.keyboard.press('+');
  await expect(page.locator('.viewer-image-thumb')).toBeVisible();
  await expect(page.locator('.viewer-image-thumb')).toHaveJSProperty('complete', true);
  await expect(page.locator('.viewer-image')).toHaveCSS('opacity', '1');
  await closeReader(page);
});

for (const width of [390, 1440]) test(`@mocked shared scan and page strip animate in both directions at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await mockReader(page); await page.goto('/letter/current');
  test.skip(!await page.evaluate(() => Boolean(document.startViewTransition)), 'Native transition support is required for this capture check.');
  await expect(page.locator('.scan-slide-img').first().locator('img').last()).toHaveJSProperty('complete', true);
  await page.evaluate(() => {
    const results: { groups: string[]; finished: boolean; error?: string }[] = [];
    (window as unknown as { transitionResults: typeof results }).transitionResults = results;
    const start = document.startViewTransition.bind(document);
    document.startViewTransition = options => {
      const result = { groups: [] as string[], finished: false, error: undefined as string | undefined };
      results.push(result);
      const transition = start(options);
      transition.ready.then(() => {
        result.groups = document.getAnimations().map(animation => (animation.effect as KeyframeEffect | null)?.pseudoElement ?? '');
      }, error => { result.error = String(error); });
      transition.finished.then(() => { result.finished = true; });
      return transition;
    };
  });
  await page.getByRole('button', { name: 'Open scan 1 full screen', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { transitionResults: { finished: boolean }[] }).transitionResults[0]?.finished)).toBe(true);
  await page.keyboard.press('+');
  await expect(page.locator('.letter-viewer')).toHaveAttribute('data-zoom', '1.4');
  await closeReader(page);
  await expect.poll(() => page.evaluate(() => (window as unknown as { transitionResults: { finished: boolean }[] }).transitionResults[1]?.finished)).toBe(true);
  const results = await page.evaluate(() => (window as unknown as { transitionResults: { groups: string[]; error?: string }[] }).transitionResults);
  expect(results).toHaveLength(2);
  for (const result of results) {
    expect(result.error).toBeUndefined();
    expect(result.groups).toContain('::view-transition-group(reader-scan)');
    expect(result.groups).toContain('::view-transition-group(reader-pages)');
  }
});

for (const input of ['keyboard', 'wheel'] as const) test(`@mocked ${input} entry preserves its initial zoom`, async ({ page }) => {
  await mockReader(page); await page.goto('/letter/current');
  const scan = page.locator('.scan-slide').first();
  await expect(scan).toBeVisible();
  if (input === 'keyboard') {
    await scan.focus(); await page.keyboard.press('+');
  } else {
    await scan.dispatchEvent('wheel', { ctrlKey: true, deltaY: -40, bubbles: true, cancelable: true });
  }
  const viewer = page.locator('.letter-viewer');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect.poll(async () => Number(await viewer.getAttribute('data-zoom'))).toBeGreaterThan(1.3);
  await page.getByRole('dialog').getByRole('button', { name: 'Go to scan 2: letter', exact: true }).click();
  await expect(viewer).toHaveAttribute('data-zoom', '1');
  await closeReader(page);
});
