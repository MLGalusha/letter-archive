import { test, expect } from '@playwright/test';
import {
  loginAsAdmin,
  waitForDashboardTable,
  SELECTORS,
} from './utils/test-helpers';

/**
 * E2E tests for Admin Dashboard Edit Mode
 *
 * Tests cover row selection, drag selection, copy-paste editing, and bulk selection.
 */

test.describe('Dashboard Edit Mode', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await waitForDashboardTable(page);
  });

  test.describe('Enter/Exit Edit Mode', () => {
    test('can enter edit mode', async ({ page }) => {
      const editBtn = page.locator(SELECTORS.dashboard.editBtn);
      await editBtn.click();

      // Should show edit toolbar
      await expect(page.locator(SELECTORS.dashboard.editToolbar)).toBeVisible();

      // Button should show "Exit Edit"
      await expect(editBtn).toContainText('Exit Edit');
    });

    test('can exit edit mode', async ({ page }) => {
      // Enter edit mode
      const editBtn = page.locator(SELECTORS.dashboard.editBtn);
      await editBtn.click();
      await expect(page.locator(SELECTORS.dashboard.editToolbar)).toBeVisible();

      // Exit edit mode
      await editBtn.click();
      await expect(page.locator(SELECTORS.dashboard.editToolbar)).not.toBeVisible();

      // Button should show "Edit"
      await expect(editBtn).toContainText('Edit');
    });

    test('can exit edit mode via cancel button', async ({ page }) => {
      const editBtn = page.locator(SELECTORS.dashboard.editBtn);
      await editBtn.click();

      const cancelBtn = page.locator(SELECTORS.dashboard.cancelBtn);
      await cancelBtn.click();

      await expect(page.locator(SELECTORS.dashboard.editToolbar)).not.toBeVisible();
    });
  });

  test.describe('Row Selection', () => {
    test('clicking row in edit mode selects it', async ({ page }) => {
      // Enter edit mode
      await page.locator(SELECTORS.dashboard.editBtn).click();

      const firstRow = page.locator(SELECTORS.dashboard.tableRow).first();
      await firstRow.click();

      // Row should be selected
      await expect(firstRow).toHaveClass(/selected/);
    });

    test('clicking selected row deselects it', async ({ page }) => {
      await page.locator(SELECTORS.dashboard.editBtn).click();

      const firstRow = page.locator(SELECTORS.dashboard.tableRow).first();
      await firstRow.click();
      await expect(firstRow).toHaveClass(/selected/);

      await firstRow.click();
      await expect(firstRow).not.toHaveClass(/selected/);
    });

    test('shift-click selects range of rows', async ({ page }) => {
      await page.locator(SELECTORS.dashboard.editBtn).click();

      const rows = page.locator(SELECTORS.dashboard.tableRow);
      const rowCount = await rows.count();

      if (rowCount < 3) {
        test.skip(true, 'Not enough rows for range selection test');
        return;
      }

      // Click first row
      await rows.first().click();

      // Shift-click third row
      await rows.nth(2).click({ modifiers: ['Shift'] });

      // All three rows should be selected
      await expect(rows.nth(0)).toHaveClass(/selected/);
      await expect(rows.nth(1)).toHaveClass(/selected/);
      await expect(rows.nth(2)).toHaveClass(/selected/);
    });

    test('selection count updates in toolbar', async ({ page }) => {
      await page.locator(SELECTORS.dashboard.editBtn).click();

      const selectionCount = page.locator('.toolbar-selection-count');
      await expect(selectionCount).toContainText('0 selected');

      const firstRow = page.locator(SELECTORS.dashboard.tableRow).first();
      await firstRow.click();

      await expect(selectionCount).toContainText('1 selected');
    });
  });

  test.describe('Drag Selection', () => {
    test('can drag to select multiple rows', async ({ page }) => {
      await page.locator(SELECTORS.dashboard.editBtn).click();

      const rows = page.locator(SELECTORS.dashboard.tableRow);
      const rowCount = await rows.count();

      if (rowCount < 3) {
        test.skip(true, 'Not enough rows for drag selection test');
        return;
      }

      // Get bounding boxes
      const firstRowBox = await rows.first().boundingBox();
      const thirdRowBox = await rows.nth(2).boundingBox();

      if (!firstRowBox || !thirdRowBox) {
        test.skip(true, 'Could not get row bounding boxes');
        return;
      }

      // Drag from first row to third row
      await page.mouse.move(firstRowBox.x + 50, firstRowBox.y + firstRowBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(thirdRowBox.x + 50, thirdRowBox.y + thirdRowBox.height / 2);
      await page.mouse.up();

      // Multiple rows should be selected
      const selectedCount = await rows.filter({ hasClass: 'selected' }).count();
      expect(selectedCount).toBeGreaterThanOrEqual(2);
    });

    test('drag selection respects initial row state', async ({ page }) => {
      await page.locator(SELECTORS.dashboard.editBtn).click();

      const rows = page.locator(SELECTORS.dashboard.tableRow);

      // First, select first row
      await rows.first().click();
      await expect(rows.first()).toHaveClass(/selected/);

      // Now drag starting from selected row (should deselect)
      const firstRowBox = await rows.first().boundingBox();
      const secondRowBox = await rows.nth(1).boundingBox();

      if (!firstRowBox || !secondRowBox) {
        test.skip(true, 'Could not get row bounding boxes');
        return;
      }

      await page.mouse.move(firstRowBox.x + 50, firstRowBox.y + firstRowBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(secondRowBox.x + 50, secondRowBox.y + secondRowBox.height / 2);
      await page.mouse.up();

      // First row should now be deselected
      await expect(rows.first()).not.toHaveClass(/selected/);
    });
  });

  test.describe('Copy Mode', () => {
    test('can activate copy mode', async ({ page }) => {
      await page.locator(SELECTORS.dashboard.editBtn).click();

      const copyModeBtn = page.locator(SELECTORS.dashboard.copyModeBtn);
      await copyModeBtn.click();

      await expect(copyModeBtn).toHaveClass(/active/);
    });

    test('copy mode shows hint text', async ({ page }) => {
      await page.locator(SELECTORS.dashboard.editBtn).click();
      await page.locator(SELECTORS.dashboard.copyModeBtn).click();

      const hint = page.locator('.toolbar-hint');
      await expect(hint).toContainText('Click a Sender or Recipient');
    });

    test('clicking cell in copy mode selects it as source', async ({ page }) => {
      await page.locator(SELECTORS.dashboard.editBtn).click();
      await page.locator(SELECTORS.dashboard.copyModeBtn).click();

      // Click on first sender cell
      const senderCell = page.locator('table tbody tr:first-child td:first-child');
      await senderCell.click();

      // Cell should become source
      await expect(senderCell).toHaveClass(/source-cell/);

      // Hint should update
      const hint = page.locator('.toolbar-hint');
      await expect(hint).toContainText('Copying');
    });

    test('clicking another cell pastes the copied value', async ({ page }) => {
      await page.locator(SELECTORS.dashboard.editBtn).click();
      await page.locator(SELECTORS.dashboard.copyModeBtn).click();

      const rows = page.locator(SELECTORS.dashboard.tableRow);
      const rowCount = await rows.count();

      if (rowCount < 2) {
        test.skip(true, 'Not enough rows for copy-paste test');
        return;
      }

      // Click first row sender cell as source
      const firstSenderCell = rows.first().locator('td').first();
      await firstSenderCell.click();

      // Click second row sender cell as target
      const secondSenderCell = rows.nth(1).locator('td').first();
      await secondSenderCell.click();

      // Second cell should show as changed
      await expect(secondSenderCell).toHaveClass(/changed-cell/);

      // Changes count should show
      const changesCount = page.locator('.toolbar-changes');
      await expect(changesCount).toContainText('1 change');
    });

    test('clicking changed cell again removes the change', async ({ page }) => {
      await page.locator(SELECTORS.dashboard.editBtn).click();
      await page.locator(SELECTORS.dashboard.copyModeBtn).click();

      const rows = page.locator(SELECTORS.dashboard.tableRow);

      if (await rows.count() < 2) {
        test.skip(true, 'Not enough rows');
        return;
      }

      // Copy first cell to second
      await rows.first().locator('td').first().click();
      const secondCell = rows.nth(1).locator('td').first();
      await secondCell.click();

      await expect(secondCell).toHaveClass(/changed-cell/);

      // Click again to undo
      await secondCell.click();
      await expect(secondCell).not.toHaveClass(/changed-cell/);
    });

    test('can deactivate copy mode', async ({ page }) => {
      await page.locator(SELECTORS.dashboard.editBtn).click();

      const copyModeBtn = page.locator(SELECTORS.dashboard.copyModeBtn);
      await copyModeBtn.click();
      await expect(copyModeBtn).toHaveClass(/active/);

      await copyModeBtn.click();
      await expect(copyModeBtn).not.toHaveClass(/active/);
    });
  });

  test.describe('Save Changes', () => {
    test('save button is disabled when no changes', async ({ page }) => {
      await page.locator(SELECTORS.dashboard.editBtn).click();

      const saveBtn = page.locator(SELECTORS.dashboard.saveChangesBtn);
      await expect(saveBtn).toBeDisabled();
    });

    test('save button is enabled when changes exist', async ({ page }) => {
      await page.locator(SELECTORS.dashboard.editBtn).click();
      await page.locator(SELECTORS.dashboard.copyModeBtn).click();

      const rows = page.locator(SELECTORS.dashboard.tableRow);

      if (await rows.count() < 2) {
        test.skip(true, 'Not enough rows');
        return;
      }

      // Make a change
      await rows.first().locator('td').first().click();
      await rows.nth(1).locator('td').first().click();

      const saveBtn = page.locator(SELECTORS.dashboard.saveChangesBtn);
      await expect(saveBtn).not.toBeDisabled();
    });

    test('exiting edit mode discards unsaved changes', async ({ page }) => {
      await page.locator(SELECTORS.dashboard.editBtn).click();
      await page.locator(SELECTORS.dashboard.copyModeBtn).click();

      const rows = page.locator(SELECTORS.dashboard.tableRow);

      if (await rows.count() < 2) {
        test.skip(true, 'Not enough rows');
        return;
      }

      // Make a change
      await rows.first().locator('td').first().click();
      await rows.nth(1).locator('td').first().click();

      // Exit edit mode
      await page.locator(SELECTORS.dashboard.cancelBtn).click();

      // Re-enter edit mode
      await page.locator(SELECTORS.dashboard.editBtn).click();

      // No changes should exist
      const changesCount = page.locator('.toolbar-changes');
      await expect(changesCount).not.toBeVisible();
    });
  });

  test.describe('Edit Mode UI', () => {
    test('rows show edit-mode class when in edit mode', async ({ page }) => {
      await page.locator(SELECTORS.dashboard.editBtn).click();

      const firstRow = page.locator(SELECTORS.dashboard.tableRow).first();
      await expect(firstRow).toHaveClass(/edit-mode/);
    });

    test('edit toolbar has correct sections', async ({ page }) => {
      await page.locator(SELECTORS.dashboard.editBtn).click();

      // Left section with selection count
      await expect(page.locator('.toolbar-selection-count')).toBeVisible();

      // Copy mode button
      await expect(page.locator(SELECTORS.dashboard.copyModeBtn)).toBeVisible();

      // Right section with cancel and save
      await expect(page.locator(SELECTORS.dashboard.cancelBtn)).toBeVisible();
      await expect(page.locator(SELECTORS.dashboard.saveChangesBtn)).toBeVisible();
    });
  });
});
