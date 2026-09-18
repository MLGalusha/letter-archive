import { test, expect } from '@playwright/test';
import { openReader } from './utils/reader-viewer-fixture';

test('@mocked fullscreen paints document edges and restores them on repeated close', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { opener, styles } = await openReader(page);
  const surface = page.locator('.viewer-backdrop');
  const color = await surface.evaluate(el => getComputedStyle(el).backgroundColor);
  for (let cycle = 0; cycle < 3; cycle++) {
    await expect(page.locator('html')).toHaveCSS('background-color', color);
    await expect(page.locator('body')).toHaveCSS('background-color', color);
    await expect(page.locator('html')).toHaveCSS('overflow', 'hidden');
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', color);
    for (const height of [620, 844]) {
      await page.setViewportSize({ width: 390, height });
      await expect.poll(() => surface.evaluate(el => {
        const rect = el.getBoundingClientRect();
        return Math.max(Math.abs(rect.top), Math.abs(rect.bottom - innerHeight));
      })).toBeLessThan(1);
      const close = await page.getByRole('button', { name: 'Close viewer' }).boundingBox();
      const pages = await page.getByRole('button', { name: 'Pages', exact: true }).boundingBox();
      expect(close!.y).toBeGreaterThanOrEqual(0);
      expect(pages!.y + pages!.height).toBeLessThanOrEqual(height);
    }
    await page.getByRole('button', { name: 'Close viewer' }).click();
    await expect(page.locator('body')).toHaveAttribute('style', styles);
    await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(245, 237, 225)');
    await expect(page.locator('html')).toHaveCSS('overflow', 'visible');
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#f5ede1');
    await expect(opener).toBeFocused();
    if (cycle < 2) await opener.press('Enter');
  }
});

test('@mocked fullscreen blocks chrome gestures while preserving drawer scrolling and prior styles', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { opener } = await openReader(page);
  await page.getByRole('button', { name: 'Close viewer' }).click();
  const original = await page.evaluate(() => {
    document.documentElement.style.setProperty('background-color', 'rgb(1, 2, 3)', 'important');
    document.documentElement.style.setProperty('overflow', 'clip');
    document.body.style.setProperty('background-color', 'rgb(4, 5, 6)', 'important');
    document.querySelector('meta[name="theme-color"]')!.setAttribute('content', '#010203');
    window.scrollTo(0, 160);
    return { root: document.documentElement.style.cssText, body: document.body.style.cssText };
  });
  await opener.focus();
  await opener.press('Enter');
  await page.getByRole('button', { name: 'Pages', exact: true }).click();
  const gestures = await page.evaluate(() => {
    const dispatch = (selector: string, type: string) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      document.querySelector(selector)!.dispatchEvent(event);
      return event.defaultPrevented;
    };
    return {
      chromeTouch: dispatch('.viewer-modal-header', 'touchmove'),
      chromeWheel: dispatch('.viewer-toolbar', 'wheel'),
      drawerTouch: dispatch('.viewer-page-drawer', 'touchmove'),
      drawerWheel: dispatch('.viewer-page-drawer', 'wheel'),
    };
  });
  expect(gestures).toEqual({ chromeTouch: true, chromeWheel: true, drawerTouch: false, drawerWheel: false });
  await page.getByRole('button', { name: 'Close viewer' }).click();
  const restored = await page.evaluate(() => ({
    root: document.documentElement.style.cssText, body: document.body.style.cssText,
    theme: document.querySelector('meta[name="theme-color"]')!.getAttribute('content'), y: scrollY,
  }));
  expect(restored).toEqual({ ...original, theme: '#010203', y: 160 });
});
