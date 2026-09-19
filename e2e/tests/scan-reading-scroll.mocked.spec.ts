import { expect, test } from '@playwright/test';
import { openReader, closeReader } from './utils/reader-viewer-fixture';

// Chromium runs this in Linux CI; native WebKit wheel coverage runs on macOS.
// The bundled Linux WebKit blocks wheels on even a bare document with root
// overscroll-behavior:none. See docs/qa/reader-page-picker.md for the isolation.
for (const width of [320, 390, 1440]) test(`@mocked vertical reading scroll passes through inline thumbnails at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await openReader(page, Array.from({ length: 24 }, (_, i) => ({
    id: `scan-${i}`, type: 'letter', pageNumber: i + 1, imageUrl: `/images/${i}.svg`, width: 600, height: 800,
  })));
  await closeReader(page);
  await page.getByRole('region', { name: 'Scan pages' }).hover();
  const before = await page.evaluate(() => scrollY);
  await page.mouse.wheel(0, 300);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(before + 150);
});
