import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';

// A browser-only fixture imports the production component through Vite. No test
// route or test controls are included in the shipped application.
async function mountFixture(page: Page) {
  await page.route('**/__progressive-fixture', (route) => route.fulfill({
    contentType: 'text/html', body: `<div id="fixture"></div><script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => (type) => type;
      window.__vite_plugin_react_preamble_installed__ = true;
      const { default: React } = await import('/node_modules/.vite/deps/react.js');
      const { default: { createRoot } } = await import('/node_modules/.vite/deps/react-dom_client.js');
      const { ProgressiveImage } = await import('/src/components/common/ProgressiveImage.tsx');
      const root = createRoot(document.getElementById('fixture'));
      window.renderImage = (props) => root.render((Array.isArray(props) ? props : [props]).filter(Boolean).map((entry) =>
        React.createElement(ProgressiveImage, {
          key: entry.alt || 'fixture', alt: 'Fixture scan', aspectRatio: 0.75, style: { width: 200 }, ...entry,
        })));
    </script>`,
  }));
  await page.goto('/__progressive-fixture');
  await page.waitForFunction(() => typeof (window as any).renderImage === 'function');
}
async function render(page: Page, id: string, options = {}) {
  await page.evaluate(({ id, options }) => (window as any).renderImage({
    src: `/fixture-images/${id}-full`, thumbSrc: `/fixture-images/${id}-thumb`, ...options,
  }), { id, options });
}

for (const mode of ['delay', 'idle'] as const) {
  test(`@mocked progressive ${mode} scheduling controls actual requests and replacement`, async ({ page }) => {
    const requested: string[] = [];
    await page.addInitScript(() => {
      const callbacks = new Map<number, IdleRequestCallback>();
      let sequence = 0;
      window.requestIdleCallback = (callback) => { callbacks.set(++sequence, callback); return sequence; };
      window.cancelIdleCallback = (id) => { callbacks.delete(id); };
      (window as any).pendingIdle = () => callbacks.size;
      (window as any).releaseIdle = () => { for (const cb of callbacks.values()) cb({ didTimeout: false, timeRemaining: () => 50 }); callbacks.clear(); };
      const NativeImage = window.Image;
      (window as any).imagePriorities = [];
      window.Image = class extends NativeImage {
        set src(value: string) { (window as any).imagePriorities.push({ value, priority: this.fetchPriority }); super.src = value; }
      };
    });
    await page.route('**/fixture-images/**', async (route) => {
      requested.push(new URL(route.request().url()).pathname);
      await route.fulfill({ contentType: 'image/png', path: join(__dirname, 'fixtures/archive-preview-480x640.png') });
    });
    await mountFixture(page);
    const options = mode === 'delay' ? { fullDelay: 1200 } : { idleUpgrade: true, midSrc: '/fixture-images/mid' };
    for (const id of ['first', 'replacement']) {
      await render(page, id, { ...options, fetchPriority: 'high' });
      await expect(page.locator('.progressive-image__thumb')).toBeVisible();
      await page.waitForTimeout(300);
      expect(requested).not.toContain(`/fixture-images/${id}-full`);
      await expect(page.getByAltText('Fixture scan')).not.toHaveAttribute('src');
      if (mode === 'idle') await page.evaluate(() => (window as any).releaseIdle());
      await expect(page.getByAltText('Fixture scan')).toHaveAttribute('src', `/fixture-images/${id}-full`);
      await expect.poll(() => page.getByAltText('Fixture scan').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(480);
      expect(await page.evaluate((id) => (window as any).imagePriorities.find((row: any) => row.value === `/fixture-images/${id}-full`).priority, id)).toBe('high');
    }
    await render(page, 'abandoned', options);
    await expect(page.locator('.progressive-image__thumb')).toBeVisible();
    await page.evaluate(() => (window as any).renderImage(null));
    await expect(page.getByAltText('Fixture scan')).toHaveCount(0);
    // React commits render(null) asynchronously; wait for its effect cleanup
    // before releasing the test-owned idle queue.
    if (mode === 'idle') await expect.poll(() => page.evaluate(() => (window as any).pendingIdle())).toBe(0);
    if (mode === 'idle') await page.evaluate(() => (window as any).releaseIdle());
    await page.waitForTimeout(1300);
    expect(requested).not.toContain('/fixture-images/abandoned-full');
  });
}

test('@mocked progressive retries recover and retain a useful preview on exhausted full failure', async ({ page }) => {
  const counts = new Map<string, number>();
  await page.route('**/fixture-images/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const attempt = (counts.get(path) ?? 0) + 1;
    counts.set(path, attempt);
    if (path.includes('all-failed') || (path.endsWith('full') && (path.includes('failed') || attempt === 1))) {
      await route.fulfill({ status: 503, body: 'Try again' });
    } else {
      await route.fulfill({ contentType: 'image/png', path: join(__dirname, 'fixtures/archive-preview-480x640.png') });
    }
  });
  await mountFixture(page);
  await render(page, 'recover');
  await expect(page.getByAltText('Fixture scan')).toHaveAttribute('src', '/fixture-images/recover-full');
  await expect.poll(() => page.getByAltText('Fixture scan').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(480);
  await render(page, 'failed');
  await expect.poll(() => counts.get('/fixture-images/failed-full')).toBe(3);
  await page.waitForTimeout(300);
  await expect(page.locator('.progressive-image__thumb')).toBeVisible();
  await expect(page.getByText('Image unavailable')).toHaveCount(0);
  await expect(page.getByAltText('Fixture scan')).not.toHaveAttribute('src');
  await render(page, 'all-failed');
  await expect(page.getByText('Image unavailable')).toBeVisible({ timeout: 6000 });
  expect(counts.get('/fixture-images/all-failed-full')).toBe(3);
});


test('@mocked releasing one pending image preserves another consumer of the same URL', async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let fullStarted = false;
  await page.route('**/fixture-images/**', async (route) => {
    if (route.request().url().endsWith('full')) { fullStarted = true; await held; }
    await route.fulfill({ contentType: 'image/png', path: join(__dirname, 'fixtures/archive-preview-480x640.png') });
  });
  await mountFixture(page);
  await page.evaluate(() => (window as any).renderImage(['first', 'second'].map((alt) => ({
    alt, src: '/fixture-images/shared-full', thumbSrc: '/fixture-images/shared-thumb',
  }))));
  await expect(page.locator('.progressive-image__thumb')).toHaveCount(2);
  await expect.poll(() => fullStarted).toBe(true);
  await page.evaluate(() => (window as any).renderImage([{
    alt: 'second', src: '/fixture-images/shared-full', thumbSrc: '/fixture-images/shared-thumb',
  }]));
  await expect(page.getByAltText('first')).toHaveCount(0);
  release();
  await expect.poll(() => page.getByAltText('second').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(480);
});
