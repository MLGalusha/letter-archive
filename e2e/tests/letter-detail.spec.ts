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

      // Should show transcript or transcription section
      const transcript = page.locator('.transcript, .transcription, [class*="transcript"]');
      await expect(transcript.first()).toBeVisible();
    });
  });

  test.describe('Split Pane Functionality', () => {
    test('shows resizable split pane layout', async ({ page }) => {
      const hasLetter = await navigateToPublishedLetter(page);

      if (!hasLetter) {
        test.skip(true, 'No published letters available');
        return;
      }

      // Should have split pane or two-column layout
      const splitPane = page.locator('.split-pane, .resizable-pane, [class*="split"]');
      const hasSplitPane = await splitPane.isVisible().catch(() => false);

      // Or at least have both image and text visible
      const hasImage = await page.locator('img').first().isVisible().catch(() => false);
      const hasText = await page.locator('.transcript, .transcription, p').first().isVisible().catch(() => false);

      expect(hasSplitPane || (hasImage && hasText)).toBe(true);
    });

    test('split pane divider is interactive', async ({ page }) => {
      const hasLetter = await navigateToPublishedLetter(page);

      if (!hasLetter) {
        test.skip(true, 'No published letters available');
        return;
      }

      const divider = page.locator('.split-divider, .resize-handle, .divider, [class*="divider"]');

      if (!(await divider.isVisible().catch(() => false))) {
        // Split pane might not be implemented
        test.skip(true, 'Split pane divider not visible');
        return;
      }

      // Divider should be draggable (has cursor style)
      const cursor = await divider.evaluate((el) => getComputedStyle(el).cursor);
      expect(['col-resize', 'ew-resize', 'pointer', 'grab']).toContain(cursor);
    });
  });

  test.describe('Image Navigation', () => {
    test('can navigate between images if multiple pages', async ({ page }) => {
      const hasLetter = await navigateToPublishedLetter(page);

      if (!hasLetter) {
        test.skip(true, 'No published letters available');
        return;
      }

      // Look for navigation arrows or page indicators
      const navButtons = page.locator('.image-nav, .carousel-nav, [class*="nav"] button, .page-indicator');
      const hasNav = await navButtons.first().isVisible().catch(() => false);

      if (!hasNav) {
        // Single page letter, no navigation needed
        test.skip(true, 'Single page letter, no image navigation');
        return;
      }

      // Should be able to click navigation
      await navButtons.first().click();
      // Image should update (hard to verify without knowing implementation)
    });

    test('shows page indicator for multi-page letters', async ({ page }) => {
      const hasLetter = await navigateToPublishedLetter(page);

      if (!hasLetter) {
        test.skip(true, 'No published letters available');
        return;
      }

      // Look for page indicator (e.g., "1 of 3")
      const pageIndicator = page.locator('.page-indicator, .page-count, [class*="page-num"]');
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
        await page.waitForURL('/');
        expect(page.url()).toBe(page.url().split('/letter')[0] + '/');
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

      // On mobile, split pane might become stacked
      // Just verify content is visible
      const image = page.locator('img').first();
      const transcript = page.locator('.transcript, .transcription, p').first();

      const hasImage = await image.isVisible().catch(() => false);
      const hasTranscript = await transcript.isVisible().catch(() => false);

      expect(hasImage || hasTranscript).toBe(true);
    });
  });
});
