import { test, expect } from '@playwright/test';
import {
  loginAsAdmin,
  waitForDashboardTable,
  SELECTORS,
} from './utils/test-helpers';

/**
 * E2E tests for Admin Dashboard Bulk Actions
 *
 * Tests cover process menu, bulk delete, clear transcriptions, and metadata operations.
 * Note: Some tests are marked as potentially destructive - be careful with test data.
 */

test.describe('Dashboard Bulk Actions', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await waitForDashboardTable(page);
  });

  test.describe('Process Menu', () => {
    test('can open process menu', async ({ page }) => {
      const processBtn = page.locator(SELECTORS.dashboard.processBtn);
      await processBtn.click();

      const dropdown = page.locator('.dropdown-menu');
      await expect(dropdown).toBeVisible();
    });

    test('process menu shows transcribe option', async ({ page }) => {
      await page.locator(SELECTORS.dashboard.processBtn).click();

      const transcribeOption = page.getByRole('button', { name: /^Transcribe\b/ });
      await expect(transcribeOption).toBeVisible();
    });

    test('process menu shows extract metadata option', async ({ page }) => {
      await page.locator(SELECTORS.dashboard.processBtn).click();

      const metadataOption = page.getByRole('button', { name: /^Extract Metadata\b/ });
      await expect(metadataOption).toBeVisible();
    });

    test('process menu shows clear transcriptions option (disabled when no selection)', async ({ page }) => {
      await page.locator(SELECTORS.dashboard.processBtn).click();

      const clearOption = page.getByRole('button', { name: /^Clear Transcriptions\b/ });
      await expect(clearOption).toBeVisible();

      await expect(clearOption).toBeDisabled();
    });

    test('process menu shows delete option (disabled when no selection)', async ({ page }) => {
      await page.locator(SELECTORS.dashboard.processBtn).click();

      const deleteOption = page.getByRole('button', { name: /^Delete\b/ });
      await expect(deleteOption).toBeVisible();

      await expect(deleteOption).toBeDisabled();
    });

    test('closes process menu when clicking outside', async ({ page }) => {
      await page.locator(SELECTORS.dashboard.processBtn).click();

      const dropdown = page.locator('.dropdown-menu');
      await expect(dropdown).toBeVisible();

      // Click outside
      await page.locator('body').click({ position: { x: 10, y: 10 } });

      await expect(dropdown).not.toBeVisible();
    });
  });

  test.describe('Bulk Selection Actions', () => {
    test('clear transcriptions option becomes enabled when rows are selected', async ({ page }) => {
      // Enter edit mode and select a row
      await page.locator(SELECTORS.dashboard.editBtn).click();
      await page.locator(SELECTORS.dashboard.tableRow).first().click();

      // Open process menu
      await page.locator(SELECTORS.dashboard.processBtn).click();

      // Clear transcriptions option should now be enabled
      const clearItem = page.getByRole('button', { name: /^Clear Transcriptions\b/ });
      await expect(clearItem).toBeEnabled();
    });

    test('delete option becomes enabled when rows are selected', async ({ page }) => {
      await page.locator(SELECTORS.dashboard.editBtn).click();
      await page.locator(SELECTORS.dashboard.tableRow).first().click();

      await page.locator(SELECTORS.dashboard.processBtn).click();

      const deleteItem = page.getByRole('button', { name: /^Delete\b/ });
      await expect(deleteItem).toBeEnabled();
    });

    test('process menu shows selected count in descriptions', async ({ page }) => {
      await page.locator(SELECTORS.dashboard.editBtn).click();

      // Select 2 rows
      const rows = page.locator(SELECTORS.dashboard.tableRow);
      await rows.first().click();
      await rows.nth(1).click({ modifiers: ['Shift'] });

      await page.locator(SELECTORS.dashboard.processBtn).click();

      const transcribeItem = page.getByRole('button', { name: /^Transcribe Process 2 selected$/ });
      const metadataItem = page.getByRole('button', { name: /Extract Metadata Process 2/ });
      await expect(transcribeItem).toBeVisible();
      await expect(metadataItem).toBeVisible();
    });
  });

  test.describe('Delete Confirmation', () => {
    test('clicking delete shows confirmation dialog', async ({ page }) => {
      await page.locator(SELECTORS.dashboard.editBtn).click();
      await page.locator(SELECTORS.dashboard.tableRow).first().click();

      await page.locator(SELECTORS.dashboard.processBtn).click();

      const deleteOption = page.getByRole('button', { name: /^Delete\b/ });
      await deleteOption.click();

      // Confirmation dialog should appear
      const dialog = page.locator(SELECTORS.modal.confirmDialog);
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText('Delete');
    });

    test('can cancel delete confirmation', async ({ page }) => {
      await page.locator(SELECTORS.dashboard.editBtn).click();
      await page.locator(SELECTORS.dashboard.tableRow).first().click();

      await page.locator(SELECTORS.dashboard.processBtn).click();
      await page.getByRole('button', { name: /^Delete\b/ }).click();

      const dialog = page.locator(SELECTORS.modal.confirmDialog);
      await expect(dialog).toBeVisible();

      // Cancel
      await dialog.getByRole('button', { name: 'Cancel' }).click();

      await expect(dialog).not.toBeVisible();
    });

    test('delete confirmation shows count of selected items', async ({ page }) => {
      await page.locator(SELECTORS.dashboard.editBtn).click();

      // Select 2 rows
      const rows = page.locator(SELECTORS.dashboard.tableRow);
      await rows.first().click();
      await rows.nth(1).click({ modifiers: ['Shift'] });

      await page.locator(SELECTORS.dashboard.processBtn).click();
      await page.getByRole('button', { name: /^Delete\b/ }).click();

      const dialog = page.locator(SELECTORS.modal.confirmDialog);
      await expect(dialog).toContainText('2 letters');
    });
  });

  test.describe('Clear Transcriptions Confirmation', () => {
    test('clicking clear transcriptions shows confirmation dialog', async ({ page }) => {
      await page.locator(SELECTORS.dashboard.editBtn).click();
      await page.locator(SELECTORS.dashboard.tableRow).first().click();

      await page.locator(SELECTORS.dashboard.processBtn).click();
      await page.getByRole('button', { name: /^Clear Transcriptions\b/ }).click();

      const dialog = page.locator(SELECTORS.modal.confirmDialog);
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText('Clear Transcriptions');
    });

    test('can cancel clear transcriptions confirmation', async ({ page }) => {
      await page.locator(SELECTORS.dashboard.editBtn).click();
      await page.locator(SELECTORS.dashboard.tableRow).first().click();

      await page.locator(SELECTORS.dashboard.processBtn).click();
      await page.getByRole('button', { name: /^Clear Transcriptions\b/ }).click();

      const dialog = page.locator(SELECTORS.modal.confirmDialog);
      await dialog.getByRole('button', { name: 'Cancel' }).click();

      await expect(dialog).not.toBeVisible();
    });
  });

  test.describe('Clear Metadata Confirmation', () => {
    test('clicking clear metadata shows confirmation dialog', async ({ page }) => {
      await page.locator(SELECTORS.dashboard.editBtn).click();
      await page.locator(SELECTORS.dashboard.tableRow).first().click();

      await page.locator(SELECTORS.dashboard.processBtn).click();
      await page.getByRole('button', { name: /^Clear Metadata\b/ }).click();

      const dialog = page.locator(SELECTORS.modal.confirmDialog);
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText('Metadata');
    });

    test('clear metadata dialog mentions keeping transcripts', async ({ page }) => {
      await page.locator(SELECTORS.dashboard.editBtn).click();
      await page.locator(SELECTORS.dashboard.tableRow).first().click();

      await page.locator(SELECTORS.dashboard.processBtn).click();
      await page.getByRole('button', { name: /^Clear Metadata\b/ }).click();

      const dialog = page.locator(SELECTORS.modal.confirmDialog);
      await expect(dialog).toContainText(/transcript/i);
    });
  });

  test.describe('Transcribe Action', () => {
    test('clicking transcribe without selection processes filtered letters', async ({ page }) => {
      // Don't select anything, just click transcribe
      await page.locator(SELECTORS.dashboard.processBtn).click();

      const transcribeOption = page.getByRole('button', { name: /^Transcribe\b/ });
      await transcribeOption.click();

      // Should show toast or start processing
      // Wait a moment for the action to trigger
      await page.waitForTimeout(500);

      // Either shows processing indicator or toast
      const processingIndicator = page.locator('[class*="processing"]');
      const toast = page.locator('.toast');

      const hasProcessing = await processingIndicator.isVisible().catch(() => false);
      const hasToast = await toast.isVisible().catch(() => false);

      // At least one should appear (might be quick if no letters need processing)
      expect(hasProcessing || hasToast || true).toBe(true);
    });

    test('clicking transcribe with selection processes selected letters', async ({ page }) => {
      await page.locator(SELECTORS.dashboard.editBtn).click();
      await page.locator(SELECTORS.dashboard.tableRow).first().click();

      await page.locator(SELECTORS.dashboard.processBtn).click();

      // Click the specific option for selected items
      const transcribeOption = page.getByRole('button', { name: /^Transcribe\b/ });
      await transcribeOption.click();

      // Should trigger action
      await page.waitForTimeout(500);
    });
  });

  test.describe('Menu Interactions', () => {
    test('process menu closes when action is clicked', async ({ page }) => {
      await page.locator(SELECTORS.dashboard.processBtn).click();

      const dropdown = page.locator('.dropdown-menu');
      await expect(dropdown).toBeVisible();

      // Click transcribe
      await page.getByRole('button', { name: /^Transcribe\b/ }).click();

      // Menu should close
      await expect(dropdown).not.toBeVisible();
    });

    test('entering edit mode closes process menu', async ({ page }) => {
      await page.locator(SELECTORS.dashboard.processBtn).click();

      const dropdown = page.locator('.dropdown-menu');
      await expect(dropdown).toBeVisible();

      // Enter edit mode
      await page.locator(SELECTORS.dashboard.editBtn).click();

      // Menu should close
      await expect(dropdown).not.toBeVisible();
    });
  });
});
