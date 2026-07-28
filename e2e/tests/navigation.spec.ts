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
      await page.waitForLoadState('domcontentloaded');
    });

    test('shows header on homepage', async ({ page }) => {
      await expect(page.locator(SELECTORS.public.header)).toBeVisible();
      await expect(page.getByRole('navigation')).toBeVisible();
    });

    test('shows footer on homepage', async ({ page }) => {
      const footer = page.locator(SELECTORS.public.footer);
      await expect(footer).toBeVisible();
    });

    test('can navigate to collections from homepage', async ({ page }) => {
      const collectionsLink = page.getByRole('navigation')
        .getByRole('link', { name: 'Collections' });
      await expect(collectionsLink).toBeVisible();
      await collectionsLink.click();
      await expect(page).toHaveURL(/\/collections$/);
    });

    test('can navigate to about page', async ({ page }) => {
      const aboutLink = page.getByRole('navigation')
        .getByRole('link', { name: 'About' });
      await expect(aboutLink).toBeVisible();
      await aboutLink.click();
      await expect(page).toHaveURL(/\/about$/);
    });

    test('logo links to homepage', async ({ page }) => {
      await page.goto('/collections');
      await page.waitForLoadState('domcontentloaded');

      const logo = page.locator('header a[href="/"]').first();
      await expect(logo).toBeVisible();
      await logo.click();
      await expect(page).toHaveURL(/\/$/);
    });

    test('footer shows on collections page', async ({ page }) => {
      await page.goto('/collections');
      await page.waitForLoadState('domcontentloaded');

      const footer = page.locator(SELECTORS.public.footer);
      await expect(footer).toBeVisible();
    });

    test('footer shows on about page', async ({ page }) => {
      await page.goto('/about');
      await page.waitForLoadState('domcontentloaded');

      const footer = page.locator(SELECTORS.public.footer);
      await expect(footer).toBeVisible();
    });
  });

  test.describe('Admin Navigation', () => {
    test.beforeEach(async ({ page }) => {
      await loginAsAdmin(page);
    });

    test('shows admin navigation', async ({ page }) => {
      await expect(page.getByRole('navigation')).toBeVisible();
    });

    test('can navigate to upload page from dashboard', async ({ page }) => {
      const uploadBtn = page.locator(SELECTORS.dashboard.uploadBtn);
      await uploadBtn.click();

      await page.waitForURL(/\/admin\/upload/);
      expect(page.url()).toContain('/admin/upload');
    });

    test('can navigate to processing page', async ({ page }) => {
      const processingLink = page.locator('a.nav-item:has-text("Processing")');
      await processingLink.click();

      await page.waitForURL(/\/admin\/processing/);
      expect(page.url()).toContain('/admin/processing');
    });

    test('can navigate to notes page', async ({ page }) => {
      const notesLink = page.locator('a.nav-item:has-text("Notes")');
      await notesLink.click();

      await page.waitForURL(/\/admin\/notes/);
      expect(page.url()).toContain('/admin/notes');
    });

    test('can navigate to content page', async ({ page }) => {
      const contentLink = page.locator('a.nav-item:has-text("Content")');
      await contentLink.click();

      await page.waitForURL(/\/admin\/content/);
      expect(page.url()).toContain('/admin/content');
    });

    test('can navigate back to dashboard from letter review', async ({ page }) => {
      // Skip if no letters in database (fresh CI)
      const firstRow = page.locator(SELECTORS.dashboard.tableRow).first();
      const hasRow = await firstRow.waitFor({ state: 'visible', timeout: 5000 })
        .then(() => true).catch(() => false);
      test.skip(!hasRow, 'No letters in database');

      // Click a non-interactive cell. The row center can land on the review
      // flag button, which intentionally stops propagation.
      await firstRow.locator('[data-column="sender"]').click();
      await page.waitForURL(/\/admin\/letters\//);

      // Exercise route-level back navigation from the normal letter review.
      await page.goBack();
      await page.waitForURL(/\/admin$/);
      expect(page.url()).toMatch(/\/admin$/);
    });

    test('logout returns to login page', async ({ page }) => {
      // Logout button is on the Settings page
      await page.goto('/admin/settings', { waitUntil: 'domcontentloaded' });
      const logoutBtn = page.locator(SELECTORS.dashboard.logoutBtn);
      await logoutBtn.waitFor({ state: 'visible', timeout: 10000 });
      await logoutBtn.click();

      await page.waitForURL(/\/admin-login/);
      expect(page.url()).toContain('/admin-login');
    });
  });

  test.describe('Browser Navigation', () => {
    test('back button works on public pages', async ({ page }) => {
      await page.goto('/', { waitUntil: 'networkidle' });
      await page.goto('/collections', { waitUntil: 'networkidle' });

      await page.goBack();
      await page.waitForURL(/^\/?$|^http:\/\/[^/]+\/?$/, { timeout: 10000 });

      const url = new URL(page.url());
      expect(url.pathname).toMatch(/^\/?$/);
    });

    test('back button works on admin pages', async ({ page }) => {
      await loginAsAdmin(page);

      // Admin pages open a long-lived SSE notification stream, so `networkidle`
      // never resolves — use `domcontentloaded` instead.
      await page.goto('/admin', { waitUntil: 'domcontentloaded' });
      await page.goto('/admin/upload', { waitUntil: 'domcontentloaded' });

      await page.goBack();
      await page.waitForURL(/\/admin$/, { timeout: 10000 });

      expect(page.url()).toMatch(/\/admin$/);
    });

    test('forward button works', async ({ page }) => {
      await page.goto('/', { waitUntil: 'networkidle' });
      await page.goto('/collections', { waitUntil: 'networkidle' });

      await page.goBack();
      await page.waitForURL(/^\/?$|^http:\/\/[^/]+\/?$/, { timeout: 10000 });

      await page.goForward();
      await page.waitForURL(/\/collections/, { timeout: 10000 });

      expect(page.url()).toContain('/collections');
    });
  });

  test.describe('Deep Linking', () => {
    test('can directly access letter by URL', async ({ page }) => {
      // First get a valid letter ID
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');

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

      await firstRow.locator('[data-column="sender"]').click();
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
      await page.waitForLoadState('domcontentloaded');

      await expect(page.getByRole('heading', {
        name: 'Page not found',
      })).toBeVisible();
      await expect(page.getByRole('link', {
        name: 'Back to Home',
      })).toBeVisible();
    });

    test('shows error for invalid admin route', async ({ page }) => {
      await loginAsAdmin(page);
      await page.goto('/admin/invalid-route-xyz');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.getByRole('heading', {
        name: 'Page not found',
      })).toBeVisible();
    });
  });
});
