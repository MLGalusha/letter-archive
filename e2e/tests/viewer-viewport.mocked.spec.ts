import { test, expect } from '@playwright/test';
import { openReader, closeReader } from './utils/reader-viewer-fixture';

test('@mocked fullscreen paints document edges and restores them on repeated close', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { opener, styles } = await openReader(page);
  const surface = page.locator('.viewer-backdrop');
  const color = await surface.evaluate(el => getComputedStyle(el).backgroundColor);
  for (let cycle = 0; cycle < 3; cycle++) {
    await expect(page.locator('html')).toHaveCSS('background-color', color);
    await expect(page.locator('body')).toHaveCSS('background-color', color);
    await expect(page.locator('html')).toHaveCSS('overflow', 'hidden');
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#f5ede1');
    for (const height of [620, 844]) {
      await page.setViewportSize({ width: 390, height });
      await expect.poll(() => surface.evaluate(el => {
        const rect = el.getBoundingClientRect();
        return Math.max(Math.abs(rect.top), Math.abs(rect.bottom - innerHeight));
      })).toBeLessThan(1);
      await expect(page.locator('.viewer-modal-header')).toHaveCount(0);
      const stageBox = (await page.locator('.viewer-container').boundingBox())!;
      expect(stageBox.y).toBe(0);
      expect(stageBox.height).toBe(height);
      const pages = await page.getByRole('dialog', { name: 'Original scans' }).locator('.viewer-page-drawer').boundingBox();
      expect(pages!.y + pages!.height).toBeLessThanOrEqual(height);
    }
    await closeReader(page);
    await expect(page.locator('body')).toHaveAttribute('style', styles);
    await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(245, 237, 225)');
    await expect(page.locator('html')).toHaveCSS('overflow', 'visible');
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#f5ede1');
    await expect(opener).toBeFocused();
    if (cycle < 2) {
      await opener.press('+');
      await expect(surface).toHaveAttribute('data-phase', 'focused');
    }
  }
});

test('@mocked fullscreen blocks chrome gestures while preserving drawer scrolling and prior styles', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { opener } = await openReader(page);
  await closeReader(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const original = await page.evaluate(() => {
    document.documentElement.style.setProperty('background-color', 'rgb(1, 2, 3)', 'important');
    document.documentElement.style.setProperty('overflow', 'clip');
    document.body.style.setProperty('background-color', 'rgb(4, 5, 6)', 'important');
    document.querySelector('meta[name="theme-color"]')!.setAttribute('content', '#010203');
    window.scrollTo(0, 160);
    return { root: document.documentElement.style.cssText, body: document.body.style.cssText };
  });
  await opener.focus();
  await opener.press('+');
  const gestures = await page.evaluate(() => {
    const dispatch = (selector: string, type: string) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      document.querySelector(selector)!.dispatchEvent(event);
      return event.defaultPrevented;
    };
    return {
      chromeTouch: dispatch('.reader-focus', 'touchmove'),
      chromeWheel: dispatch('.reader-focus', 'wheel'),
      drawerTouch: dispatch('.viewer-modal .viewer-page-drawer', 'touchmove'),
      drawerWheel: dispatch('.viewer-modal .viewer-page-drawer', 'wheel'),
    };
  });
  expect(gestures).toEqual({ chromeTouch: true, chromeWheel: true, drawerTouch: false, drawerWheel: false });
  await closeReader(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const restored = await page.evaluate(() => ({
    root: document.documentElement.style.cssText, body: document.body.style.cssText,
    theme: document.querySelector('meta[name="theme-color"]')!.getAttribute('content'), y: scrollY,
  }));
  expect(restored).toEqual({ ...original, theme: '#010203', y: 160 });
});
