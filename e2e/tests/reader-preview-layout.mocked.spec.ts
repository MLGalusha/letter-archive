import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { API_BASE_URL } from './utils/test-helpers';

const facets = { formats: [], collections: [], correspondents: [], places: [], years: [], topics: [], tones: [], relationships: [] };

for (const viewport of [{ name: 'phone', width: 390, height: 844, deviceScaleFactor: 3 }, { name: 'desktop', width: 1440, height: 1000, deviceScaleFactor: 2 }]) {
  for (const scenario of ['card handoff', 'direct entry', 'failed full image', 'landscape handoff'] as const) {
    test(`@mocked real reader reserves visible preview space: ${viewport.name}, ${scenario}`, async ({ browser }, testInfo) => {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: viewport.deviceScaleFactor, isMobile: viewport.name === 'phone', hasTouch: viewport.name === 'phone' });
      const page = await context.newPage();
      const landscape = scenario === 'landscape handoff';
      const imageWidth = landscape ? 960 : 480;
      const imageHeight = 640;
      const imageUrl = '/images/preview-layout-scan?v=one';
      const letterId = 'preview-layout-letter';
      const collection = { id: 'collection-003', collectionCode: '003', title: 'Preview geometry', letterCount: 1, letters: [] };
      const letter = { id: letterId, collectionCode: '003', metadata: { hook: 'A visible reader preview', verified: true },
        images: [{ id: 'preview-layout-scan', type: 'letter', pageNumber: 1, imageUrl, width: landscape ? imageHeight : imageWidth, height: landscape ? imageWidth : imageHeight }],
        transcript: { pages: [{ pageNumber: 1, text: 'A transcript below the original scan.' }], fullText: 'A transcript below the original scan.', verified: true },
        readingText: 'A transcript below the original scan.', status: 'published', visibility: 'PUBLISHED', transcriptPublished: true, metadataPublished: true,
        transcriptStatus: 'VERIFIED', metadataContentStatus: 'VERIFIED', extraContentStatus: 'EMPTY' };
      let release!: () => void;
      const held = new Promise<void>(resolve => { release = resolve; });
      let fullRequests = 0;
      await page.addInitScript(() => Object.defineProperty(navigator, 'connection', { configurable: true, value: { saveData: true } }));
      await page.route(`${API_BASE_URL}/**`, async route => {
        const url = new URL(route.request().url());
        if (url.pathname.startsWith('/images/')) {
          const width = Number(url.searchParams.get('w'));
          if (width > 480) { fullRequests++; await held; }
          if (width > 480 && scenario === 'failed full image') return route.fulfill({ status: 503, body: 'Unavailable' });
          return route.fulfill({ contentType: 'image/png', path: join(__dirname, landscape ? 'fixtures/reader-landscape-960x640.png' : 'fixtures/archive-preview-480x640.png') });
        }
        if (url.pathname === '/settings/public') return route.fulfill({ json: {} });
        if (url.pathname === '/collections') return route.fulfill({ json: [collection] });
        if (url.pathname === '/collections/003') return route.fulfill({ json: collection });
        if (url.pathname === '/collections/003/profile') return route.fulfill({ json: null });
        if (url.pathname === '/letters/search') return route.fulfill({ json: { letters: [{ id: letterId, title: 'A visible reader preview', imageUrl, imageType: 'letter', verified: true }], page: 1, limit: 24, total: 1, facets } });
        if (url.pathname === `/letters/${letterId}`) return route.fulfill({ json: letter });
        if (url.pathname === `/letters/${letterId}/adjacent`) return route.fulfill({ json: null });
        return route.fulfill({ status: 404, json: {} });
      });
      try {
        if (scenario !== 'direct entry') {
          await page.goto('/collections/003');
          const card = page.locator('a.letter-card');
          await card.scrollIntoViewIfNeeded();
          await expect.poll(() => card.locator('img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth)).toBeGreaterThan(0);
          await card.click();
        } else await page.goto(`/letter/${letterId}`);
        await expect.poll(() => fullRequests).toBeGreaterThan(0);
        await page.evaluate(() => document.fonts.ready);
        const slide = page.locator('.scan-slide[data-index="0"]');
        const preview = slide.locator('.progressive-image__thumb');
        await expect.poll(() => preview.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth)).toBeGreaterThan(0);
        await expect(preview).toHaveAttribute('src', scenario === 'direct entry' ? /w=32/ : /w=480/);
        await expect(preview).toBeVisible();
        await expect(preview).toBeInViewport({ ratio: 0.2 });
        const geometry = () => page.evaluate(() => {
          const slide = document.querySelector('.scan-slide[data-index="0"]')!.getBoundingClientRect();
          const image = document.querySelector('.scan-slide[data-index="0"] .scan-slide-img')!.getBoundingClientRect();
          const transcript = document.querySelector('#letter-transcript')!.getBoundingClientRect();
          return { slideHeight: slide.height, imageWidth: image.width, imageHeight: image.height,
            transcriptTop: transcript.top + window.scrollY };
        });
        const pending = await geometry();
        expect(pending.slideHeight).toBeGreaterThan(150);
        expect(pending.imageWidth).toBeGreaterThan(150);
        expect(pending.imageHeight).toBeGreaterThan(150);
        expect(pending.imageHeight).toBeLessThanOrEqual(viewport.height * 0.72 + 1);
        expect(pending.imageWidth / pending.imageHeight).toBeCloseTo(imageWidth / imageHeight, 2);
        await expect(slide.locator('.progressive-image__full')).toHaveCSS('opacity', '0');
        if (scenario === 'card handoff') await testInfo.attach('pending-reader-preview', { body: await page.screenshot(), contentType: 'image/png' });
        release();
        if (scenario === 'failed full image') {
          await expect.poll(() => fullRequests).toBe(3);
          await expect(preview).toBeVisible();
        } else {
          await expect(slide.locator('.progressive-image__full')).toHaveCSS('opacity', '1');
          await expect(preview).toHaveCount(0);
        }
        const settled = await geometry();
        await testInfo.attach('reader-geometry', { body: JSON.stringify({ pending, settled }), contentType: 'application/json' });
        expect(Math.abs(settled.imageHeight - pending.imageHeight)).toBeLessThanOrEqual(1);
        expect(Math.abs(settled.transcriptTop - pending.transcriptTop)).toBeLessThanOrEqual(1);
      } finally { release(); await context.close(); }
    });
  }
}
