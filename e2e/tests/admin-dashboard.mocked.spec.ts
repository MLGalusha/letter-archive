import { test, expect } from '@playwright/test';
import {
  installMockAdminDashboardApi,
  waitForAdminLettersRequest,
} from './utils/mock-api';
import { API_BASE_URL, SELECTORS } from './utils/test-helpers';

test.describe('@mocked Admin Dashboard', () => {
  test('renders deterministic mocked letters and stats', async ({ page }) => {
    await installMockAdminDashboardApi(page);

    await page.goto('/admin');
    await page.locator('.admin-header').waitFor({ state: 'visible' });

    await expect(page.locator(SELECTORS.dashboard.table)).toBeVisible();
    await expect(page.locator(SELECTORS.dashboard.tableRow)).toHaveCount(2);
    await expect(page.locator(SELECTORS.dashboard.table)).toContainText('Alice Smith');
    await expect(page.locator(SELECTORS.dashboard.table)).toContainText('Clara Jones');
    await expect(page.locator('.letter-count')).toHaveText('1–2 of 2');
    await expect(page.locator('.filter-published')).toContainText('1 Public');
    await expect(page.locator('.filter-hidden')).toContainText('1 Hidden');
    await expect(page.locator('.filter-flagged')).toContainText('1 Flagged');
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
    await page.locator('.admin-header').waitFor({ state: 'visible' });

    const requestPromise = waitForAdminLettersRequest(
      page,
      (url) => url.searchParams.get('search') === 'alice',
    );
    const searchInput = page.locator(SELECTORS.dashboard.searchInput);
    await searchInput.fill('alice');

    const requestUrl = await requestPromise;

    expect(requestUrl.searchParams.get('search')).toBe('alice');
    await expect(page.locator(SELECTORS.dashboard.tableRow)).toHaveCount(1);
    await expect(page.locator(SELECTORS.dashboard.table)).toContainText('Alice Smith');
  });

  test('applies visibility filters through server-driven requests', async ({ page }) => {
    await installMockAdminDashboardApi(page);

    await page.goto('/admin');
    await page.locator('.admin-header').waitFor({ state: 'visible' });

    const requestPromise = waitForAdminLettersRequest(
      page,
      (url) => url.searchParams.get('visibility') === 'PUBLISHED',
    );
    await page.locator('.filter-published').click();

    const requestUrl = await requestPromise;

    expect(requestUrl.searchParams.get('visibility')).toBe('PUBLISHED');
    await expect(page.locator('.filter-published')).toHaveClass(/active/);
    await expect(page.locator(SELECTORS.dashboard.tableRow)).toHaveCount(1);
    await expect(page.locator(SELECTORS.dashboard.table)).toContainText('Alice Smith');
  });

  test('optimistically toggles the flag button and sends the patch request', async ({ page }) => {
    const mockedApi = await installMockAdminDashboardApi(page);

    await page.goto('/admin');
    await page.locator('.admin-header').waitFor({ state: 'visible' });

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
    await page.locator('.admin-header').waitFor({ state: 'visible' });

    const flagButton = page.getByRole('button', { name: 'Flag letter' }).first();
    await flagButton.click();

    await expect(page.locator('.toast-error')).toContainText('Flag service unavailable');
    await expect(page.locator('.toast-error')).toContainText('Request ID: req-flag-123');
    await expect(flagButton).toHaveAttribute('aria-label', 'Flag letter');
  });

  test('shows the request id when processing status polling fails', async ({ page }) => {
    await installMockAdminDashboardApi(page, {
      processingStatusError: {
        message: 'Processing status unavailable',
        requestId: 'req-dashboard-status-503',
      },
    });

    await page.goto('/admin');
    await page.locator('.admin-header').waitFor({ state: 'visible' });

    await expect(page.locator('.toast-error')).toContainText(
      'Processing status unavailable',
    );
    await expect(page.locator('.toast-error')).toContainText(
      'Request ID: req-dashboard-status-503',
    );
  });
});
