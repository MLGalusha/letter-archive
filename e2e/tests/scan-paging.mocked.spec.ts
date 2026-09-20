import { expect, test } from '@playwright/test';
import { API_BASE_URL } from './utils/test-helpers';
import { openReader, closeReader, mockReader } from './utils/reader-viewer-fixture';

for (const width of [1440, 1920]) for (const target of [0, 2]) {
  test(`@mocked thumbnails animate after dragging then clicking side scan ${target + 1} at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.clock.install();
    await mockReader(page);
    await page.goto('/letter/current');
    const carousel = page.locator('.scan-carousel');
    await expect(carousel).toBeVisible();
    const pitch = await carousel.evaluate(el => el.children[1].getBoundingClientRect().left - el.children[0].getBoundingClientRect().left);
    await page.mouse.move(width * .55, 400);
    await page.mouse.down();
    await page.mouse.move(width * .55 - pitch * .77, 400, { steps: 20 });
    await page.mouse.up();
    await expect(page.locator('.scan-navigation [role="status"]')).toHaveText('2 / 3');
    await expect.poll(() => carousel.evaluate(el => el.scrollLeft)).toBeCloseTo(pitch, 0);
    // Include the user's scrolled-down case and a click immediately after drag.
    if (target === 2) await page.evaluate(() => window.scrollTo({ top: 120, behavior: 'instant' }));
    const box = (await page.locator('.scan-slide-img').nth(target).boundingBox())!;
    const clickX = (Math.max(0, box.x) + Math.min(width, box.x + box.width)) / 2;
    // Drive the JS strip easing at fixed frame intervals: Linux WebKit can
    // stall rendering longer than the entire 180ms animation under CI load.
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
    await page.evaluate(() => {
      const carousel = document.querySelector('.scan-carousel')!;
      const strip = document.querySelector('.viewer-page-drawer--inline')!;
      const samples: { t: number; scan: number; strip: number }[] = [];
      (window as any).thumbnailMotionSamples = samples;
      const start = performance.now();
      const tick = () => {
        const t = performance.now() - start;
        samples.push({ t, scan: carousel.scrollLeft, strip: strip.scrollLeft });
        if (t < 1000) requestAnimationFrame(tick);
      };
      tick();
    });
    await page.mouse.click(clickX, 400);
    await page.clock.runFor(1100);
    await page.clock.resume();
    const samples = await page.evaluate(() => (window as any).thumbnailMotionSamples as { t: number; scan: number; strip: number }[]);
    const from = samples[0].strip, to = samples.at(-1)!.strip;
    expect(Math.abs(to - from)).toBeGreaterThan(20);
    const between = samples.filter(s => Math.abs(s.strip - from) > 1 && Math.abs(s.strip - to) > 1);
    expect(between.length).toBeGreaterThan(2);
    expect(between.some(s => Math.abs(s.scan - target * pitch) > 10)).toBe(true);
    // A single final 64px jump was the failure; normal easing has small steps.
    const largestStep = Math.max(...samples.slice(1).map((s, i) => Math.abs(s.strip - samples[i].strip)));
    expect(largestStep).toBeLessThan(Math.abs(to - from) * .75);
    await expect(page.locator('.scan-navigation [role="status"]')).toHaveText(`${target + 1} / 3`);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await page.evaluate(() => scrollY)).toBe(0);
  });
}

for (const width of [320, 390, 1440]) test(`@mocked 24 scan previews stay compact and direct selection arrives without traversing other pages at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  // Desktop animates thumbnail selection unless reduced motion is requested.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openReader(page, Array.from({ length: 24 }, (_, i) => ({
    id: `scan-${i}`, type: 'letter', pageNumber: i + 1, imageUrl: `/images/${i}.svg`, width: 600, height: 800,
  })));
  await closeReader(page);
  const nav = page.locator('.scan-navigation');
  await expect(nav.getByRole('status')).toHaveText('1 / 24');
  expect((await nav.boundingBox())!.height).toBeLessThanOrEqual(100);
  const drawer = page.getByRole('region', { name: 'Scan pages' });
  await expect(drawer.getByRole('button')).toHaveCount(24);
  // Page numbers occupy thumbnail notches; full accessible names remain.
  expect(await drawer.locator('button').evaluateAll(buttons => buttons.every((el, index) => el.textContent!.trim() === String(index + 1)))).toBe(true);
  expect(await drawer.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const results = await page.evaluate(async () => {
    const carousel = document.querySelector('.scan-carousel')!;
    const drawer = document.querySelector('.viewer-page-drawer--inline')!;
    const samples = [];
    for (const index of [23, 0, 12, 2, 23]) {
      (drawer.children[index] as HTMLElement).click();
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      const slide = carousel.children[index].getBoundingClientRect();
      const frame = carousel.getBoundingClientRect();
      samples.push({ index, centerError: Math.abs(slide.left + slide.width / 2 - frame.left - frame.width / 2),
        counter: document.querySelector('.scan-navigation [role="status"]')!.textContent });
    }
    return samples;
  });
  for (const result of results) {
    // WebKit rounds scroll offsets to whole CSS pixels.
    expect(result.centerError).toBeLessThanOrEqual(1);
    expect(result.counter).toBe(`${result.index + 1} / 24`);
  }
  await drawer.getByRole('button', { name: 'Go to scan 1: letter', exact: true }).evaluate(el => el.click());
  await expect(nav.getByRole('status')).toHaveText('1 / 24');
  await expect(drawer).toBeVisible();
});

for (const width of [1440, 1920]) test(`@mocked desktop thumbnail clicks animate the main scan without changing the chosen page at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openReader(page);
  await closeReader(page);
  const carousel = page.locator('.scan-carousel');
  await expect(carousel.locator('.progressive-image__full').first()).toHaveJSProperty('complete', true);
  const samples = await page.evaluate(async () => {
    const carousel = document.querySelector('.scan-carousel')!;
    const drawer = document.querySelector('.viewer-page-drawer--inline')!;
    const targetSlide = carousel.children[2].getBoundingClientRect();
    const frame = carousel.getBoundingClientRect();
    const target = carousel.scrollLeft + targetSlide.left + targetSlide.width / 2 - frame.left - frame.width / 2;
    // Observe the requested native behavior directly. CI compositor stalls can
    // consume the entire animation between two JS samples, even with rAF.
    const requests: (ScrollBehavior | undefined)[] = [];
    const scrollTo = carousel.scrollTo.bind(carousel);
    carousel.scrollTo = ((options: ScrollToOptions) => {
      requests.push(options.behavior); scrollTo(options);
    }) as typeof carousel.scrollTo;
    (drawer.children[2] as HTMLElement).click();
    const samples: { x: number; counter: string | null; outgoingLoaded: boolean }[] = [];
    const start = performance.now();
    do {
      await new Promise(requestAnimationFrame);
      const outgoing = carousel.children[0].querySelector<HTMLImageElement>('.progressive-image__full')!;
      samples.push({ x: carousel.scrollLeft, counter: document.querySelector('.scan-navigation [role="status"]')!.textContent,
        outgoingLoaded: !!outgoing.getAttribute('src') && outgoing.complete && outgoing.naturalWidth > 0 });
    } while (Math.abs(carousel.scrollLeft - target) > 0.1 && performance.now() - start < 2000);
    return { samples, target, requests };
  });
  expect(samples.requests).toContain('smooth');
  expect(samples.samples.length).toBeGreaterThan(0);
  expect(samples.samples.every(sample => sample.outgoingLoaded)).toBe(true);
  expect(samples.samples.slice(1).every(sample => sample.counter === '3 / 3')).toBe(true);
  expect(samples.samples.at(-1)!.x).toBeCloseTo(samples.target, 0);

  // Reverse an in-flight click without leaving a stale selection or snap target.
  await page.getByRole('button', { name: 'Go to scan 1: letter', exact: true }).evaluate(el => el.click());
  await expect.poll(() => carousel.evaluate(el => el.scrollLeft)).toBeLessThan(samples.target - 10);
  await page.getByRole('button', { name: 'Go to scan 3: letter', exact: true }).evaluate(el => el.click());
  await expect.poll(() => carousel.evaluate(el => el.scrollLeft)).toBeCloseTo(samples.target, 0);
  await expect(page.locator('.scan-navigation [role="status"]')).toHaveText('3 / 3');
});

for (const width of [390, 1440]) for (const reducedMotion of ['reduce', 'no-preference'] as const) {
  test(`@mocked scan thumbnail selection preserves document position at ${width}px (${reducedMotion})`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion });
    await page.route(`${API_BASE_URL}/**`, route => {
      const path = new URL(route.request().url()).pathname;
      if (path.startsWith('/images/')) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="tan"/></svg>' });
      if (path === '/settings/public') return route.fulfill({ json: {} });
      if (path.endsWith('/adjacent')) return route.fulfill({ json: null });
      if (path === '/letters/paging') return route.fulfill({ json: {
        id: 'paging', collectionCode: '001', metadata: { hook: 'A letter from home', description: 'A letter about the garden and the journey home. '.repeat(40), verified: true },
        images: [1, 2, 3].map(pageNumber => ({ id: `scan-${pageNumber}`, type: 'letter', pageNumber, imageUrl: `/images/${pageNumber}.svg`, width: 600, height: 800 })),
        transcript: { pages: [], fullText: 'A long letter. '.repeat(200), verified: true },
        status: 'published', visibility: 'PUBLISHED', transcriptPublished: true, metadataPublished: true,
        transcriptStatus: 'VERIFIED', metadataContentStatus: 'VERIFIED', extraContentStatus: 'EMPTY',
      } });
      return route.fulfill({ status: 404, json: {} });
    });
    await page.goto('/letter/paging');
      const dot = page.getByRole('button', { name: 'Go to scan 2: letter', exact: true });
    await expect(dot).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await dot.evaluate(el => window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - 260, behavior: 'instant' }));
    const y = await page.evaluate(() => window.scrollY);
    expect(y).toBeGreaterThan(0);
    await dot.click();
    await expect(dot).toHaveAttribute('aria-current', 'page');
    const carousel = page.locator('.scan-carousel');
    await expect.poll(() => carousel.evaluate(el => el.scrollLeft)).toBeGreaterThan(100);
    // Wait past native scrolling to detect any unwanted document animation too.
    await page.waitForTimeout(700);
    expect(await page.evaluate(() => window.scrollY)).toBeCloseTo(y, 0);
    await page.getByRole('button', { name: 'Go to scan 1: letter', exact: true }).click();
    await expect.poll(() => carousel.evaluate(el => el.scrollLeft)).toBeCloseTo(0, 0);
    expect(await page.evaluate(() => window.scrollY)).toBeCloseTo(y, 0);
  });
}

for (const mode of ['inline', 'fullscreen']) test(`@mocked centered ${mode} filmstrip selects settled scroll and centers endpoints after resize`, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openReader(page, Array.from({ length: 24 }, (_, i) => ({
    id: `scan-${i}`, type: 'letter', pageNumber: i + 1, imageUrl: `/images/${i}.svg`, width: 600, height: 800,
  })));
  if (mode === 'inline') await closeReader(page);
  // A fullscreen selection returns to the document strip.
  const strip = page.locator('.viewer-page-drawer:visible');
  const error = () => strip.evaluate(el => {
    const box = el.getBoundingClientRect(), selected = el.querySelector('[aria-current="page"]')!.getBoundingClientRect();
    return Math.abs(selected.left + selected.width / 2 - box.left - box.width / 2);
  });
  await expect.poll(error).toBeLessThan(1);
  const first = strip.getByRole('button').first();
  await first.focus(); await first.press('End');
  await expect(strip.getByRole('button').last()).toHaveAttribute('aria-current', 'page');
  await expect.poll(error).toBeLessThan(1);
  await page.setViewportSize({ width: 320, height: 700 });
  await expect.poll(error).toBeLessThan(1);
  await strip.getByRole('button').last().press('Home');
  await expect(first).toHaveAttribute('aria-current', 'page');
  await expect.poll(error).toBeLessThan(1);
  await strip.scrollIntoViewIfNeeded();
  await strip.hover(); await page.mouse.wheel(200, 0);
  await expect(first).not.toHaveAttribute('aria-current', 'page');
  await expect.poll(error).toBeLessThan(1);
  const selected = strip.locator('[aria-current="page"]');
  const notch = await selected.locator('.viewer-page-notch').boundingBox();
  const thumb = (await selected.boundingBox())!;
  expect(notch!.y + notch!.height).toBeLessThanOrEqual(thumb.y + thumb.height + 1);
  expect(notch!.y).toBeGreaterThan(thumb.y);
});

for (const mode of ['inline']) test(`@mocked ${mode} thumbnails track partial main-image progress before selection`, async ({ page, browserName }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  test.skip(mode === 'inline' && browserName !== 'chromium', 'Native held-touch progress uses CDP; fullscreen progress also runs in WebKit.');
  const cdp = mode === 'inline' ? await page.context().newCDPSession(page) : null;
  await cdp?.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
  await openReader(page);
  if (mode === 'inline') await closeReader(page);
  const strip = page.locator('.viewer-page-drawer:visible');
  if (mode === 'inline') {
    await expect(page.locator('.scan-carousel')).toBeVisible();
    await page.locator('.scan-carousel').scrollIntoViewIfNeeded();
    const box = (await page.locator('.scan-carousel').boundingBox())!;
    const y = box.y + Math.min(160, box.height / 2);
    await cdp!.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 290, y, id: 1 }] });
    for (const x of [270, 250, 230, 210, 190]) await cdp!.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 1 }] });
  }
  else await page.locator('.viewer-container').evaluate(stage => {
    for (const [type, x] of [['touchstart', 280], ['touchmove', 180]] as const) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'touches', { value: [{ clientX: x, clientY: 250 }] }); stage.dispatchEvent(event);
    }
  });
  await expect.poll(() => strip.evaluate(el => el.scrollLeft)).toBeGreaterThan(10);
  await expect(strip.getByRole('button').first()).toHaveAttribute('aria-current', 'page');
  const measured = await page.evaluate(mode => {
    const strip = document.querySelector(mode === 'inline' ? '.letter-scan-figure .viewer-page-drawer--inline' : '[role="dialog"] .viewer-page-drawer')!;
    const items = strip.querySelectorAll('button');
    const pitch = items[1].getBoundingClientRect().left - items[0].getBoundingClientRect().left;
    const stage = document.querySelector(mode === 'inline' ? '.scan-carousel' : '.viewer-container')!;
    const progress = mode === 'inline' ? stage.scrollLeft / stage.clientWidth : -new DOMMatrixReadOnly(getComputedStyle(stage.querySelector('.viewer-carriage')!).transform).m41 / stage.clientWidth;
    return { actual: strip.scrollLeft, expected: progress * pitch };
  }, mode);
  expect(Math.abs(measured.actual - measured.expected)).toBeLessThan(2);
  if (mode === 'fullscreen') {
    await page.locator('.viewer-container').evaluate(el => el.dispatchEvent(new Event('touchcancel', { bubbles: true })));
    await expect.poll(() => strip.evaluate(el => el.scrollLeft)).toBe(0);
    await expect(strip.getByRole('button').first()).toHaveAttribute('aria-current', 'page');
  }
});

for (const mode of ['inline']) test(`@mocked ${mode} thumbnail mouse settlement can be grabbed and reversed in a 24-page letter`, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openReader(page, Array.from({ length: 24 }, (_, i) => ({ id: `scan-${i}`, type: 'letter', pageNumber: i + 1, imageUrl: `/images/${i}.svg`, width: 600, height: 800 })));
  if (mode === 'inline') await closeReader(page);
  const strip = page.locator('.viewer-page-drawer:visible');
  await strip.scrollIntoViewIfNeeded();
  const box = (await strip.boundingBox())!, y = box.y + box.height / 2;
  await page.mouse.move(290, y); await page.mouse.down();
  await page.mouse.move(90, y, { steps: 8 }); await page.mouse.up();
  await page.mouse.move(200, y); await page.mouse.down();
  const grabbed = await strip.evaluate(el => el.scrollLeft);
  await page.waitForTimeout(200);
  expect(await strip.evaluate(el => el.scrollLeft)).toBeCloseTo(grabbed, 0);
  await page.mouse.move(280, y, { steps: 8 });
  expect(await strip.evaluate(el => el.scrollLeft)).toBeLessThan(grabbed - 50);
  await page.waitForTimeout(100); await page.mouse.up();
  await expect.poll(() => strip.evaluate(el => {
    const selected = el.querySelector('[aria-current="page"]')!.getBoundingClientRect(), box = el.getBoundingClientRect();
    return Math.abs(selected.left + selected.width / 2 - box.left - box.width / 2);
  })).toBeLessThan(1);
  const settled = await strip.evaluate(el => el.scrollLeft);
  await page.waitForTimeout(300);
  expect(await strip.evaluate(el => el.scrollLeft)).toBeCloseTo(settled, 0);
});

for (const deltaX of [0, -150]) test(`@mocked wheel without strip movement leaves keyboard thumbnail paging available (${deltaX})`, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openReader(page);
  const strip = page.locator('.viewer-page-drawer:visible');
  await strip.hover();
  await page.mouse.wheel(deltaX, deltaX ? 0 : 150);
  await strip.getByRole('button', { name: 'Go to scan 1: letter', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(strip.getByRole('button').nth(1)).toHaveAttribute('aria-current', 'page');
  await expect.poll(() => strip.evaluate(el => {
    const box = el.getBoundingClientRect(), selected = el.querySelector('[aria-current="page"]')!.getBoundingClientRect();
    return Math.abs(selected.left + selected.width / 2 - box.left - box.width / 2);
  })).toBeLessThan(1);
});

test('@mocked diagonal trackpad movement selects the centered thumbnail', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openReader(page);
  const strip = page.locator('.viewer-page-drawer:visible');
  await strip.hover(); await page.mouse.wheel(96, 150);
  await expect.poll(() => strip.evaluate(el => el.scrollLeft)).toBeGreaterThan(32);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(strip.getByRole('button').first()).not.toHaveAttribute('aria-current', 'page');
  await expect.poll(() => strip.evaluate(el => {
    const box = el.getBoundingClientRect(), active = el.querySelector('[aria-current="page"]')!.getBoundingClientRect();
    return Math.abs(active.left + active.width / 2 - box.left - box.width / 2);
  })).toBeLessThan(1);
});

for (const mode of ['inline', 'fullscreen']) test(`@mocked ${mode} thumbnail native touch accepts diagonal starts`, async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Native touch injection requires CDP; physical Safari remains a device check.');
  await page.setViewportSize({ width: 390, height: 844 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
  await openReader(page, Array.from({ length: 12 }, (_, i) => ({ id: `scan-${i}`, type: 'letter', pageNumber: i + 1, imageUrl: `/images/${i}.svg`, width: 600, height: 800 })));
  if (mode === 'inline') await closeReader(page);
  const strip = page.locator('.viewer-page-drawer:visible');
  await strip.scrollIntoViewIfNeeded();
  const box = (await strip.boundingBox())!, x = box.x + box.width / 2;
  let y = box.y + box.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  for (const [dx, dy] of [[-6, 6], [-20, 8], [-40, 8], [-60, 8], [-80, 8], [-100, 8]]) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx, y: y + dy, id: 1 }] });
    await page.waitForTimeout(25);
  }
  expect(await strip.evaluate(el => el.scrollLeft)).toBeGreaterThan(60);
  await expect(strip.getByRole('button').first()).toHaveAttribute('aria-current', 'page');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => strip.evaluate(el => {
    const selected = el.querySelector('[aria-current="page"]')!.getBoundingClientRect(), box = el.getBoundingClientRect();
    return Math.abs(selected.left + selected.width / 2 - box.left - box.width / 2);
  })).toBeLessThan(1);
  await expect(strip.getByRole('button').first()).not.toHaveAttribute('aria-current', 'page');
  if (mode === 'fullscreen') await expect(page.getByRole('dialog')).toHaveCount(0);
  await strip.scrollIntoViewIfNeeded();
  const returned = (await strip.boundingBox())!;
  y = returned.y + returned.height / 2;
  // A fresh native flick can be grabbed and reversed without our code moving it
  // while the second finger contact is held.
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 290, y, id: 1 }] });
  for (const nextX of [250, 210, 170, 130]) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: nextX, y, id: 1 }] });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 180, y, id: 1 }] });
  // Establish a new drag: browser-owned snap/momentum can continue until the
  // next contact crosses native touch slop. A touchStart alone is not a drag.
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200, y, id: 1 }] });
  await page.waitForTimeout(50);
  const grabbed = await strip.evaluate(el => el.scrollLeft);
  await page.waitForTimeout(220);
  expect(await strip.evaluate(el => el.scrollLeft)).toBeCloseTo(grabbed, 0);
  for (const nextX of [220, 240, 260, 280, 300]) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: nextX, y, id: 1 }] });
    await page.waitForTimeout(25);
  }
  expect(await strip.evaluate(el => el.scrollLeft)).toBeLessThan(grabbed - 60);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => strip.evaluate(el => {
    const selected = el.querySelector('[aria-current="page"]')!.getBoundingClientRect(), box = el.getBoundingClientRect();
    return Math.abs(selected.left + selected.width / 2 - box.left - box.width / 2);
  })).toBeLessThan(1);
});

for (const mode of ['inline']) test(`@mocked ${mode} thumbnail tap animates intermediate positions`, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const now = new Date('2026-09-18T12:00:00Z');
  await page.clock.install({ time: now });
  await openReader(page);
  if (mode === 'inline') await closeReader(page);
  const strip = page.locator('.viewer-page-drawer:visible');
  await page.evaluate(() => document.fonts.ready);
  await page.clock.pauseAt(new Date(now.getTime() + 60_000));
  await strip.getByRole('button').nth(1).evaluate(el => el.click());
  await expect(strip.getByRole('button').nth(1)).toHaveAttribute('aria-current', 'page');
  const samples: number[] = [];
  // Check intermediate positions at controlled times, not a runner-dependent
  // number of frames captured inside a180ms wall-clock window.
  for (let i = 0; i < 4; i++) {
    await page.clock.runFor(32);
    samples.push(await strip.evaluate(el => el.scrollLeft));
  }
  expect(samples.every(x => x > 1 && x < 64)).toBe(true);
  expect(samples.every((x, i) => i === 0 || x > samples[i - 1])).toBe(true);
  await page.clock.runFor(200);
  expect(await strip.evaluate(el => el.scrollLeft)).toBeCloseTo(64, 0);
});

for (const mode of ['inline']) for (const gesture of ['hold', 'vertical']) test(`@mocked ${mode} holding a thumbnail animation does not change selection (${gesture})`, async ({ page }) => {
  const now = new Date('2026-09-18T12:00:00Z');
  await page.clock.install({ time: now });
  await page.setViewportSize({ width: 390, height: 844 });
  await openReader(page);
  if (mode === 'inline') await closeReader(page);
  const strip = page.locator('.viewer-page-drawer:visible');
  await page.clock.pauseAt(new Date(now.getTime() + 60_000));
  await strip.getByRole('button').nth(2).evaluate(el => el.click());
  await expect(strip.getByRole('button').nth(2)).toHaveAttribute('aria-current', 'page');
  await page.clock.runFor(16);
  expect(await strip.evaluate(el => el.scrollLeft)).toBeLessThan(64);
  await strip.evaluate(el => {
    const event = new Event('touchstart', { bubbles: true });
    Object.defineProperty(event, 'touches', { value: [{ clientX: 195, clientY: 700 }] });
    el.dispatchEvent(event);
  });
  if (gesture === 'vertical') await strip.evaluate(el => {
    const event = new Event('touchmove', { bubbles: true });
    Object.defineProperty(event, 'touches', { value: [{ clientX: 198, clientY: 760 }] }); el.dispatchEvent(event);
  });
  await page.clock.runFor(300);
  await strip.evaluate(el => {
    const event = new Event('touchend', { bubbles: true });
    Object.defineProperty(event, 'touches', { value: [] }); el.dispatchEvent(event);
  });
  await page.clock.runFor(500);
  await expect(strip.getByRole('button').nth(2)).toHaveAttribute('aria-current', 'page');
  expect(await strip.evaluate(el => el.scrollLeft)).toBeCloseTo(128, 0);
});
