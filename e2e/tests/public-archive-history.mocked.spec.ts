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
    await link.click({ button: 'middle' });
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
    await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="640"><rect width="480" height="640" fill="#d9cdbb"/></svg>' });
  });
  await page.goto('/');
  const cards = page.locator('a.letter-card .preview-image__image');
  await expect(cards).toHaveCount(19);
  await expect.poll(() => requests.length).toBeGreaterThan(0);
  expect(requests.length).toBeLessThan(19);
  await expect(cards.last()).not.toHaveAttribute('src');
  await cards.last().scrollIntoViewIfNeeded();
  await expect.poll(() => cards.last().evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth === 480)).toBe(true);
  expect(new Set(requests.map((url) => new URL(url).searchParams.get('w')))).toEqual(new Set(['480']));
  const lastUrl = await cards.last().getAttribute('src');
  await cards.first().scrollIntoViewIfNeeded();
  await expect.poll(() => cards.first().evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth === 480)).toBe(true);
  await cards.last().scrollIntoViewIfNeeded();
  await expect(cards.last()).toHaveAttribute('src', lastUrl!);
  expect(requests.filter((url) => url === lastUrl)).toHaveLength(1);
});
