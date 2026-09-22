import { join } from 'node:path';
import { expect, test, type Page, type Request } from '@playwright/test';
import { API_BASE_URL } from './utils/test-helpers';

const EMPTY_FACETS = {
  formats: [],
  collections: [],
  correspondents: [],
  places: [],
  years: [],
  topics: [],
  tones: [],
  relationships: [],
};

function isApiPath(url: URL, pathname: string): boolean {
  return url.origin === new URL(API_BASE_URL).origin
    && url.pathname === pathname;
}

async function installMockPublicHomeApi(page: Page): Promise<void> {
  await page.route(
    (url) => isApiPath(url, '/letters/search'),
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          letters: [],
          page: 1,
          limit: 24,
          total: 0,
          facets: EMPTY_FACETS,
        }),
      });
    },
  );
  await page.route(
    (url) => isApiPath(url, '/blog'),
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ posts: [], total: 0 }),
      });
    },
  );
  for (const pathname of [
    '/content/featured-letter',
    '/content/pages/home',
  ]) {
    await page.route(
      (url) => isApiPath(url, pathname),
      async (route) => {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Not found' }),
        });
      },
    );
  }
}

function waitForArchiveSearch(
  page: Page,
  expectedQuery: string | null,
): Promise<Request> {
  return page.waitForRequest((request) => {
    const url = new URL(request.url());
    return isApiPath(url, '/letters/search')
      && url.searchParams.get('search') === expectedQuery;
  });
}

test.describe('@mocked Public archive history', () => {
  test('opens an archive card in a new tab using its native destination', async ({ page, context }) => {
    await installMockPublicHomeApi(page);
    await page.route((url) => isApiPath(url, '/letters/search'), async (route) => {
      await route.fulfill({ json: { letters: [{ id: 'native-link-letter', title: 'A family letter', imageType: 'letter', verified: true }], page: 1, limit: 24, total: 1, facets: EMPTY_FACETS } });
    });
    await page.goto('/');
    const link = page.locator('a.letter-card');
    await expect(link).toHaveAttribute('href', '/letter/native-link-letter');
    const opened = context.waitForEvent('page');
    await link.click({ modifiers: ['ControlOrMeta'] });
    const tab = await opened;
    await tab.waitForURL('**/letter/native-link-letter');
    await expect(page).toHaveURL(/\/$/);
    await tab.close();
  });

  test('keeps Home URL, input, and requests synchronized through Back and Forward', async ({
    page,
  }) => {
    await installMockPublicHomeApi(page);
    const searchInput = page.getByRole('searchbox', {
      name: 'Search the archive',
    });

    const initialSearch = waitForArchiveSearch(page, 'alice');
    await page.goto('/?q=alice');
    await initialSearch;
    await expect(page).toHaveURL(/\/\?q=alice$/);
    await expect(searchInput).toHaveValue('alice');

    const clearedSearch = waitForArchiveSearch(page, null);
    await page.getByRole('link', { name: 'Home', exact: true }).click();
    await clearedSearch;
    await expect(page).toHaveURL(/\/$/);
    await expect(searchInput).toHaveValue('');

    const restoredSearch = waitForArchiveSearch(page, 'alice');
    await page.goBack();
    await restoredSearch;
    await expect(page).toHaveURL(/\/\?q=alice$/);
    await expect(searchInput).toHaveValue('alice');

    const forwardSearch = waitForArchiveSearch(page, null);
    await page.goForward();
    await forwardSearch;
    await expect(page).toHaveURL(/\/$/);
    await expect(searchInput).toHaveValue('');
  });
});

test('@mocked archive previews use one size, defer distant cards, and stay loaded on return', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.mouse.move(0, 0);
  await installMockPublicHomeApi(page);
  const letters = Array.from({ length: 19 }, (_, i) => ({
    id: `preview-${i}`, imageUrl: `/images/preview-${i}`, imageType: 'letter',
    title: `Preview ${i}`, verified: true,
  }));
  await page.route((url) => isApiPath(url, '/letters/search'), (route) => route.fulfill({
    json: { letters, page: 1, limit: 24, total: 19, facets: EMPTY_FACETS },
  }));
  const requests: string[] = [];
  await page.route((url) => url.origin === new URL(API_BASE_URL).origin && url.pathname.startsWith('/images/preview-'), async (route) => {
    requests.push(route.request().url());
    // Raster intrinsic dimensions are consistent across Chromium and WebKit.
    await route.fulfill({ contentType: 'image/png', path: join(__dirname, 'fixtures/archive-preview-480x640.png') });
  });
  await page.goto('/');
  const cards = page.locator('a.letter-card .preview-image__image');
  await expect(cards).toHaveCount(19);
  await expect.poll(() => requests.length).toBeGreaterThan(0);
  expect(requests.length).toBeLessThan(19);
  await expect(cards.last()).not.toHaveAttribute('src');
  await cards.last().scrollIntoViewIfNeeded();
  await expect.poll(() => cards.last().evaluate((img: HTMLImageElement) => ({ complete: img.complete, naturalWidth: img.naturalWidth, src: img.getAttribute('src') !== null }))).toEqual({ complete: true, naturalWidth: 480, src: true });
  expect(new Set(requests.map((url) => new URL(url).searchParams.get('w')))).toEqual(new Set(['480']));
  const lastUrl = await cards.last().getAttribute('src');
  await cards.first().scrollIntoViewIfNeeded();
  await expect.poll(() => cards.first().evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth === 480)).toBe(true);
  await cards.last().scrollIntoViewIfNeeded();
  await expect(cards.last()).toHaveAttribute('src', lastUrl!);
  expect(requests.filter((url) => url === lastUrl)).toHaveLength(1);
});

test('@mocked reader renders detail before adjacency and announces pending navigation without a visible bar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let releaseDetail!: () => void;
  let releaseAdjacent!: () => void;
  const detailGate = new Promise<void>((resolve) => { releaseDetail = resolve; });
  const adjacentGate = new Promise<void>((resolve) => { releaseAdjacent = resolve; });
  await page.route((url) => url.origin === new URL(API_BASE_URL).origin, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/settings/public') return route.fulfill({ json: {} });
    if (path === '/images/reader-fixture') return route.fulfill({
      contentType: 'image/png', path: join(__dirname, 'fixtures/archive-preview-480x640.png'),
    });
    if (path === '/letters/summaries') return route.fulfill({ json: { letters: [], total: 0 } });
    if (path.endsWith('/adjacent')) {
      if (path.includes('reader-b')) await adjacentGate;
      return route.fulfill({ json: {
        prev: null, next: { id: 'reader-b', date: 'Second letter' },
        total: 2, position: 1, collectionCode: '003', collectionTitle: 'Fixture collection',
      } });
    }
    if (path.startsWith('/letters/')) {
      const id = path.split('/').at(-1)!;
      if (id === 'reader-b') await detailGate;
      return route.fulfill({ json: {
        id, title: id, collectionCode: '003', images: [{
          id: 'reader-fixture', imageUrl: '/images/reader-fixture', type: 'letter', pageNumber: 1, width: 480, height: 640,
        }],
        metadata: { date: id === 'reader-a' ? 'First fixture letter' : 'Second fixture letter', verified: true },
        transcript: { pages: [], fullText: '', verified: true },
        status: 'published', visibility: 'PUBLISHED', transcriptPublished: true, metadataPublished: true,
        transcriptStatus: 'VERIFIED', metadataContentStatus: 'VERIFIED', extraContentStatus: 'EMPTY',
      } });
    }
    return route.fulfill({ status: 404, json: { error: 'Not found' } });
  });
  try {
    await page.goto('/letter/reader-a');
    await expect(page.getByText('First fixture letter', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page).toHaveURL(/reader-b$/);
    const status = page.getByRole('status').filter({ hasText: 'Loading letter...' });
    await expect(status).toHaveText('Loading letter...');
    await expect(status).toHaveCSS('clip', 'rect(0px, 0px, 0px, 0px)');
    expect(await status.evaluate(element => element.closest('[inert]'))).toBeNull();
    await expect(page.locator('article')).toHaveCSS('opacity', '1');
    await expect(page.locator('article')).toHaveAttribute('inert', '');
    await expect.poll(() => status.evaluate((element) => {
      const r = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
    })).toBe(false);
    releaseDetail();
    await expect(page.getByText('Second fixture letter', { exact: true })).toBeVisible();
    await expect(page.locator('article')).not.toHaveAttribute('inert');
    await expect(status).toHaveCount(0);
    await expect(page.locator('.letter-nav-section')).toHaveCount(0);
    releaseAdjacent();
    await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeEnabled();
    await page.goBack();
    await expect(page.getByText('First fixture letter', { exact: true })).toBeVisible();
    // Thumbnail activation stays in the document and preserves Forward history.
    await page.getByRole('button', { name: 'Go to scan 1: letter', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Original scans' })).toHaveCount(0);
    await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
    await page.goForward();
    await expect(page.getByText('Second fixture letter', { exact: true })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Original scans' })).toHaveCount(0);
    await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  } finally {
    releaseDetail();
    releaseAdjacent();
  }
});
