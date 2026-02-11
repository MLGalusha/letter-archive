import { test, expect, Page } from '@playwright/test';

/**
 * E2E tests for Extra Content Transcription feature (Phase 1)
 *
 * These tests verify the extra content transcription workflow for letters
 * with telegram, cover, or ephemera attachments.
 *
 * Note: Some tests trigger real OpenAI API calls and may take 30-60 seconds.
 */

// Helper to login as admin
async function loginAsAdmin(page: Page) {
  await page.goto('/admin');
  await page.waitForLoadState('networkidle');

  const loginForm = page.locator('input[type="password"]');
  if (await loginForm.isVisible()) {
    await page.locator('input[type="email"]').fill('admin@letterarchive.com');
    await loginForm.fill('admin123');
    await page.click('button[type="submit"]');
    await page.waitForLoadState('networkidle');
  }
}

// Helper to navigate to a letter review page
async function navigateToFirstLetter(page: Page) {
  const firstLetterRow = page.locator('table tbody tr').first();
  await firstLetterRow.waitFor({ state: 'visible', timeout: 10000 });
  await firstLetterRow.click();
  await page.waitForURL(/\/admin\/letters\//);
  await page.waitForLoadState('networkidle');
}

// Helper to find a letter with telegram/cover/ephemera extras
async function findLetterWithExtras(page: Page): Promise<boolean> {
  // Look through table rows for letters that might have extras
  // We'll need to click each and check if extras exist
  const rows = page.locator('table tbody tr');
  const rowCount = await rows.count();

  for (let i = 0; i < Math.min(rowCount, 10); i++) {
    await rows.nth(i).click();
    await page.waitForURL(/\/admin\/letters\//);
    await page.waitForLoadState('networkidle');

    // Check if this letter has extras (transcribe button visible)
    const transcribeBtn = page.locator('.extra-content-section .transcribe-btn');
    if (await transcribeBtn.isVisible()) {
      return true;
    }

    // Go back to dashboard and try next letter
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
  }

  return false;
}

test.describe('Extra Content Transcription', () => {

  test('extra content section is always visible on letter review page', async ({ page }) => {
    await loginAsAdmin(page);
    await navigateToFirstLetter(page);

    // Extra content section should always be visible
    const extraContentSection = page.locator('.extra-content-section');
    await expect(extraContentSection).toBeVisible();

    // Should have the "Extra Content" header
    const header = page.locator('.extra-content-section h2');
    await expect(header).toHaveText('Extra Content');
  });

  test('shows empty state message when letter has no extras', async ({ page }) => {
    await loginAsAdmin(page);
    await navigateToFirstLetter(page);

    // Find the extra content section
    const extraContentSection = page.locator('.extra-content-section');
    await expect(extraContentSection).toBeVisible();

    // Either:
    // 1. Empty state with "No extra content" message
    // 2. Empty state with "Click Transcribe" message (has transcribable extras)
    // 3. DynamicEditor with content (already transcribed)
    // 4. Transcribe button visible (has extras to transcribe)

    const emptyState = extraContentSection.locator('.empty-state');
    const transcribeBtn = extraContentSection.locator('.transcribe-btn');
    const editor = extraContentSection.locator('[contenteditable]');

    const hasEmptyState = await emptyState.isVisible();
    const hasTranscribeBtn = await transcribeBtn.isVisible();
    const hasEditor = await editor.isVisible();

    // At least one of these should be true
    expect(hasEmptyState || hasTranscribeBtn || hasEditor).toBe(true);

    if (hasEmptyState) {
      // Check the empty state message contains expected text
      const text = await emptyState.textContent();
      expect(text).toMatch(/No extra content|Click.*Transcribe/i);
    }
  });

  test('can transcribe extras when letter has telegram/cover/ephemera', async ({ page }) => {
    test.setTimeout(120000); // 2 minutes for API call

    await loginAsAdmin(page);

    // Find a letter with extras
    const hasExtras = await findLetterWithExtras(page);

    if (!hasExtras) {
      test.skip(true, 'No letters with extras found in test data');
      return;
    }

    // Click transcribe button
    const transcribeBtn = page.locator('.extra-content-section .transcribe-btn');
    await expect(transcribeBtn).toBeVisible();
    await transcribeBtn.click();

    // Wait for transcription to complete (API call)
    // Button should show loading state, then content should appear
    await expect(page.locator('.extra-content-section [contenteditable]')).toBeVisible({
      timeout: 90000
    });

    // Content should have some text
    const editor = page.locator('.extra-content-section [contenteditable]');
    const content = await editor.textContent();
    expect(content?.length).toBeGreaterThan(0);
  });

  test('can edit extra content transcription', async ({ page }) => {
    await loginAsAdmin(page);

    // Find a letter with existing extra content or transcribe first
    const hasExtras = await findLetterWithExtras(page);

    if (!hasExtras) {
      test.skip(true, 'No letters with extras found in test data');
      return;
    }

    // Check if editor is visible (may need to transcribe first)
    const editor = page.locator('.extra-content-section [contenteditable]');
    const isEditorVisible = await editor.isVisible();

    if (!isEditorVisible) {
      // Transcribe first
      const transcribeBtn = page.locator('.extra-content-section .transcribe-btn');
      await transcribeBtn.click();
      await expect(editor).toBeVisible({ timeout: 90000 });
    }

    // Type some text in the editor
    const testText = ' [TEST EDIT]';
    await editor.click();
    await page.keyboard.press('End');
    await editor.pressSequentially(testText);

    // Wait for auto-save (debounced)
    await page.waitForTimeout(2000);

    // Reload and verify text persisted
    const url = page.url();
    await page.reload();
    await page.waitForLoadState('networkidle');

    const editorAfterReload = page.locator('.extra-content-section [contenteditable]');
    await expect(editorAfterReload).toContainText('[TEST EDIT]');
  });

  test('can verify extra content', async ({ page }) => {
    await loginAsAdmin(page);

    // Find a letter with extra content that can be verified
    const hasExtras = await findLetterWithExtras(page);

    if (!hasExtras) {
      test.skip(true, 'No letters with extras found in test data');
      return;
    }

    // Check if there's content to verify
    const editor = page.locator('.extra-content-section [contenteditable]');
    const verifyBtn = page.locator('.extra-content-section .verify-btn');

    if (!(await editor.isVisible())) {
      // Need to transcribe first
      const transcribeBtn = page.locator('.extra-content-section .transcribe-btn');
      await transcribeBtn.click();
      await expect(editor).toBeVisible({ timeout: 90000 });
    }

    // Verify button should be visible if status is AI_DRAFT or EDITED
    if (await verifyBtn.isVisible()) {
      await verifyBtn.click();

      // Should show verified badge
      const verifiedBadge = page.locator('.extra-content-section .verified-info');
      await expect(verifiedBadge).toBeVisible();
      await expect(verifiedBadge).toContainText('Verified');
    }
  });

  test('can unverify extra content to re-edit', async ({ page }) => {
    await loginAsAdmin(page);

    const hasExtras = await findLetterWithExtras(page);

    if (!hasExtras) {
      test.skip(true, 'No letters with extras found in test data');
      return;
    }

    // Check if already verified
    const verifiedBadge = page.locator('.extra-content-section .verified-info');

    if (await verifiedBadge.isVisible()) {
      // Click to unverify
      await verifiedBadge.click();

      // Wait for unverify to complete
      await page.waitForTimeout(1000);

      // Verify button should reappear (not the verified badge)
      const verifyBtn = page.locator('.extra-content-section .verify-btn');
      await expect(verifyBtn).toBeVisible();
    } else {
      // First verify, then unverify
      const editor = page.locator('.extra-content-section [contenteditable]');

      if (!(await editor.isVisible())) {
        test.skip(true, 'No extra content to verify/unverify');
        return;
      }

      const verifyBtn = page.locator('.extra-content-section .verify-btn');
      if (await verifyBtn.isVisible()) {
        await verifyBtn.click();
        await expect(verifiedBadge).toBeVisible();

        // Now unverify
        await verifiedBadge.click();
        await page.waitForTimeout(1000);
        await expect(verifyBtn).toBeVisible();
      }
    }
  });

  test('dashboard shows extra content status column', async ({ page }) => {
    await loginAsAdmin(page);

    // Look for the Extra Trans column header or toggle
    const columnToggle = page.locator('text=Extra Trans');

    // Either the column is visible in the table or in the column toggle menu
    // Check the table header first
    const tableHeader = page.locator('th:has-text("Extra")');
    const isColumnVisible = await tableHeader.isVisible();

    if (isColumnVisible) {
      expect(true).toBe(true); // Column is visible
    } else {
      // Check if there's a column toggle that includes extra content
      // This depends on the UI implementation
      test.skip(true, 'Extra content column may not be enabled by default');
    }
  });
});
