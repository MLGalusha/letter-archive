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

  test('keeps letter dashboard managers exclusive and dismisses them together', async ({
    page,
  }) => {
    await installMockAdminDashboardApi(page);

    await page.goto('/admin');
    await waitForAdminDashboardReady(page);

    const filtersTrigger = page.getByRole('button', { name: 'Filters' });
    await filtersTrigger.click();
    await expect(page.getByRole('heading', { name: 'Filters' })).toBeVisible();

    await page.getByRole('button', { name: 'Save view' }).click();
    await expect(page.getByRole('heading', { name: 'Filters' })).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Saved views' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(1);

    await page.getByRole('button', { name: /Sort/i }).click();
    await expect(page.getByRole('dialog', { name: 'Saved views' })).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Sort rules' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(1);

    await page.getByRole('button', { name: 'Configure columns' }).click();
    await expect(page.getByRole('dialog', { name: 'Sort rules' })).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Column settings' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(1);

    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('admin-mobile-nav-open'));
    });

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(filtersTrigger).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('button', { name: 'Save view' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await expect(page.getByRole('button', { name: /Sort/i })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await expect(page.getByRole('button', { name: 'Configure columns' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  test('normalizes hostile stored state and safely applies a partial legacy view', async ({
    page,
  }) => {
    await installMockAdminDashboardApi(page, {
      persistedDashboardState: {
        visibilityFilter: 'PUBLIC',
        collectionFilter: 42,
        searchQuery: { nested: 'query' },
        sortColumns: [{ field: 'createdAt', direction: 'sideways' }],
        dateMode: 'weekly',
        year: '1886',
        month: 13,
        day: 0,
        dateFrom: '1886-01-01',
        dateTo: [],
        transcriptStatusFilters: { status: 'VERIFIED' },
        metadataStatusFilters: 'AI_DRAFT',
        extraContentStatusFilters: null,
        workflowFilters: ['NOT_A_WORKFLOW'],
        flaggedFilter: 'MAYBE',
        missingFilters: ['not-a-field'],
        contentShapeFilters: 'photos',
      },
      savedDashboardViews: [{
        id: 'legacy-alice',
        name: 'Legacy Alice',
        createdAt: '2025-01-01T00:00:00.000Z',
        state: {
          searchQuery: 'alice',
          visibleColumns: ['sender'],
        },
      }],
    });

    const initialRequestPromise = waitForAdminLettersRequest(
      page,
      (url) => url.searchParams.get('limit') === '50',
    );
    await page.goto('/admin');
    const initialRequest = await initialRequestPromise;
    await waitForAdminDashboardReady(page);

    expect(Object.fromEntries(initialRequest.searchParams.entries())).toEqual({
      page: '1',
      limit: '50',
      sort: 'lastOpenedAt',
      sortOrder: 'desc',
      sortRules: 'lastOpenedAt:desc',
    });
    await expect(page.locator(SELECTORS.dashboard.tableRow)).toHaveCount(2);
    await expect(page.locator('.letter-count')).toHaveText('1–2 of 2');

    await page.getByRole('button', { name: 'Save view' }).click();
    const savedViewsDialog = page.getByRole('dialog', { name: 'Saved views' });
    await expect(savedViewsDialog).toBeVisible();

    const legacyRequestPromise = waitForAdminLettersRequest(
      page,
      (url) => url.searchParams.get('search') === 'alice',
    );
    await savedViewsDialog.getByRole('button', {
      name: 'Legacy Alice',
      exact: true,
    }).click();
    const legacyRequest = await legacyRequestPromise;

    expect(Object.fromEntries(legacyRequest.searchParams.entries())).toEqual({
      page: '1',
      limit: '50',
      search: 'alice',
      sort: 'lastOpenedAt',
      sortOrder: 'desc',
      sortRules: 'lastOpenedAt:desc',
    });
    await expect(page.getByRole('searchbox', {
      name: 'Search letters, senders, recipients...',
    })).toHaveValue('alice');
    await expect(page.locator(SELECTORS.dashboard.tableRow)).toHaveCount(1);
    await expect(page.locator(SELECTORS.dashboard.table)).toContainText('Alice Smith');
    await expect(page.locator(SELECTORS.dashboard.table)).not.toContainText('Clara Jones');
    await expect(page.getByRole('columnheader', { name: 'Sender' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Recipient' })).toHaveCount(0);
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

  test('keeps compound filter intents on one normalized request state', async ({
    page,
  }) => {
    await installMockAdminDashboardApi(page);

    await page.goto('/admin');
    await waitForAdminDashboardReady(page);
    await page.getByRole('button', { name: 'Filters' }).click();

    const collectionRequest = waitForAdminLettersRequest(
      page,
      (url) => url.searchParams.get('collection') === '001',
    );
    await page.getByRole('textbox', { name: 'Collection code' }).fill('001');
    await page.getByRole('button', { name: 'Add collection filter' }).click();
    await collectionRequest;

    const visibilityRequest = waitForAdminLettersRequest(
      page,
      (url) => (
        url.searchParams.get('collection') === '001'
        && url.searchParams.get('visibility') === 'PUBLISHED'
      ),
    );
    await page.locator('.filter-published').click();
    await visibilityRequest;

    await page.getByRole('button', { name: 'Range' }).click();
    const dateInputs = page.getByPlaceholder('mm/dd/yyyy');
    const dateFromInput = dateInputs.nth(0);
    const dateToInput = dateInputs.nth(1);
    await dateFromInput.fill('07/01/1932');
    await dateToInput.fill('07/31/1932');

    const compoundRequest = waitForAdminLettersRequest(
      page,
      (url) => (
        url.searchParams.get('collection') === '001'
        && url.searchParams.get('visibility') === 'PUBLISHED'
        && url.searchParams.get('dateFrom') === '19320701'
        && url.searchParams.get('dateTo') === '19320731'
        && url.searchParams.get('search') === 'alice'
      ),
    );
    await page.getByRole('searchbox', {
      name: 'Search letters, senders, recipients...',
    }).fill('alice');
    const compoundUrl = await compoundRequest;

    expect(Object.fromEntries(compoundUrl.searchParams.entries())).toEqual({
      page: '1',
      limit: '50',
      collection: '001',
      visibility: 'PUBLISHED',
      search: 'alice',
      sort: 'lastOpenedAt',
      sortOrder: 'desc',
      sortRules: 'lastOpenedAt:desc',
      dateFrom: '19320701',
      dateTo: '19320731',
    });

    const collectionRemovalRequest = waitForAdminLettersRequest(
      page,
      (url) => (
        !url.searchParams.has('collection')
        && url.searchParams.get('visibility') === 'PUBLISHED'
        && url.searchParams.get('search') === 'alice'
        && url.searchParams.get('dateFrom') === '19320701'
        && url.searchParams.get('dateTo') === '19320731'
      ),
    );
    await page.getByRole('button', {
      name: 'Collection 001',
      exact: true,
    }).click();
    await collectionRemovalRequest;

    const clearedRequest = waitForAdminLettersRequest(
      page,
      (url) => (
        !url.searchParams.has('collection')
        && !url.searchParams.has('visibility')
        && !url.searchParams.has('search')
        && !url.searchParams.has('dateFrom')
        && !url.searchParams.has('dateTo')
      ),
    );
    await page.getByRole('button', {
      name: 'Clear all',
      exact: true,
    }).click();
    const clearedUrl = await clearedRequest;

    expect(Object.fromEntries(clearedUrl.searchParams.entries())).toEqual({
      page: '1',
      limit: '50',
      sort: 'lastOpenedAt',
      sortOrder: 'desc',
      sortRules: 'lastOpenedAt:desc',
    });
    await expect(page.getByRole('searchbox', {
      name: 'Search letters, senders, recipients...',
    })).toHaveValue('');
    await expect(page.getByLabel('Active filters')).not.toContainText(
      'Collection 001',
    );
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

  test('keeps all-filtered source provenance complete and revokes it on a manual edit', async ({
    page,
  }) => {
    const mockedApi = await installMockAdminDashboardApi(page, {
      letterCount: 51,
    });

    await page.goto('/admin');
    await waitForAdminDashboardReady(page);
    await expect(page.locator(SELECTORS.dashboard.tableRow)).toHaveCount(50);

    const firstLetter = page.getByRole('checkbox', {
      name: 'Select Letter One',
    });
    await firstLetter.check();
    await page.getByRole('button', { name: 'All 51', exact: true }).click();

    const bulkActions = page.getByRole('region', { name: 'Bulk actions' });
    await expect(bulkActions).toContainText('51 selected');
    await expect(
      page.getByRole('button', { name: 'All 51 ✓', exact: true }),
    ).toBeVisible();

    await firstLetter.uncheck();

    await expect(bulkActions).toContainText('50 selected');
    await expect(
      page.getByRole('button', { name: 'All 51', exact: true }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'All 51', exact: true }).click();
    await page.getByRole('button', {
      name: 'Transcribe (51)',
      exact: true,
    }).click();
    await page.getByRole('button', {
      name: 'Queue Eligible',
      exact: true,
    }).click();

    await expect.poll(
      () => mockedApi.bulkTranscriptionRequests.length,
    ).toBe(1);
    const [request] = mockedApi.bulkTranscriptionRequests;
    expect(request.overwrite).toBe(false);
    expect(request.sources).toHaveLength(51);
    expect(request.sources[0]).toEqual({
      letterId: 'letter-1',
      primarySourceRevision: 11,
    });
    expect(request.sources[50]).toEqual({
      letterId: 'letter-51',
      primarySourceRevision: 1051,
    });
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
