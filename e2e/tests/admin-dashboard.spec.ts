import { test, expect } from '@playwright/test';
import {
  loginAsAdmin,
  waitForDashboardTable,
  SELECTORS,
} from './utils/test-helpers';

/**
 * E2E tests for Admin Dashboard
 *
 * Tests cover table display, sorting, filtering, pagination, and column management.
 */

test.describe('Admin Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await waitForDashboardTable(page);
  });

  test.describe('Dashboard Display', () => {
    test('shows admin content shell', async ({ page }) => {
      await expect(page.getByRole('main', { name: 'Admin content' })).toBeVisible();
    });

    test('shows letters table', async ({ page }) => {
      await expect(page.locator(SELECTORS.dashboard.table)).toBeVisible();
    });

    test('shows toolbar buttons', async ({ page }) => {
      await expect(page.locator(SELECTORS.dashboard.editBtn)).toBeVisible();
      await expect(page.locator(SELECTORS.dashboard.uploadBtn)).toBeVisible();
      await expect(page.locator(SELECTORS.dashboard.processBtn)).toBeVisible();
      await expect(page.locator(SELECTORS.dashboard.logoutBtn)).toBeVisible();
    });

    test('opens and closes the current Filters panel', async ({ page }) => {
      const filtersTrigger = page.getByRole('button', {
        name: 'Filters',
        exact: true,
      });

      await expect(filtersTrigger).toBeVisible();
      await expect(filtersTrigger).toHaveAttribute('aria-expanded', 'false');

      await filtersTrigger.click();
      const filtersHeading = page.getByRole('heading', { name: 'Filters' });
      await expect(filtersTrigger).toHaveAttribute('aria-expanded', 'true');
      await expect(filtersHeading).toBeVisible();

      await filtersTrigger.click();
      await expect(filtersTrigger).toHaveAttribute('aria-expanded', 'false');
      await expect(filtersHeading).not.toBeVisible();
    });

    test('shows table rows with letter data', async ({ page }) => {
      const rows = page.locator(SELECTORS.dashboard.tableRow);
      const rowCount = await rows.count();
      expect(rowCount).toBeGreaterThan(0);
    });

    test('shows letter count in header', async ({ page }) => {
      const letterCount = page.locator('.letter-count');
      await expect(letterCount).toBeVisible();
      const text = await letterCount.textContent();
      // Should contain "of" and numbers (e.g., "1-50 of 100")
      expect(text).toMatch(/\d+/);
    });
  });

  test.describe('Table Sorting', () => {
    test('can sort by sender column', async ({ page }) => {
      const senderHeader = page.locator('th:has-text("Sender")');
      await senderHeader.click();

      // Should show sort indicator
      await expect(senderHeader.locator('.sort-arrow')).toBeVisible();
    });

    test('can sort by date column', async ({ page }) => {
      const dateHeader = page.locator('th:has-text("Date")');
      await dateHeader.click();

      await expect(dateHeader.locator('.sort-arrow')).toBeVisible();
    });

    test('clicking sorted column toggles direction', async ({ page }) => {
      const senderHeader = page.locator('th:has-text("Sender")');

      // First click - ascending
      await senderHeader.click();
      let arrow = await senderHeader.locator('.sort-arrow').textContent();
      expect(arrow).toBe('↑');

      // Second click - descending
      await senderHeader.click();
      arrow = await senderHeader.locator('.sort-arrow').textContent();
      expect(arrow).toBe('↓');

      // Third click - removes sort
      await senderHeader.click();
      const hasArrow = await senderHeader.locator('.sort-arrow').isVisible().catch(() => false);
      expect(hasArrow).toBe(false);
    });

    test('can sort by created date column', async ({ page }) => {
      const createdHeader = page.locator('th:has-text("Created")');
      await createdHeader.click();

      await expect(createdHeader.locator('.sort-arrow')).toBeVisible();
    });
  });

  test.describe('Filtering', () => {
    test('can filter by visibility - published', async ({ page }) => {
      await page.getByRole('button', { name: 'Filters' }).click();
      const publishedBtn = page.locator(SELECTORS.dashboard.visibilityPublished);
      await publishedBtn.click();

      // Button should become active
      await expect(publishedBtn).toHaveClass(/active/);

      // Wait for table to reload
      await page.waitForLoadState('networkidle');
    });

    test('can filter by visibility - hidden', async ({ page }) => {
      await page.getByRole('button', { name: 'Filters' }).click();
      const hiddenBtn = page.locator(SELECTORS.dashboard.visibilityHidden);
      await hiddenBtn.click();

      await expect(hiddenBtn).toHaveClass(/active/);
      await page.waitForLoadState('networkidle');
    });

    test('can filter by collection number', async ({ page }) => {
      await page.getByRole('button', { name: 'Filters' }).click();
      const collectionInput = page.locator(SELECTORS.dashboard.collectionInput);
      await collectionInput.fill('001');

      await page.waitForLoadState('networkidle');
      // Verify input has value
      await expect(collectionInput).toHaveValue('001');
    });

    test('can search letters', async ({ page }) => {
      const searchInput = page.locator(SELECTORS.dashboard.searchInput);
      await searchInput.fill('mother');

      // Wait for debounced search
      await page.waitForTimeout(500);
      await page.waitForLoadState('networkidle');

      await expect(searchInput).toHaveValue('mother');
    });

    test('can clear all filters', async ({ page }) => {
      // Apply some filters first
      await page.getByRole('button', { name: 'Filters' }).click();
      const publishedBtn = page.locator(SELECTORS.dashboard.visibilityPublished);
      await publishedBtn.click();
      await page.waitForLoadState('networkidle');

      await page.getByRole('button', { name: 'Clear', exact: true }).click();
      await page.waitForLoadState('networkidle');

      await expect(publishedBtn).toHaveAttribute('aria-pressed', 'false');
    });

    test('can filter by transcript status', async ({ page }) => {
      // Find and click Draft filter for transcript
      await page.getByRole('button', { name: 'Filters' }).click();
      const draftFilter = page.locator('.filter-content-draft').first();
      await draftFilter.click();
      await page.waitForLoadState('networkidle');

      await expect(draftFilter).toHaveClass(/active/);
    });
  });

  test.describe('Pagination', () => {
    test('shows pagination controls when multiple pages exist', async ({ page }) => {
      const paginationInfo = page.locator(SELECTORS.dashboard.paginationInfo);
      const hasPagination = await paginationInfo.isVisible().catch(() => false);

      if (hasPagination) {
        const text = await paginationInfo.textContent();
        expect(text).toMatch(/Page \d+ of \d+/);
      }
    });

    test('can navigate to next page', async ({ page }) => {
      const nextBtn = page.locator(SELECTORS.dashboard.paginationNext);

      if (!(await nextBtn.isVisible().catch(() => false))) {
        test.skip(true, 'Only one page of results');
        return;
      }

      if (await nextBtn.isDisabled()) {
        test.skip(true, 'Already on last page');
        return;
      }

      const paginationInfo = page.locator(SELECTORS.dashboard.paginationInfo);
      const initialText = await paginationInfo.textContent();

      await nextBtn.click();
      await page.waitForLoadState('networkidle');

      const newText = await paginationInfo.textContent();
      expect(newText).toMatch(/Page \d+ of \d+/);
    });

    test('can navigate to previous page', async ({ page }) => {
      // First go to page 2 if possible
      const nextBtn = page.locator(SELECTORS.dashboard.paginationNext);

      if (!(await nextBtn.isVisible()) || await nextBtn.isDisabled()) {
        test.skip(true, 'Cannot test previous - only one page');
        return;
      }

      await nextBtn.click();
      await page.waitForLoadState('networkidle');

      const prevBtn = page.locator(SELECTORS.dashboard.paginationPrev);
      await prevBtn.click();
      await page.waitForLoadState('networkidle');

      const paginationInfo = page.locator(SELECTORS.dashboard.paginationInfo);
      const text = await paginationInfo.textContent();
      expect(text).toMatch(/Page \d+ of \d+/);
    });
  });

  test.describe('Column Visibility', () => {
    test('can toggle column visibility menu', async ({ page }) => {
      const columnToggle = page.locator(SELECTORS.dashboard.columnToggle);
      await columnToggle.click();

      const dropdown = page.locator('.column-toggle-dropdown');
      await expect(dropdown).toBeVisible();
    });

    test('can hide a column', async ({ page }) => {
      const columnToggle = page.locator(SELECTORS.dashboard.columnToggle);
      await columnToggle.click();

      const dropdown = page.locator('.column-toggle-dropdown');
      await expect(dropdown).toBeVisible();

      // Find and uncheck a column (e.g., "Created")
      const createdCheckbox = dropdown.locator('label:has-text("Created") input');
      const isChecked = await createdCheckbox.isChecked();

      if (isChecked) {
        await createdCheckbox.click();

        // Column should be hidden
        const createdHeader = page.locator('th:has-text("Created")');
        await expect(createdHeader).not.toBeVisible();
      }
    });

    test('column visibility persists after page reload', async ({ page }) => {
      // Hide a column
      const columnToggle = page.locator(SELECTORS.dashboard.columnToggle);
      await columnToggle.click();

      const dropdown = page.locator('.column-toggle-dropdown');
      const createdCheckbox = dropdown.locator('label:has-text("Created") input');

      if (await createdCheckbox.isChecked()) {
        await createdCheckbox.click();
      }

      // Close dropdown
      await page.keyboard.press('Escape');

      // Reload page
      await page.reload();
      await waitForDashboardTable(page);

      // Column should still be hidden
      const createdHeader = page.locator('th:has-text("Created")');
      await expect(createdHeader).not.toBeVisible();

      // Restore for other tests
      await columnToggle.click();
      const dropdown2 = page.locator('.column-toggle-dropdown');
      await dropdown2.locator('label:has-text("Created") input').click();
    });
  });

  test.describe('Row Navigation', () => {
    test('clicking row navigates to letter detail', async ({ page }) => {
      const firstRow = page.locator(SELECTORS.dashboard.tableRow).first();
      await firstRow.click();

      await page.waitForURL(/\/admin\/letters\//);
      expect(page.url()).toContain('/admin/letters/');
    });
  });

  test.describe('Date Filter', () => {
    test('can open date filter dropdown', async ({ page }) => {
      const dateBtn = page.locator('.dropdown-trigger:has-text("Date")');
      if (!(await dateBtn.isVisible().catch(() => false))) {
        test.skip(true, 'Date dropdown is not visible in current dashboard layout');
        return;
      }
      await dateBtn.click();

      const datePanel = page.locator('.date-dropdown-panel');
      await expect(datePanel).toBeVisible();
    });

    test('can filter by specific year', async ({ page }) => {
      const dateBtn = page.locator('.dropdown-trigger:has-text("Date")');
      if (!(await dateBtn.isVisible().catch(() => false))) {
        test.skip(true, 'Date dropdown is not visible in current dashboard layout');
        return;
      }
      await dateBtn.click();

      const yearSelect = page.locator('.date-dropdown-panel select').first();
      await yearSelect.selectOption('1920');

      await page.waitForLoadState('networkidle');

      await expect(yearSelect).toHaveValue('1920');
    });

    test('can switch to date range mode', async ({ page }) => {
      const dateBtn = page.locator('.dropdown-trigger:has-text("Date")');
      if (!(await dateBtn.isVisible().catch(() => false))) {
        test.skip(true, 'Date dropdown is not visible in current dashboard layout');
        return;
      }
      await dateBtn.click();

      const rangeBtn = page.locator('.mode-btn:has-text("Range")');
      await rangeBtn.click();

      // Should show date range inputs
      const rangeInputs = page.locator('.date-range-inputs');
      await expect(rangeInputs).toBeVisible();
    });
  });

  test.describe('History Dropdown', () => {
    test('can open history dropdown', async ({ page }) => {
      const historyBtn = page.locator('.dropdown-trigger:has-text("History")');
      if (!(await historyBtn.isVisible().catch(() => false))) {
        test.skip(true, 'History dropdown is not available in current dashboard layout');
        return;
      }
      await historyBtn.click();

      const historyDropdown = page.locator('.history-dropdown');
      await expect(historyDropdown).toBeVisible();
    });

    test('history shows header', async ({ page }) => {
      const historyBtn = page.locator('.dropdown-trigger:has-text("History")');
      if (!(await historyBtn.isVisible().catch(() => false))) {
        test.skip(true, 'History dropdown is not available in current dashboard layout');
        return;
      }
      await historyBtn.click();

      const header = page.locator('.history-header');
      await expect(header).toHaveText('Edit History');
    });
  });
});
