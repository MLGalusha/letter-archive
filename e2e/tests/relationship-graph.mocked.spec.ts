import { expect, test, type Page } from '@playwright/test';
import { installMockRelationshipGraphApi } from './utils/mock-relationship-graph-api';

async function openMockExplorePage(page: Page) {
  const mockedApi = await installMockRelationshipGraphApi(page);
  await page.goto('/explore');
  await page.locator('.graph-svg').waitFor({ state: 'visible' });
  await expect(page.locator('.graph-svg .node')).toHaveCount(4);
  return mockedApi;
}

test.describe('@mocked Relationship Graph', () => {
  test('renders deterministic graph data and updates the discovery sidebar on node interaction', async ({
    page,
  }) => {
    await openMockExplorePage(page);

    await page.locator('.graph-svg .node circle').first().hover();
    await expect(page.locator('.node-tooltip')).toContainText('Alice Smith');
    await expect(page.locator('.node-tooltip')).toContainText('4 letters');

    await page.locator('.graph-svg .node').nth(1).click({ force: true });

    await expect(page.locator('.person-sidebar .sidebar-header h3')).toHaveText('Bob Baker');
    await expect(page.locator('.relationship-list')).toContainText('Alice Smith');
    await expect(page.locator('.relationship-list')).toContainText('Carol Clark');
    await expect(page.locator('.relationship-list')).toContainText('David Dunn');
  });

  test('finds a mocked connection path and dims non-path graph nodes', async ({
    page,
  }) => {
    const mockedApi = await openMockExplorePage(page);

    await page.locator('button:has-text("Show Connection Finder")').click();
    await expect(page.locator('.connection-finder')).toBeVisible();

    const inputs = page.locator('.finder-search');
    await inputs.nth(0).fill('Alice');
    await page.locator('.finder-suggestions li', { hasText: 'Alice Smith' }).click();

    await inputs.nth(1).fill('Carol');
    await page.locator('.finder-suggestions li', { hasText: 'Carol Clark' }).click();

    await expect(page.locator('.connection-path')).toContainText('Alice Smith');
    await expect(page.locator('.connection-path')).toContainText('Bob Baker');
    await expect(page.locator('.connection-path')).toContainText('Carol Clark');
    await expect(page.locator('.connection-path')).toContainText('is friend of');
    await expect(page.locator('.connection-path')).toContainText('is sibling of');
    await expect
      .poll(() => mockedApi.pathRequests.length)
      .toBe(1);

    await expect(page.locator('.graph-svg .node circle').nth(3)).toHaveAttribute('opacity', '0.3');
    await expect(page.locator('.graph-svg .link').nth(2)).toHaveAttribute('stroke-opacity', '0.2');
  });
});
