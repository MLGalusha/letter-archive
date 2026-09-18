import { expect, test } from '@playwright/test';
import { openReader } from './utils/reader-viewer-fixture';

test('@mocked releasing a paused swipe starts gently and reaches the next page continuously', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openReader(page);
  await expect(page.locator('.viewer-image')).toHaveCSS('opacity', '1');
  // Observe the rendered drag before measuring release: a fixed delay can end
  // before React's animation-frame update on a loaded CI worker.
  await page.locator('.viewer-container').evaluate(stage => {
    for (const [type, x] of [['touchstart', 300], ['touchmove', 180]] as const) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'touches', { value: [{ clientX: x, clientY: 250 }] });
      stage.dispatchEvent(event);
    }
  });
  await expect(page.locator('.viewer-carriage')).toHaveCSS('transform', 'matrix(1, 0, 0, 1, -120, 0)');
  const measured = await page.evaluate(async () => {
    const stage = document.querySelector('.viewer-container')!;
    const carriage = document.querySelector('.viewer-carriage')!;
    const touch = (type: string, x?: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'touches', { value: x === undefined ? [] : [{ clientX: x, clientY: 250 }] });
      stage.dispatchEvent(event);
    };
    const read = () => new DOMMatrixReadOnly(getComputedStyle(carriage).transform).m41;
    await new Promise(resolve => setTimeout(resolve, 120)); // Release from rest, not a flick.
    const start = read();
    const animationReady = new Promise<Animation>(resolve => {
      carriage.addEventListener('transitionrun', () => {
        const animation = carriage.getAnimations()[0];
        animation.pause(); resolve(animation);
      }, { once: true });
    });
    touch('touchend');
    const animation = await animationReady;
    await animation.ready;
    animation.currentTime = 16;
    const firstFrame = read();
    animation.currentTime = Number(animation.effect!.getTiming().duration) - 0.1;
    const end = read();
    animation.play();
    return { start, firstFrame, end, width: stage.clientWidth };
  });
  console.log('Paused release measured CSS pixels:', JSON.stringify(measured));
  expect(measured.start).toBeCloseTo(-120, 0);
  expect(Math.abs(measured.firstFrame - measured.start)).toBeLessThan(12);
  expect(measured.firstFrame).toBeLessThan(measured.start);
  expect(measured.end).toBeCloseTo(-measured.width, 0);
  await expect(page.locator('.viewer-page-counter')).toHaveText('2 / 3');
  await expect(page.locator('.viewer-carriage')).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
});

test.describe('touch toolbar', () => {
  test.use({ hasTouch: true, deviceScaleFactor: 3 });
  test('@mocked native thumbnail drag waits for finger release before selecting', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Trusted touch dispatch uses CDP; physical iPhone acceptance is separate.');
    await page.setViewportSize({ width: 390, height: 844 });
    await openReader(page);
    const strip = page.getByRole('dialog').locator('.viewer-page-drawer');
    const box = (await strip.boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    const y = box.y + box.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 250, y, id: 1 }] });
    for (const x of [220, 190, 160, 130]) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 1 }] });
    await page.waitForTimeout(220);
    await expect(page.locator('.viewer-page-counter')).toHaveText('1 / 3');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page.locator('.viewer-page-counter')).not.toHaveText('1 / 3');
    await expect.poll(() => strip.evaluate(el => {
      const box = el.getBoundingClientRect(), selected = el.querySelector('[aria-current="page"]')!.getBoundingClientRect();
      return Math.abs(selected.left + selected.width / 2 - box.left - box.width / 2);
    })).toBeLessThan(1);
  });
  test('@mocked a native pinch survives both image rendition replacements', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Trusted multi-touch dispatch uses CDP; not physical iOS validation.');
    await page.setViewportSize({ width: 390, height: 844 });
    await openReader(page);
    await expect(page.locator('.viewer-image')).toHaveCSS('opacity', '1');
    const image = page.locator('.viewer-image');
    await expect(image).toHaveAttribute('src', /w=1200/);
    const box = (await image.boundingBox())!;
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    const points = (distance: number) => [
      { x: x - distance / 2, y, id: 1 }, { x: x + distance / 2, y, id: 2 },
    ];
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(100) });
    for (const distance of [110, 120, 140, 150, 170, 200]) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(distance) });
      await expect(page.locator('.viewer-mobile-zoom')).toHaveText(`${distance}%`);
      if (distance === 120) await expect(image).toHaveAttribute('src', /w=1600/);
      if (distance === 150) await expect(image).not.toHaveAttribute('src', /[?&]w=/);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page.locator('.viewer-page-counter')).toHaveText('1 / 3');
    await page.getByRole('dialog').getByRole('button', { name: 'Go to scan 2: letter' }).tap();
    await expect(page.locator('.viewer-mobile-zoom')).toHaveText('100%');
  });
  for (const width of [320, 390, 844]) test(`@mocked phone controls share one row at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 844 ? 390 : 844 });
    await openReader(page);
    const toolbar = page.locator('.viewer-toolbar');
    for (const name of ['Zoom in', 'Zoom out', 'Fit scan']) {
      await expect(toolbar.getByRole('button', { name, includeHidden: true })).toBeHidden();
    }
    await expect(page.locator('.viewer-mobile-zoom')).toHaveText('100%');
    await expect(page.locator('.viewer-mobile-zoom')).toBeVisible();
    await expect(page.locator('.viewer-zoom-controls')).toBeHidden();
    const strip = page.getByRole('dialog').locator('.viewer-page-drawer');
    const geometry = await strip.boundingBox();
    expect(geometry!.height).toBeLessThanOrEqual(90);
    expect(geometry!.y + geometry!.height).toBeLessThanOrEqual(width === 844 ? 390 : 844);
    await expect(toolbar).toBeHidden();
    await strip.getByRole('button', { name: 'Go to scan 2: letter' }).tap();
    await expect(page.locator('.viewer-page-counter')).toHaveText('2 / 3');
    await strip.getByRole('button', { name: 'Go to scan 3: letter' }).tap();
    await expect(page.locator('.viewer-page-counter')).toHaveText('3 / 3');
  });
});

test('@mocked a narrow mouse layout keeps explicit zoom controls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openReader(page);
  for (const name of ['Zoom in', 'Zoom out', 'Fit scan']) await expect(page.getByRole('button', { name })).toBeVisible();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(page.locator('.viewer-zoom-badge')).toHaveText('140%');
  await page.getByRole('button', { name: 'Fit scan' }).click();
  await expect(page.locator('.viewer-zoom-badge')).toHaveText('100%');
});

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
  expect(boxes.drawer.top).toBeGreaterThanOrEqual(boxes.stage.bottom);
  for (const box of boxes.controls) {
    expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.right).toBeLessThanOrEqual(width);
  }
  await choice.focus(); await choice.press('Home');
  await expect(dialog.getByRole('button', { name: 'Go to scan 1: letter' })).toBeFocused();
});

test('@mocked viewport resizing re-clamps an edge pan after the scan refits', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await openReader(page);
  await expect(page.locator('.viewer-image')).toHaveCSS('opacity', '1');
  const stage = page.locator('.viewer-container');
  await stage.dblclick();
  await expect.poll(() => page.locator('.viewer-transform').evaluate(el => new DOMMatrixReadOnly(getComputedStyle(el).transform).a)).toBe(2.5);
  const box = (await stage.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2);
  await page.mouse.up();
  const beforeWidth = (await page.locator('.viewer-transform').boundingBox())!.width;
  await page.setViewportSize({ width: 390, height: 450 });
  await expect.poll(async () => (await page.locator('.viewer-transform').boundingBox())!.width).toBeLessThan(beforeWidth - 50);
  await expect.poll(() => page.evaluate(() => {
    const scan = document.querySelector('.viewer-transform')!.getBoundingClientRect();
    const stage = document.querySelector('.viewer-container')!.getBoundingClientRect();
    return Math.max(scan.left - stage.left, stage.right - scan.right);
  })).toBeLessThanOrEqual(1);
});

test('@mocked always-visible strip loads only nearby thumbnails', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const requested = new Set<string>();
  page.on('request', request => { if (new URL(request.url()).searchParams.get('w') === '200') requested.add(request.url()); });
  await openReader(page, Array.from({ length: 32 }, (_, i) => ({ id: `scan-${i + 1}`, type: 'letter', pageNumber: i + 1,
    imageUrl: `/images/${i + 1}.svg`, width: 600, height: 800 })));
  const drawer = page.getByRole('dialog').getByRole('region', { name: 'Scan pages' });
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
  const now = new Date();
  await page.clock.install({ time: now });
  await openReader(page);
  await expect(page.locator('.viewer-image')).toHaveCSS('opacity', '1');
  // Playwright controls JS timers, not the compositor's CSS clock. Hold the
  // real transition open beyond this test's deadline, then seek its midpoint.
  // This is a controlled timeline; application timing and assertions are unchanged.
  await page.addStyleTag({ content: '.viewer-transform.animating { transition-duration: 60s !important; }' });
  await page.clock.pauseAt(new Date(now.getTime() + 60_000));
  await page.evaluate(() => {
    const surface = document.querySelector('.viewer-transform')!;
    (window as typeof window & { zoomPaused: Promise<void> }).zoomPaused = new Promise<void>((resolve, reject) => {
      const capture = (event: TransitionEvent) => {
        if (event.target !== surface || event.propertyName !== 'transform') return;
        surface.removeEventListener('transitionrun', capture);
        const animation = surface.getAnimations().find(animation =>
          (animation as CSSTransition).transitionProperty === 'transform');
        if (!animation) { reject(new Error('Transform transition is missing')); return; }
        animation.pause();
        animation.currentTime = Number(animation.effect!.getTiming().duration) / 2;
        resolve();
      };
      surface.addEventListener('transitionrun', capture);
    });
    // Establish the initial computed style before starting a CSS transition.
    surface.getBoundingClientRect();
    document.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')!.click();
  });
  // React may schedule the programmatic click's commit with a zero-delay task.
  // Advance it while keeping the 150ms application cleanup timer pending.
  await page.clock.runFor(32);
  const values = await page.evaluate(async () => {
    await (window as typeof window & { zoomPaused: Promise<void> }).zoomPaused;
    const surface = document.querySelector('.viewer-transform')!;
    const before = new DOMMatrixReadOnly(getComputedStyle(surface).transform).a;
    const event = new Event('touchstart', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'touches', { value: [{ clientX: 260, clientY: 250 }] });
    document.querySelector('.viewer-container')!.dispatchEvent(event);
    return { before, target: 1.4 };
  });
  expect(values.before).toBeGreaterThan(1);
  expect(values.before).toBeLessThan(values.target);
  await page.clock.runFor(32);
  await expect(page.locator('.viewer-transform')).not.toHaveClass(/animating/);
  await expect.poll(() => page.locator('.viewer-transform').evaluate(el =>
    new DOMMatrixReadOnly(getComputedStyle(el).transform).a)).toBeCloseTo(values.before, 3);
});

test('@mocked reduced motion removes zoom interpolation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await openReader(page);
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(page.locator('.viewer-transform')).toHaveCSS('transition-duration', '0s');
  await expect(page.locator('.viewer-image')).toHaveCSS('transition-duration', '0s');
  await page.getByRole('dialog').getByRole('button', { name: 'Go to scan 2: letter' }).click();
  await expect(page.locator('.viewer-page-counter')).toHaveText('2 / 3');
  await expect(page.locator('.viewer-zoom-badge')).toHaveText('100%');
});
