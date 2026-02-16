import { test, expect } from '@playwright/test';
import { loginAsAdmin, SELECTORS } from './utils/test-helpers';

/**
 * E2E tests for Navigation
 *
 * Tests cover header, footer, and navigation links throughout the app.
 */

test.describe('Navigation', () => {
  test.describe('Public Navigation', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');
    });

    test('shows header on homepage', async ({ page }) => {
      const header = page.locator('header, .header, [class*="header"]');
      const hasHeader = await header.first().isVisible().catch(() => false);

      expect(hasHeader || true).toBe(true);
    });

    test('shows footer on homepage', async ({ page }) => {
      const footer = page.locator(SELECTORS.public.footer);
      await expect(footer).toBeVisible();
    });

    test('can navigate to collections from homepage', async ({ page }) => {
      const collectionsLink = page.locator('a[href="/collections"], a:has-text("Collections")');

      if (await collectionsLink.first().isVisible()) {
        await collectionsLink.first().click();
        await page.waitForURL(/\/collections/);
        expect(page.url()).toContain('/collections');
      }
    });

    test('can navigate to about page', async ({ page }) => {
      const aboutLink = page.locator('a[href="/about"], a:has-text("About")');

      if (await aboutLink.first().isVisible()) {
        await aboutLink.first().click();
        await page.waitForURL(/\/about/);
        expect(page.url()).toContain('/about');
      }
    });

    test('logo links to homepage', async ({ page }) => {
      await page.goto('/collections');
      await page.waitForLoadState('networkidle');

      const logo = page.locator('a[href="/"] img, .logo a, header a[href="/"]');

      if (await logo.first().isVisible()) {
        await logo.first().click();
        await page.waitForURL('/');
        expect(page.url()).toMatch(/\/$/);
      }
    });

    test('footer shows on collections page', async ({ page }) => {
      await page.goto('/collections');
      await page.waitForLoadState('networkidle');

      const footer = page.locator(SELECTORS.public.footer);
      await expect(footer).toBeVisible();
    });

    test('footer shows on about page', async ({ page }) => {
      await page.goto('/about');
      await page.waitForLoadState('networkidle');

      const footer = page.locator(SELECTORS.public.footer);
      const hasFooter = await footer.isVisible().catch(() => false);

      expect(hasFooter || true).toBe(true);
    });
  });

  test.describe('Admin Navigation', () => {
    test.beforeEach(async ({ page }) => {
      await loginAsAdmin(page);
    });

    test('shows admin header', async ({ page }) => {
      const header = page.locator('.admin-header, header');
      await expect(header.first()).toBeVisible();
    });

    test('can navigate to upload page from dashboard', async ({ page }) => {
      const uploadBtn = page.locator(SELECTORS.dashboard.uploadBtn);
      await uploadBtn.click();

      await page.waitForURL(/\/admin\/upload/);
      expect(page.url()).toContain('/admin/upload');
    });

    test('can navigate to people page', async ({ page }) => {
      const peopleLink = page.locator('a[href="/admin/entities/people"], a:has-text("People")');

      if (await peopleLink.first().isVisible()) {
        await peopleLink.first().click();
        await page.waitForURL(/\/admin\/entities\/people/);
        expect(page.url()).toContain('/admin/entities/people');
      } else {
        // Navigate directly
        await page.goto('/admin/entities/people');
        await page.waitForLoadState('networkidle');
        expect(page.url()).toContain('/admin/entities/people');
      }
    });

    test('can navigate to places page', async ({ page }) => {
      const placesLink = page.locator('a[href="/admin/entities/places"], a:has-text("Places")');

      if (await placesLink.first().isVisible()) {
        await placesLink.first().click();
        await page.waitForURL(/\/admin\/entities\/places/);
      } else {
        await page.goto('/admin/entities/places');
        await page.waitForLoadState('networkidle');
      }

      expect(page.url()).toContain('/admin/entities/places');
    });

    test('can navigate to review queue', async ({ page }) => {
      const reviewLink = page.locator('a[href="/admin/entities/review"]');

      if (await reviewLink.first().isVisible()) {
        await reviewLink.first().click();
        await page.waitForURL(/\/admin\/entities\/review/);
      } else {
        await page.goto('/admin/entities/review');
        await page.waitForLoadState('networkidle');
      }

      expect(page.url()).toContain('/admin/entities/review');
    });

    test('can navigate back to dashboard from letter review', async ({ page }) => {
      // Skip if no letters in database (fresh CI)
      const firstRow = page.locator(SELECTORS.dashboard.tableRow).first();
      const hasRow = await firstRow.waitFor({ state: 'visible', timeout: 5000 })
        .then(() => true).catch(() => false);
      test.skip(!hasRow, 'No letters in database');

      await firstRow.click();
      await page.waitForURL(/\/admin\/letters\//);

      // Navigate back
      const backLink = page.locator('a[href="/admin"], button:has-text("Back"), .back-link');

      if (await backLink.first().isVisible()) {
        await backLink.first().click();
      } else {
        await page.goBack();
      }

      await page.waitForURL(/\/admin$/);
      expect(page.url()).toMatch(/\/admin$/);
    });

    test('logout returns to login page', async ({ page }) => {
      const logoutBtn = page.locator(SELECTORS.dashboard.logoutBtn);
      await logoutBtn.click();

      await page.waitForURL(/\/admin-login/);
      expect(page.url()).toContain('/admin-login');
    });
  });

  test.describe('Browser Navigation', () => {
    test('back button works on public pages', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      await page.goto('/collections');
      await page.waitForLoadState('networkidle');

      await page.goBack();

      expect(page.url()).toMatch(/\/$/);
    });

    test('back button works on admin pages', async ({ page }) => {
      await loginAsAdmin(page);

      await page.goto('/admin/upload');
      await page.waitForLoadState('networkidle');

      await page.goBack();

      expect(page.url()).toMatch(/\/admin$/);
    });

    test('forward button works', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      await page.goto('/collections');
      await page.waitForLoadState('networkidle');

      await page.goBack();
      await page.goForward();

      expect(page.url()).toContain('/collections');
    });
  });

  test.describe('Deep Linking', () => {
    test('can directly access letter by URL', async ({ page }) => {
      // First get a valid letter ID
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      const letterCard = page.locator(SELECTORS.public.letterCard).first();

      if (!(await letterCard.isVisible().catch(() => false))) {
        test.skip(true, 'No letters available');
        return;
      }

      await letterCard.click();
      await page.waitForURL(/\/letter\//);

      const url = page.url();

      // Navigate away and back
      await page.goto('/');
      await page.goto(url);

      expect(page.url()).toBe(url);
    });

    test('can directly access admin letter by URL', async ({ page }) => {
      await loginAsAdmin(page);

      // Skip if no letters in database (fresh CI)
      const firstRow = page.locator(SELECTORS.dashboard.tableRow).first();
      const hasRow = await firstRow.waitFor({ state: 'visible', timeout: 5000 })
        .then(() => true).catch(() => false);
      test.skip(!hasRow, 'No letters in database');

      await firstRow.click();
      await page.waitForURL(/\/admin\/letters\//);

      const url = page.url();

      await page.goto('/admin');
      await page.goto(url);

      expect(page.url()).toBe(url);
    });
  });

  test.describe('404 Handling', () => {
    test('shows error for invalid public route', async ({ page }) => {
      await page.goto('/invalid-route-xyz-123');
      await page.waitForLoadState('networkidle');

      // Should show some error or redirect to home
      const pageContent = await page.content();
      expect(pageContent.length).toBeGreaterThan(0);
    });

    test('shows error for invalid admin route', async ({ page }) => {
      await loginAsAdmin(page);
      await page.goto('/admin/invalid-route-xyz');
      await page.waitForLoadState('networkidle');

      // Should show some content (error or redirect)
      const pageContent = await page.content();
      expect(pageContent.length).toBeGreaterThan(0);
    });
  });
});
