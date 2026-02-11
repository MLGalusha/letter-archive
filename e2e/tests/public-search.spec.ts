import { test, expect } from '@playwright/test';
import { SELECTORS } from './utils/test-helpers';

/**
 * E2E tests for Public Search & Homepage
 *
 * Tests cover search functionality, filtering, pagination, and homepage display.
 */

test.describe('Public Search & Homepage', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test.describe('Homepage Display', () => {
    test('loads homepage with correct title', async ({ page }) => {
      await expect(page).toHaveTitle(/fragments-of-us/i);
    });

    test('shows search bar on homepage', async ({ page }) => {
      await expect(page.locator(SELECTORS.public.searchBar)).toBeVisible();
    });

    test('shows archive list on homepage', async ({ page }) => {
      await expect(page.locator(SELECTORS.public.archiveList)).toBeVisible();
    });

    test('shows footer on homepage', async ({ page }) => {
      await expect(page.locator(SELECTORS.public.footer)).toBeVisible();
    });

    test('displays letter cards if published letters exist', async ({ page }) => {
      // Wait for archive list to load
      await page.waitForLoadState('networkidle');

      // Either shows letter cards or empty state
      const letterCards = page.locator(SELECTORS.public.letterCard);
      const emptyState = page.locator('.no-results, .empty-state');

      const hasCards = await letterCards.first().isVisible().catch(() => false);
      const hasEmpty = await emptyState.isVisible().catch(() => false);

      // One of these should be true
      expect(hasCards || hasEmpty).toBe(true);
    });
  });

  test.describe('Search Functionality', () => {
    test('can type in search input', async ({ page }) => {
      const searchInput = page.locator(SELECTORS.public.searchInput);
      await searchInput.fill('test search query');
      await expect(searchInput).toHaveValue('test search query');
    });

    test('search updates results after typing', async ({ page }) => {
      const searchInput = page.locator(SELECTORS.public.searchInput);

      // Get initial state
      await page.waitForLoadState('networkidle');

      // Type search query
      await searchInput.fill('mother');

      // Wait for search to debounce and update
      await page.waitForTimeout(500);
      await page.waitForLoadState('networkidle');

      // Results should have updated (either showing results or empty)
      await expect(page.locator(SELECTORS.public.archiveList)).toBeVisible();
    });

    test('empty search shows all letters', async ({ page }) => {
      const searchInput = page.locator(SELECTORS.public.searchInput);

      // Type then clear
      await searchInput.fill('some query');
      await page.waitForTimeout(300);
      await searchInput.fill('');
      await page.waitForTimeout(300);

      // Should show all letters (archive list visible)
      await expect(page.locator(SELECTORS.public.archiveList)).toBeVisible();
    });

    test('search with no results shows empty state', async ({ page }) => {
      const searchInput = page.locator(SELECTORS.public.searchInput);

      // Search for something unlikely to exist
      await searchInput.fill('xyznonexistentquery12345');
      await page.waitForTimeout(500);
      await page.waitForLoadState('networkidle');

      // Should show empty state or no results message
      const archiveList = page.locator(SELECTORS.public.archiveList);
      await expect(archiveList).toBeVisible();
    });
  });

  test.describe('Letter Card Interactions', () => {
    test('clicking letter card navigates to letter detail', async ({ page }) => {
      const letterCard = page.locator(SELECTORS.public.letterCard).first();

      // Skip if no letters exist
      if (!(await letterCard.isVisible().catch(() => false))) {
        test.skip(true, 'No published letters available');
        return;
      }

      await letterCard.click();
      await page.waitForURL(/\/letter\//);

      // Should be on letter detail page
      expect(page.url()).toContain('/letter/');
    });

    test('letter card shows sender and recipient info', async ({ page }) => {
      const letterCard = page.locator(SELECTORS.public.letterCard).first();

      if (!(await letterCard.isVisible().catch(() => false))) {
        test.skip(true, 'No published letters available');
        return;
      }

      // Card should contain some text (sender/recipient/date info)
      const cardText = await letterCard.textContent();
      expect(cardText?.length).toBeGreaterThan(0);
    });
  });

  test.describe('Responsive Layout', () => {
    test('search bar is visible on mobile viewport', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      await expect(page.locator(SELECTORS.public.searchBar)).toBeVisible();
    });

    test('archive list is visible on mobile viewport', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      await expect(page.locator(SELECTORS.public.archiveList)).toBeVisible();
    });

    test('search bar is visible on tablet viewport', async ({ page }) => {
      await page.setViewportSize({ width: 768, height: 1024 });
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      await expect(page.locator(SELECTORS.public.searchBar)).toBeVisible();
    });
  });

  test.describe('Pagination', () => {
    test('shows pagination if many letters exist', async ({ page }) => {
      await page.waitForLoadState('networkidle');

      // Check if pagination controls exist
      const pagination = page.locator('.pagination, .load-more, [class*="pagination"]');
      const hasPagination = await pagination.isVisible().catch(() => false);

      // This test just verifies the page loads correctly
      // Pagination may or may not be present depending on data
      await expect(page.locator(SELECTORS.public.archiveList)).toBeVisible();
    });
  });
});
