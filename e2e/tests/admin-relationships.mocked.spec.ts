import { expect, test, type Page } from '@playwright/test';
import { installMockAdminRelationshipsApi } from './utils/mock-admin-relationships-api';
import { API_BASE_URL } from './utils/test-helpers';

async function openMockAdminRelationships(page: Page) {
  const mockedApi = await installMockAdminRelationshipsApi(page);
  await page.goto('/admin/entities/relationships');
  await page.locator('.relationships-page').waitFor({ state: 'visible' });
  await page.locator('.relationships-table').waitFor({ state: 'visible' });
  return mockedApi;
}

test.describe('@mocked Admin Relationships', () => {
  test('filters deterministic relationships in table view', async ({ page }) => {
    await openMockAdminRelationships(page);

    const rows = page.locator('.relationships-table tbody tr');
    await expect(rows).toHaveCount(3);

    await page.locator('.search-input').fill('david');
    await expect(rows).toHaveCount(1);
    await expect(page.locator('.relationships-table')).toContainText('David Dunn');

    await page.locator('.search-input').fill('');
    await page.locator('.type-filter').selectOption('friend');
    await expect(rows).toHaveCount(1);
    await expect(page.locator('.relationships-table')).toContainText('Alice Smith');
  });

  test('opens the add relationship modal from the real admin page shell', async ({
    page,
  }) => {
    await openMockAdminRelationships(page);

    await page.getByRole('button', { name: 'Add Relationship' }).click();

    await expect(page.locator('.modal-overlay')).toBeVisible();
    await expect(page.locator('.modal-title')).toHaveText('Add Relationship');
    await expect(page.locator('.add-relationship-form')).toContainText('Person A');
    await expect(page.locator('.add-relationship-form')).toContainText('Person B');
  });

  test('creates a relationship through the real add modal workflow', async ({
    page,
  }) => {
    const mockedApi = await openMockAdminRelationships(page);

    await page.getByRole('button', { name: 'Add Relationship' }).click();
    await expect(page.locator('.modal-overlay')).toBeVisible();

    const personSelects = page.locator('.add-relationship-form .person-select');
    const personASelect = personSelects.nth(0);
    const personBSelect = personSelects.nth(1);

    await personASelect.locator('input[placeholder="Search..."]').fill('Alice');
    await personASelect.locator('.search-row button').click();
    await page.locator('.search-results li', { hasText: 'Alice Smith' }).click();

    await personBSelect.locator('input[placeholder="Search..."]').fill('David');
    await personBSelect.locator('.search-row button').click();
    await page.locator('.search-results li', { hasText: 'David Dunn' }).click();

    await page.locator('.relationship-type-select select').selectOption('unknown');
    await page.locator('.metadata-row input[type="number"]').fill('88');
    await page.locator('.metadata-row input[placeholder="Optional context"]').fill('Archive note');

    await page.getByRole('button', { name: 'Create Relationship' }).click();

    await expect(page.locator('.modal-overlay')).not.toBeVisible();
    await expect(page.locator('.relationships-table tbody tr')).toHaveCount(4);
    await expect(page.locator('.relationships-table')).toContainText('David Dunn');
    await expect
      .poll(() => mockedApi.createRequests.length)
      .toBe(1);
    expect(mockedApi.createRequests[0]).toEqual({
      personAId: 'person-a',
      personBId: 'person-d',
      relationshipType: 'unknown',
      confidence: 88,
      notes: 'Archive note',
    });
  });

  test('shows the request id when deleting a relationship fails', async ({
    page,
  }) => {
    const mockedApi = await installMockAdminRelationshipsApi(page, {
      deleteError: {
        message: 'Delete failed',
        requestId: 'req-rel-500',
      },
    });

    await page.goto('/admin/entities/relationships');
    await page.locator('.relationships-table').waitFor({ state: 'visible' });

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Delete relationship' }).first().click();

    await expect(page.locator('.toast-error')).toContainText('Delete failed');
    await expect(page.locator('.toast-error')).toContainText('Request ID: req-rel-500');
    expect(mockedApi.deleteRequests).toEqual([
      `${API_BASE_URL}/admin/relationships/rel-1`,
    ]);
  });

  test('switches to graph view and finds a mocked connection path', async ({ page }) => {
    const mockedApi = await openMockAdminRelationships(page);

    await page.locator('.toggle-btn:has-text("Graph")').click();
    await expect(page.locator('.graph-view')).toBeVisible();

    await page.locator('.finder-toggle').click();
    await expect(page.locator('.connection-finder')).toBeVisible();

    const inputs = page.locator('.finder-search');
    await inputs.nth(0).fill('Alice');
    await page.locator('.finder-suggestions li', { hasText: 'Alice Smith' }).click();

    await inputs.nth(1).fill('Carol');
    await page.locator('.finder-suggestions li', { hasText: 'Carol Clark' }).click();

    await expect(page.locator('.connection-path')).toContainText('Alice Smith');
    await expect(page.locator('.connection-path')).toContainText('Bob Baker');
    await expect(page.locator('.connection-path')).toContainText('Carol Clark');
    await expect
      .poll(() => mockedApi.pathRequests.length)
      .toBe(1);

    await expect(page.locator('.graph-svg .node circle').nth(3)).toHaveAttribute('opacity', '0.3');
    await expect(page.locator('.graph-svg .link').nth(2)).toHaveAttribute('stroke-opacity', '0.2');
  });
});
