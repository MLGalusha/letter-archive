import { expect, test, type Page } from '@playwright/test';
import { installMockAdminRelationshipsApi } from './utils/mock-admin-relationships-api';

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
