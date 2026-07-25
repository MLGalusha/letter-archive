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
