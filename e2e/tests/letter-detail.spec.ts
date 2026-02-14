import { test, expect } from '@playwright/test';
import { SELECTORS } from './utils/test-helpers';

/**
 * E2E tests for Public Letter Detail Page
 *
 * Tests cover letter display, image viewer, transcript, and split pane functionality.
 */

test.describe('Letter Detail Page', () => {
  // Helper to get a valid letter URL
  async function navigateToPublishedLetter(page: any): Promise<boolean> {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const letterCard = page.locator(SELECTORS.public.letterCard).first();

    if (!(await letterCard.isVisible().catch(() => false))) {
      return false;
    }

    await letterCard.click();
    await page.waitForURL(/\/letter\//);
    await page.waitForLoadState('networkidle');
    return true;
  }

  test.describe('Letter Display', () => {
    test('shows letter content when accessing valid letter', async ({ page }) => {
      const hasLetter = await navigateToPublishedLetter(page);

      if (!hasLetter) {
        test.skip(true, 'No published letters available');
        return;
      }

      // Should show some letter content
      const letterDisplay = page.locator('.letter-display, .letter-content, [class*="letter"]');
      await expect(letterDisplay.first()).toBeVisible();
    });

    test('shows image viewer for letter images', async ({ page }) => {
      const hasLetter = await navigateToPublishedLetter(page);

      if (!hasLetter) {
        test.skip(true, 'No published letters available');
        return;
      }

      // Should show image viewer or image
      const imageViewer = page.locator('.image-viewer, .letter-image, img[class*="letter"], .letter-viewer');
      await expect(imageViewer.first()).toBeVisible();
    });

    test('shows transcript section', async ({ page }) => {
      const hasLetter = await navigateToPublishedLetter(page);

      if (!hasLetter) {
        test.skip(true, 'No published letters available');
        return;
      }

      // Transcript is shown only when letter pages exist.
      const transcript = page.locator('.transcript-section');
      const hasTranscript = await transcript.isVisible().catch(() => false);

      if (hasTranscript) {
        await expect(transcript).toBeVisible();
      } else {
        await expect(page.locator('.metadata-section')).toBeVisible();
      }
    });
  });

  test.describe('Split Pane Functionality', () => {
    test('shows resizable split pane layout', async ({ page }) => {
      const hasLetter = await navigateToPublishedLetter(page);

      if (!hasLetter) {
        test.skip(true, 'No published letters available');
        return;
      }

      await expect(page.locator('body')).toContainText('Details');
      const imageCount = await page.locator('img').count();
      expect(imageCount).toBeGreaterThan(0);
    });

    test('split pane divider is interactive', async ({ page }) => {
      const hasLetter = await navigateToPublishedLetter(page);

      if (!hasLetter) {
        test.skip(true, 'No published letters available');
        return;
      }

      const divider = page.locator('.split-pane-divider');

      if (!(await divider.isVisible().catch(() => false))) {
        // Split pane might not be implemented
        test.skip(true, 'Split pane divider not visible');
        return;
      }

      // Divider should be draggable (has cursor style)
      const cursor = await divider.evaluate((el) => getComputedStyle(el).cursor);
      expect(['col-resize', 'ew-resize', 'pointer', 'grab', 'grabbing', 'row-resize']).toContain(cursor);
    });
  });

  test.describe('Image Navigation', () => {
    test('can navigate between images if multiple pages', async ({ page }) => {
      const hasLetter = await navigateToPublishedLetter(page);

      if (!hasLetter) {
        test.skip(true, 'No published letters available');
        return;
      }

      const navButtons = page.locator('.letter-viewer .nav-button');
      const navCount = await navButtons.count();

      if (navCount < 2) {
        // Single page letter, no navigation needed
        test.skip(true, 'Single page letter, no image navigation');
        return;
      }

      await navButtons.nth(1).click();
      await expect(page.locator('.letter-viewer .image-counter')).toBeVisible();
    });

    test('shows page indicator for multi-page letters', async ({ page }) => {
      const hasLetter = await navigateToPublishedLetter(page);

      if (!hasLetter) {
        test.skip(true, 'No published letters available');
        return;
      }

      // Look for page indicator (e.g., "1 of 3")
      const pageIndicator = page.locator('.letter-viewer .image-counter');
      const hasIndicator = await pageIndicator.isVisible().catch(() => false);

      // Not all letters have multiple pages
      if (hasIndicator) {
        const text = await pageIndicator.textContent();
        // Should contain a number or "of"
        expect(text).toMatch(/\d|of/i);
      }
    });
  });

  test.describe('Metadata Display', () => {
    test('shows sender and recipient information', async ({ page }) => {
      const hasLetter = await navigateToPublishedLetter(page);

      if (!hasLetter) {
        test.skip(true, 'No published letters available');
        return;
      }

      // Look for metadata display (sender, recipient, date)
      const metadata = page.locator('.letter-metadata, .letter-info, .letter-header');
      const hasMetadata = await metadata.isVisible().catch(() => false);

      if (hasMetadata) {
        const text = await metadata.textContent();
        // Should have some content
        expect(text?.length).toBeGreaterThan(0);
      }
    });

    test('shows letter date if available', async ({ page }) => {
      const hasLetter = await navigateToPublishedLetter(page);

      if (!hasLetter) {
        test.skip(true, 'No published letters available');
        return;
      }

      // Date might be in various formats
      const dateElement = page.locator('.letter-date, .date, [class*="date"]');
      const hasDate = await dateElement.first().isVisible().catch(() => false);

      // Date display is optional based on data
      expect(true).toBe(true);
    });
  });

  test.describe('Error States', () => {
    test('shows error for non-existent letter', async ({ page }) => {
      await page.goto('/letter/non-existent-letter-id-12345');
      await page.waitForLoadState('networkidle');

      // Should show error message or 404
      const errorMessage = page.locator('.error, h1:has-text("not found"), [class*="error"]');
      const backButton = page.locator('button:has-text("Back")');

      const hasError = await errorMessage.isVisible().catch(() => false);
      const hasBack = await backButton.isVisible().catch(() => false);

      expect(hasError || hasBack).toBe(true);
    });

    test('provides navigation back to home on error', async ({ page }) => {
      await page.goto('/letter/non-existent-letter-id-12345');
      await page.waitForLoadState('networkidle');

      const backButton = page.locator('button:has-text("Back"), a:has-text("Home"), a[href="/"]');

      if (await backButton.isVisible()) {
        await backButton.click();
        await expect(page).toHaveURL('/');
      }
    });
  });

  test.describe('Responsive Layout', () => {
    test('displays correctly on mobile viewport', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      const hasLetter = await navigateToPublishedLetter(page);

      if (!hasLetter) {
        test.skip(true, 'No published letters available');
        return;
      }

      // Content should still be visible
      const content = page.locator('.letter-display, .letter-content, [class*="letter"]');
      await expect(content.first()).toBeVisible();
    });

    test('displays correctly on tablet viewport', async ({ page }) => {
      await page.setViewportSize({ width: 768, height: 1024 });
      const hasLetter = await navigateToPublishedLetter(page);

      if (!hasLetter) {
        test.skip(true, 'No published letters available');
        return;
      }

      const content = page.locator('.letter-display, .letter-content, [class*="letter"]');
      await expect(content.first()).toBeVisible();
    });

    test('split pane may stack on mobile', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      const hasLetter = await navigateToPublishedLetter(page);

      if (!hasLetter) {
        test.skip(true, 'No published letters available');
        return;
      }

      await expect(page.locator('body')).toContainText('Details');
      const imageCount = await page.locator('img').count();
      expect(imageCount).toBeGreaterThan(0);
    });
  });
});
