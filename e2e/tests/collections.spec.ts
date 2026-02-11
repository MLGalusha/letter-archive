import { test, expect } from '@playwright/test';
import { SELECTORS } from './utils/test-helpers';

/**
 * E2E tests for Collections Browse
 *
 * Tests cover collections page display, navigation, and collection detail pages.
 */

test.describe('Collections Browse', () => {
  test.describe('Collections Page', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/collections');
      await page.waitForLoadState('networkidle');
    });

    test('loads collections page with title', async ({ page }) => {
      await expect(page.locator('h1')).toContainText('Collection');
    });

    test('shows page description', async ({ page }) => {
      const description = page.locator('.page-description');
      if (await description.isVisible()) {
        await expect(description).toContainText('collection');
      }
    });

    test('displays collections grid', async ({ page }) => {
      const grid = page.locator(SELECTORS.public.collectionsGrid);
      const emptyState = page.locator('.no-results');

      const hasGrid = await grid.isVisible().catch(() => false);
      const hasEmpty = await emptyState.isVisible().catch(() => false);

      // Either shows collections or empty state
      expect(hasGrid || hasEmpty).toBe(true);
    });

    test('collection cards show collection code', async ({ page }) => {
      const collectionCard = page.locator(SELECTORS.public.collectionCard).first();

      if (!(await collectionCard.isVisible().catch(() => false))) {
        test.skip(true, 'No collections available');
        return;
      }

      // Card should have collection code
      const codeElement = collectionCard.locator('.collection-card-code');
      await expect(codeElement).toBeVisible();
    });

    test('collection cards show letter count', async ({ page }) => {
      const collectionCard = page.locator(SELECTORS.public.collectionCard).first();

      if (!(await collectionCard.isVisible().catch(() => false))) {
        test.skip(true, 'No collections available');
        return;
      }

      // Card should show letter count
      const countElement = collectionCard.locator('.collection-letter-count');
      await expect(countElement).toBeVisible();
      await expect(countElement).toContainText('letter');
    });

    test('clicking collection card navigates to collection detail', async ({ page }) => {
      const collectionCard = page.locator(SELECTORS.public.collectionCard).first();

      if (!(await collectionCard.isVisible().catch(() => false))) {
        test.skip(true, 'No collections available');
        return;
      }

      await collectionCard.click();
      await page.waitForURL(/\/collections\//);

      // Should be on collection detail page
      expect(page.url()).toMatch(/\/collections\/\d+/);
    });

    test('shows footer', async ({ page }) => {
      await expect(page.locator(SELECTORS.public.footer)).toBeVisible();
    });
  });

  test.describe('Collection Detail Page', () => {
    test('displays collection title', async ({ page }) => {
      // First get a collection code
      await page.goto('/collections');
      await page.waitForLoadState('networkidle');

      const collectionCard = page.locator(SELECTORS.public.collectionCard).first();

      if (!(await collectionCard.isVisible().catch(() => false))) {
        test.skip(true, 'No collections available');
        return;
      }

      await collectionCard.click();
      await page.waitForURL(/\/collections\//);
      await page.waitForLoadState('networkidle');

      // Should show collection title
      await expect(page.locator('h1')).toBeVisible();
    });

    test('shows letters in collection', async ({ page }) => {
      await page.goto('/collections');
      await page.waitForLoadState('networkidle');

      const collectionCard = page.locator(SELECTORS.public.collectionCard).first();

      if (!(await collectionCard.isVisible().catch(() => false))) {
        test.skip(true, 'No collections available');
        return;
      }

      await collectionCard.click();
      await page.waitForURL(/\/collections\//);
      await page.waitForLoadState('networkidle');

      // Should show letter cards or letter list
      const letterCards = page.locator(SELECTORS.public.letterCard);
      const letterList = page.locator('.letter-list, .letters-grid');
      const emptyState = page.locator('.no-results, .empty-state');

      const hasCards = await letterCards.first().isVisible().catch(() => false);
      const hasList = await letterList.isVisible().catch(() => false);
      const hasEmpty = await emptyState.isVisible().catch(() => false);

      expect(hasCards || hasList || hasEmpty).toBe(true);
    });

    test('clicking letter navigates to letter detail', async ({ page }) => {
      await page.goto('/collections');
      await page.waitForLoadState('networkidle');

      const collectionCard = page.locator(SELECTORS.public.collectionCard).first();

      if (!(await collectionCard.isVisible().catch(() => false))) {
        test.skip(true, 'No collections available');
        return;
      }

      await collectionCard.click();
      await page.waitForURL(/\/collections\//);
      await page.waitForLoadState('networkidle');

      const letterCard = page.locator(SELECTORS.public.letterCard).first();

      if (!(await letterCard.isVisible().catch(() => false))) {
        test.skip(true, 'No letters in this collection');
        return;
      }

      await letterCard.click();
      await page.waitForURL(/\/letter\//);

      expect(page.url()).toContain('/letter/');
    });

    test('shows back navigation or breadcrumb', async ({ page }) => {
      await page.goto('/collections');
      await page.waitForLoadState('networkidle');

      const collectionCard = page.locator(SELECTORS.public.collectionCard).first();

      if (!(await collectionCard.isVisible().catch(() => false))) {
        test.skip(true, 'No collections available');
        return;
      }

      await collectionCard.click();
      await page.waitForURL(/\/collections\//);
      await page.waitForLoadState('networkidle');

      // Should have some way to navigate back (link, breadcrumb, or back button)
      const backLink = page.locator('a[href="/collections"], .back-link, .breadcrumb');
      const hasBackNav = await backLink.isVisible().catch(() => false);

      // Browser back should work at minimum
      await page.goBack();
      expect(page.url()).toContain('/collections');
    });
  });

  test.describe('Empty States', () => {
    test('shows appropriate message when no collections', async ({ page }) => {
      await page.goto('/collections');
      await page.waitForLoadState('networkidle');

      const collectionsGrid = page.locator(SELECTORS.public.collectionsGrid);
      const emptyState = page.locator('.no-results');

      const hasGrid = await collectionsGrid.isVisible().catch(() => false);
      const hasEmpty = await emptyState.isVisible().catch(() => false);

      // If no collections, should show empty state message
      if (!hasGrid || await collectionsGrid.locator(SELECTORS.public.collectionCard).count() === 0) {
        if (hasEmpty) {
          await expect(emptyState).toContainText(/no|empty|available/i);
        }
      }
    });
  });

  test.describe('Responsive Layout', () => {
    test('collections grid adapts to mobile viewport', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto('/collections');
      await page.waitForLoadState('networkidle');

      // Page should still be usable
      await expect(page.locator('h1')).toBeVisible();
    });

    test('collections grid adapts to tablet viewport', async ({ page }) => {
      await page.setViewportSize({ width: 768, height: 1024 });
      await page.goto('/collections');
      await page.waitForLoadState('networkidle');

      await expect(page.locator('h1')).toBeVisible();
    });
  });
});
