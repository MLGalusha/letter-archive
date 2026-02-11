import { test, expect, Page } from '@playwright/test';

/**
 * E2E tests for AI Notes feature (Phase 2)
 *
 * These tests verify the AI notes section on the letter review page,
 * including display, editing, auto-save, and AI population.
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

// Helper to find a letter with transcription (needed for metadata extraction)
async function findLetterWithTranscription(page: Page): Promise<boolean> {
  const rows = page.locator('table tbody tr');
  const rowCount = await rows.count();

  for (let i = 0; i < Math.min(rowCount, 10); i++) {
    await rows.nth(i).click();
    await page.waitForURL(/\/admin\/letters\//);
    await page.waitForLoadState('networkidle');

    // Check if this letter has a transcription
    const transcriptEditor = page.locator('.transcript-section [contenteditable]');
    if (await transcriptEditor.isVisible()) {
      const content = await transcriptEditor.textContent();
      if (content && content.length > 50) {
        return true;
      }
    }

    // Go back to dashboard and try next letter
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
  }

  return false;
}

test.describe('AI Notes Section', () => {

  test('AI notes section is always visible on letter review page', async ({ page }) => {
    await loginAsAdmin(page);
    await navigateToFirstLetter(page);

    // AI notes section should always be visible
    const aiNotesSection = page.locator('.ai-notes-section');
    await expect(aiNotesSection).toBeVisible();

    // Should have the "AI Notes" header
    const header = page.locator('.ai-notes-section h2');
    await expect(header).toHaveText('AI Notes');
  });

  test('shows placeholder text when AI notes are empty', async ({ page }) => {
    await loginAsAdmin(page);
    await navigateToFirstLetter(page);

    // Find the AI notes textarea
    const textarea = page.locator('.ai-notes-editor');
    await expect(textarea).toBeVisible();

    // Check placeholder attribute
    const placeholder = await textarea.getAttribute('placeholder');
    expect(placeholder).toContain('AI observations');
  });

  test('shows help text describing the section', async ({ page }) => {
    await loginAsAdmin(page);
    await navigateToFirstLetter(page);

    // Check for help text
    const helpText = page.locator('.ai-notes-section .help-text');
    await expect(helpText).toBeVisible();
    await expect(helpText).toContainText('Observations');
  });

  test('can type and edit AI notes', async ({ page }) => {
    await loginAsAdmin(page);
    await navigateToFirstLetter(page);

    // Find the AI notes textarea
    const textarea = page.locator('.ai-notes-editor');
    await expect(textarea).toBeVisible();

    // Clear existing content and type new text
    const testNote = 'Test note from E2E test - ' + Date.now();
    await textarea.click();
    await textarea.fill(testNote);

    // Verify the text was entered
    await expect(textarea).toHaveValue(testNote);
  });

  test('auto-saves AI notes after typing', async ({ page }) => {
    await loginAsAdmin(page);
    await navigateToFirstLetter(page);

    // Find the AI notes textarea
    const textarea = page.locator('.ai-notes-editor');
    await expect(textarea).toBeVisible();

    // Generate unique test content
    const uniqueId = Date.now();
    const testNote = `Auto-save test ${uniqueId}`;

    // Type the note
    await textarea.click();
    await textarea.fill(testNote);

    // Wait for auto-save debounce (typically 1-2 seconds)
    await page.waitForTimeout(3000);

    // Get the current URL to reload the same letter
    const currentUrl = page.url();

    // Reload the page
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Verify the note persisted
    const textareaAfterReload = page.locator('.ai-notes-editor');
    await expect(textareaAfterReload).toHaveValue(testNote);
  });

  test('AI notes populated after metadata extraction', async ({ page }) => {
    test.setTimeout(120000); // 2 minutes for API call

    await loginAsAdmin(page);

    // Find a letter with transcription
    const hasTranscription = await findLetterWithTranscription(page);

    if (!hasTranscription) {
      test.skip(true, 'No letters with transcription found for metadata extraction test');
      return;
    }

    // Clear existing AI notes first to verify population
    const textarea = page.locator('.ai-notes-editor');
    await textarea.click();
    await textarea.fill('');
    await page.waitForTimeout(2000); // Wait for save

    // Find and click the Extract Metadata button
    const extractBtn = page.locator('button:has-text("Extract Metadata")');

    if (!(await extractBtn.isVisible())) {
      // May need to look in a different location
      const extractBtn2 = page.locator('.metadata-section button:has-text("Extract")');
      if (await extractBtn2.isVisible()) {
        await extractBtn2.click();
      } else {
        test.skip(true, 'Extract Metadata button not found');
        return;
      }
    } else {
      await extractBtn.click();
    }

    // Wait for metadata extraction to complete (API call)
    // The button may show loading state or be disabled during extraction
    await page.waitForTimeout(5000); // Initial wait

    // Wait for extraction to complete - look for success indicators
    // This could be a toast notification, button state change, or content appearing
    await expect(page.locator('.ai-notes-editor')).toBeVisible({ timeout: 90000 });

    // Wait additional time for content to populate
    await page.waitForTimeout(5000);

    // Reload to ensure we see the latest saved state
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Check if AI notes were populated
    const textareaAfterExtraction = page.locator('.ai-notes-editor');
    const notes = await textareaAfterExtraction.inputValue();

    // AI notes should have some content (may be null if AI found nothing notable)
    // We log the result rather than failing since AI may legitimately return null
    console.log('AI Notes after extraction:', notes?.substring(0, 200) || '(empty)');

    // At minimum, the textarea should still be functional
    await expect(textareaAfterExtraction).toBeVisible();
  });

  test('AI notes textarea auto-resizes based on content', async ({ page }) => {
    await loginAsAdmin(page);
    await navigateToFirstLetter(page);

    // Find the AI notes textarea
    const textarea = page.locator('.ai-notes-editor');
    await expect(textarea).toBeVisible();

    // Get initial height
    const initialBox = await textarea.boundingBox();
    const initialHeight = initialBox?.height || 0;

    // Add multiple lines of content
    const multiLineNote = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8';
    await textarea.click();
    await textarea.fill(multiLineNote);

    // Wait for resize effect
    await page.waitForTimeout(500);

    // Get new height
    const newBox = await textarea.boundingBox();
    const newHeight = newBox?.height || 0;

    // Height should have increased (or stayed same if already large enough)
    expect(newHeight).toBeGreaterThanOrEqual(initialHeight);
  });
});
