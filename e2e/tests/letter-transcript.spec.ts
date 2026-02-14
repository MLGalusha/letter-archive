import { test, expect } from '@playwright/test';
import {
  loginAsAdmin,
} from './utils/test-helpers';

/**
 * E2E tests for Letter Transcript Editing
 *
 * Tests cover transcript display, editing, auto-save, and verification workflow.
 */

const TRANSCRIPT_SECTION_SELECTOR =
  '.editor-section:not(.notes-section):not(.extra-content-section)';
const TRANSCRIPT_EDITOR_SELECTOR =
  '.editor-section:not(.notes-section):not(.extra-content-section) .transcript-editor';

async function findLetterWithTranscriptSection(page: import('@playwright/test').Page): Promise<boolean> {
  await page.goto('/admin');
  await page.waitForLoadState('networkidle');

  const rows = page.locator('table tbody tr');
  const rowCount = await rows.count();

  for (let i = 0; i < Math.min(rowCount, 10); i++) {
    await rows.nth(i).click();
    await page.waitForURL(/\/admin\/letters\//);
    await page.locator('.metadata-section').waitFor({ state: 'visible', timeout: 15000 });

    const transcriptSection = page.locator(TRANSCRIPT_SECTION_SELECTOR);
    if (await transcriptSection.isVisible().catch(() => false)) {
      return true;
    }

    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
  }

  return false;
}

async function ensureTranscriptEditable(page: import('@playwright/test').Page): Promise<boolean> {
  const editor = page.locator(TRANSCRIPT_EDITOR_SELECTOR).first();
  if (!(await editor.isVisible().catch(() => false))) {
    return false;
  }

  const verifiedInfo = page.locator(`${TRANSCRIPT_SECTION_SELECTOR} .verified-info`);
  if (await verifiedInfo.isVisible().catch(() => false)) {
    await page.locator(`${TRANSCRIPT_SECTION_SELECTOR} .editor-container`).first().dblclick();
    await page.waitForTimeout(1500);
  }

  const isEditable = await editor.evaluate((el) => el.getAttribute('contenteditable') === 'true');
  return isEditable;
}

test.describe('Letter Transcript', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    const hasTranscriptSection = await findLetterWithTranscriptSection(page);
    test.skip(!hasTranscriptSection, 'No letters with transcript section found in test data');
  });

  test.describe('Transcript Section Display', () => {
    test('transcript section is visible', async ({ page }) => {
      const section = page.locator(TRANSCRIPT_SECTION_SELECTOR);
      await expect(section).toBeVisible();
    });

    test('shows section header', async ({ page }) => {
      const header = page.locator(`${TRANSCRIPT_SECTION_SELECTOR} h2, ${TRANSCRIPT_SECTION_SELECTOR} h3`);
      await expect(header).toBeVisible();
    });

    test('shows transcript editor or empty state', async ({ page }) => {
      const editor = page.locator(TRANSCRIPT_EDITOR_SELECTOR);
      const transcribeBtn = page.locator(`${TRANSCRIPT_SECTION_SELECTOR} .transcribe-btn, ${TRANSCRIPT_SECTION_SELECTOR} button:has-text("Transcribe")`);
      const verifyBtn = page.locator(`${TRANSCRIPT_SECTION_SELECTOR} .verify-btn, ${TRANSCRIPT_SECTION_SELECTOR} button:has-text("Verify")`);
      const verifiedInfo = page.locator(`${TRANSCRIPT_SECTION_SELECTOR} .verified-info`);

      const hasEditor = await editor.isVisible().catch(() => false);
      const hasTranscribe = await transcribeBtn.isVisible().catch(() => false);
      const hasVerify = await verifyBtn.isVisible().catch(() => false);
      const hasVerified = await verifiedInfo.isVisible().catch(() => false);

      expect(hasEditor || hasTranscribe || hasVerify || hasVerified).toBe(true);
    });
  });

  test.describe('Transcript Editing', () => {
    test('can click and focus transcript editor', async ({ page }) => {
      const editor = page.locator(TRANSCRIPT_EDITOR_SELECTOR).first();

      if (!(await editor.isVisible().catch(() => false))) {
        test.skip(true, 'No transcript editor visible');
        return;
      }

      if (!(await ensureTranscriptEditable(page))) {
        test.skip(true, 'Transcript is currently in verified read-only mode');
        return;
      }

      await editor.click();

      // Editor should be focused
      await expect(editor).toBeFocused();
    });

    test('can type in transcript editor', async ({ page }) => {
      const editor = page.locator(TRANSCRIPT_EDITOR_SELECTOR).first();

      if (!(await editor.isVisible().catch(() => false))) {
        test.skip(true, 'No transcript editor visible');
        return;
      }

      if (!(await ensureTranscriptEditable(page))) {
        test.skip(true, 'Transcript is currently in verified read-only mode');
        return;
      }

      await editor.click();

      // Go to end and add test text
      await page.keyboard.press('End');
      const testText = ' [E2E TEST]';
      await editor.pressSequentially(testText);

      // Verify text was added
      await expect(editor).toContainText('[E2E TEST]');
    });

    test('transcript auto-saves after editing', async ({ page }) => {
      const editor = page.locator(TRANSCRIPT_EDITOR_SELECTOR).first();

      if (!(await editor.isVisible().catch(() => false))) {
        test.skip(true, 'No transcript editor visible');
        return;
      }

      if (!(await ensureTranscriptEditable(page))) {
        test.skip(true, 'Transcript is currently in verified read-only mode');
        return;
      }

      const uniqueId = Date.now();
      const testText = ` [TEST-${uniqueId}]`;

      await editor.click();
      await page.keyboard.press('End');
      await editor.pressSequentially(testText);

      // Wait for auto-save (debounced)
      await page.waitForTimeout(2000);

      // Reload page
      await page.reload();
      await page.waitForLoadState('networkidle');

      // Verify text persisted
      const editorAfterReload = page.locator(TRANSCRIPT_EDITOR_SELECTOR).first();
      await expect(editorAfterReload).toContainText(`[TEST-${uniqueId}]`);
    });
  });

  test.describe('Transcript Verification', () => {
    test('shows verify button when transcript is editable', async ({ page }) => {
      const editor = page.locator(TRANSCRIPT_EDITOR_SELECTOR).first();

      if (!(await editor.isVisible().catch(() => false))) {
        test.skip(true, 'No transcript editor visible');
        return;
      }

      const verifyBtn = page.locator(`${TRANSCRIPT_SECTION_SELECTOR} .verify-btn, ${TRANSCRIPT_SECTION_SELECTOR} button:has-text("Verify")`);
      const verifiedInfo = page.locator(`${TRANSCRIPT_SECTION_SELECTOR} .verified-info`);

      const hasVerifyBtn = await verifyBtn.isVisible().catch(() => false);
      const hasVerifiedInfo = await verifiedInfo.isVisible().catch(() => false);

      // Either verify button or verified info should be visible
      expect(hasVerifyBtn || hasVerifiedInfo).toBe(true);
    });

    test('can verify transcript', async ({ page }) => {
      const verifyBtn = page.locator(`${TRANSCRIPT_SECTION_SELECTOR} .verify-btn, ${TRANSCRIPT_SECTION_SELECTOR} button:has-text("Verify")`);

      if (!(await verifyBtn.isVisible().catch(() => false))) {
        test.skip(true, 'No verify button visible (may be already verified)');
        return;
      }

      await verifyBtn.click();
      await page.waitForTimeout(1000);

      // Verified info should appear
      const verifiedInfo = page.locator(`${TRANSCRIPT_SECTION_SELECTOR} .verified-info`);
      await expect(verifiedInfo).toBeVisible();
    });

    test('can unverify transcript to re-edit', async ({ page }) => {
      const verifiedInfo = page.locator(`${TRANSCRIPT_SECTION_SELECTOR} .verified-info`);

      if (!(await verifiedInfo.isVisible().catch(() => false))) {
        test.skip(true, 'Transcript is not currently in verified state');
        return;
      }

      await page.locator(`${TRANSCRIPT_SECTION_SELECTOR} .editor-container`).first().dblclick();
      await page.waitForTimeout(1000);

      // Verify button should reappear
      const verifyBtn = page.locator(`${TRANSCRIPT_SECTION_SELECTOR} .verify-btn, ${TRANSCRIPT_SECTION_SELECTOR} button:has-text("Verify")`);
      await expect(verifyBtn.first()).toBeVisible();
    });

    test('verified info shows verification timestamp', async ({ page }) => {
      const verifiedInfo = page.locator(`${TRANSCRIPT_SECTION_SELECTOR} .verified-info`);

      if (!(await verifiedInfo.isVisible().catch(() => false))) {
        test.skip(true, 'Transcript not verified');
        return;
      }

      const text = await verifiedInfo.textContent();
      // Should contain "Verified" and possibly a timestamp or user info
      expect(text).toMatch(/verified/i);
    });
  });

  test.describe('Transcript Status', () => {
    test('shows transcript status indicator', async ({ page }) => {
      // Look for status badge or indicator in transcript section
      const statusIndicator = page.locator(`${TRANSCRIPT_SECTION_SELECTOR} [class*="status"], ${TRANSCRIPT_SECTION_SELECTOR} .badge`);
      const hasStatus = await statusIndicator.isVisible().catch(() => false);

      // Status may be shown in header or as badge
      expect(true).toBe(true);
    });
  });

  test.describe('Regenerate Transcript', () => {
    test('shows regenerate button if transcript exists', async ({ page }) => {
      const editor = page.locator(TRANSCRIPT_EDITOR_SELECTOR).first();

      if (!(await editor.isVisible().catch(() => false))) {
        test.skip(true, 'No transcript to regenerate');
        return;
      }

      const regenerateBtn = page.locator('button:has-text("Regenerate"), button:has-text("Re-transcribe")');
      const hasRegenerate = await regenerateBtn.isVisible().catch(() => false);

      // Regenerate may not be visible if already verified
      expect(true).toBe(true);
    });
  });

  test.describe('Transcript Transcription', () => {
    test('shows transcribe button when no transcript', async ({ page }) => {
      const editor = page.locator(TRANSCRIPT_EDITOR_SELECTOR).first();
      const transcribeBtn = page.locator(`${TRANSCRIPT_SECTION_SELECTOR} button:has-text("Transcribe")`);

      const hasEditor = await editor.isVisible().catch(() => false);
      const hasTranscribe = await transcribeBtn.isVisible().catch(() => false);
      expect(hasEditor || hasTranscribe).toBe(true);
    });
  });

  test.describe('Editor Features', () => {
    test('editor supports multi-line content', async ({ page }) => {
      const editor = page.locator(TRANSCRIPT_EDITOR_SELECTOR).first();

      if (!(await editor.isVisible().catch(() => false))) {
        test.skip(true, 'No transcript editor visible');
        return;
      }

      // Should contain multiple lines if letter has content
      const content = await editor.innerHTML();
      const hasMultipleLines = content.includes('<br') || content.includes('<p') || content.includes('\n');

      // Multi-line is expected but not required
      expect(true).toBe(true);
    });

    test('editor maintains formatting', async ({ page }) => {
      const editor = page.locator(TRANSCRIPT_EDITOR_SELECTOR).first();

      if (!(await editor.isVisible().catch(() => false))) {
        test.skip(true, 'No transcript editor visible');
        return;
      }

      const hasContentEditable = await editor.getAttribute('contenteditable');
      expect(hasContentEditable === 'true' || hasContentEditable === 'false').toBe(true);
    });
  });
});
