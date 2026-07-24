import { test, expect } from '@playwright/test';
import {
  installMockAdminDashboardApi,
  waitForAdminLettersRequest,
} from './utils/mock-api';
import {
  API_BASE_URL,
  SELECTORS,
  waitForAdminDashboardReady,
} from './utils/test-helpers';

test.describe('@mocked Admin Dashboard', () => {
  test('renders deterministic mocked letters and stats', async ({ page }) => {
    await installMockAdminDashboardApi(page);

    await page.goto('/admin');
    await waitForAdminDashboardReady(page);

    await expect(page.locator(SELECTORS.dashboard.table)).toBeVisible();
    await expect(page.locator(SELECTORS.dashboard.tableRow)).toHaveCount(2);
    await expect(page.locator(SELECTORS.dashboard.table)).toContainText('Alice Smith');
    await expect(page.locator(SELECTORS.dashboard.table)).toContainText('Clara Jones');
    await expect(page.locator('.letter-count')).toHaveText('1–2 of 2');

    await page.getByRole('button', { name: 'Filters' }).click();
    await expect(page.locator('.filter-published .filter-option-label')).toHaveText('Public');
    await expect(page.locator('.filter-published .filter-option-count')).toHaveText('1');
    await expect(page.locator('.filter-hidden .filter-option-label')).toHaveText('Hidden');
    await expect(page.locator('.filter-hidden .filter-option-count')).toHaveText('1');
  });

  test('shows the request id when the dashboard letter list fails to load', async ({
    page,
  }) => {
    await installMockAdminDashboardApi(page, {
      lettersError: {
        message: 'Letter list unavailable',
        requestId: 'req-dashboard-load-503',
      },
    });

    await page.goto('/admin');

    await expect(page.locator('.error-message')).toContainText(
      'Letter list unavailable (Request ID: req-dashboard-load-503)',
    );
  });

  test('sends debounced search queries to the admin letters API', async ({ page }) => {
    await installMockAdminDashboardApi(page);

    await page.goto('/admin');
    await waitForAdminDashboardReady(page);

    const requestPromise = waitForAdminLettersRequest(
      page,
      (url) => url.searchParams.get('search') === 'alice',
    );
    const searchInput = page.getByRole('searchbox', {
      name: 'Search letters, senders, recipients...',
    });
    await searchInput.fill('alice');

    const requestUrl = await requestPromise;

    expect(requestUrl.searchParams.get('search')).toBe('alice');
    await expect(page.locator(SELECTORS.dashboard.tableRow)).toHaveCount(1);
    await expect(page.locator(SELECTORS.dashboard.table)).toContainText('Alice Smith');
  });

  test('applies visibility filters through server-driven requests', async ({ page }) => {
    await installMockAdminDashboardApi(page);

    await page.goto('/admin');
    await waitForAdminDashboardReady(page);
    await page.getByRole('button', { name: 'Filters' }).click();

    const requestPromise = waitForAdminLettersRequest(
      page,
      (url) => url.searchParams.get('visibility') === 'PUBLISHED',
    );
    const publishedFilter = page.locator('.filter-published');
    await publishedFilter.click();

    const requestUrl = await requestPromise;

    expect(requestUrl.searchParams.get('visibility')).toBe('PUBLISHED');
    await expect(publishedFilter).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator(SELECTORS.dashboard.tableRow)).toHaveCount(1);
    await expect(page.locator(SELECTORS.dashboard.table)).toContainText('Alice Smith');
  });

  test('keeps list and filtered-selection requests on the same committed query', async ({
    page,
  }) => {
    const mockedApi = await installMockAdminDashboardApi(page);

    await page.goto('/admin');
    await waitForAdminDashboardReady(page);
    await page.getByRole('button', { name: 'Filters' }).click();

    const publishedRequest = waitForAdminLettersRequest(
      page,
      (url) => url.searchParams.get('visibility') === 'PUBLISHED',
    );
    await page.locator('.filter-published').click();
    await publishedRequest;

    const transcriptRequest = waitForAdminLettersRequest(
      page,
      (url) => url.searchParams.get('transcriptStatus') === 'AI_DRAFT',
    );
    await page.getByRole('button', { name: 'Draft 1' }).click();
    await transcriptRequest;

    await page.getByRole('button', { name: 'Metadata', exact: true }).click();
    const metadataRequest = waitForAdminLettersRequest(
      page,
      (url) => url.searchParams.get('metadataStatus') === 'EDITED',
    );
    await page.getByRole('button', { name: 'Edited 1' }).click();
    await metadataRequest;

    await page.getByRole('checkbox', { name: 'Select Letter One' }).check();
    await page.getByRole('searchbox', {
      name: 'Search letters, senders, recipients...',
    }).fill('alice');

    await expect.poll(() => (
      mockedApi.adminLettersRequests.filter((url) => (
        url.searchParams.get('search') === 'alice'
        && url.searchParams.get('visibility') === 'PUBLISHED'
        && url.searchParams.get('transcriptStatus') === 'AI_DRAFT'
        && url.searchParams.get('metadataStatus') === 'EDITED'
      )).length
    )).toBeGreaterThanOrEqual(2);

    const committedRequests = mockedApi.adminLettersRequests.filter((url) => (
      url.searchParams.get('search') === 'alice'
      && url.searchParams.get('visibility') === 'PUBLISHED'
      && url.searchParams.get('transcriptStatus') === 'AI_DRAFT'
      && url.searchParams.get('metadataStatus') === 'EDITED'
    ));
    const listRequest = committedRequests.find(
      (url) => url.searchParams.get('limit') === '50',
    );
    const selectionRequest = committedRequests.find(
      (url) => url.searchParams.get('limit') === '100',
    );

    expect(listRequest).toBeDefined();
    expect(selectionRequest).toBeDefined();
    expect(listRequest?.searchParams.get('sortRules')).toBe(
      'lastOpenedAt:desc',
    );

    const committedParams = (url: URL | undefined) => (
      [...(url?.searchParams.entries() ?? [])]
        .filter(([name]) => name !== 'page' && name !== 'limit')
        .sort(([left], [right]) => left.localeCompare(right))
    );

    expect(committedParams(selectionRequest)).toEqual(
      committedParams(listRequest),
    );
  });

  test('optimistically toggles the flag button and sends the patch request', async ({ page }) => {
    const mockedApi = await installMockAdminDashboardApi(page);

    await page.goto('/admin');
    await waitForAdminDashboardReady(page);

    const flagButton = page.getByRole('button', { name: 'Flag letter' }).first();
    await flagButton.click();

    await expect(flagButton).toHaveAttribute('aria-label', 'Unflag letter');
    expect(mockedApi.flagRequests).toEqual([
      {
        url: `${API_BASE_URL}/admin/letters/letter-1/flag`,
        body: { flagged: true },
      },
    ]);
  });

  test('shows the request id when a flag toggle fails', async ({ page }) => {
    await installMockAdminDashboardApi(page, {
      flagError: {
        message: 'Flag service unavailable',
        requestId: 'req-flag-123',
      },
    });

    await page.goto('/admin');
    await waitForAdminDashboardReady(page);

    const flagButton = page.getByRole('button', { name: 'Flag letter' }).first();
    await flagButton.click();

    await expect(page.locator('.toast-error')).toContainText('Flag service unavailable');
    await expect(page.locator('.toast-error')).toContainText('Request ID: req-flag-123');
    await expect(flagButton).toHaveAttribute('aria-label', 'Flag letter');
  });

});
