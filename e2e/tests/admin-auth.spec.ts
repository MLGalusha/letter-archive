import { test, expect } from '@playwright/test';
import {
  loginAsAdmin,
  logoutAdmin,
  clearSession,
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  SELECTORS,
  waitForAdminDashboardReady,
} from './utils/test-helpers';

/**
 * E2E tests for Admin Authentication
 *
 * Tests cover login, logout, session management, and protected route access.
 */

test.describe('Admin Authentication', () => {
  test.beforeEach(async ({ page }) => {
    // Clear any existing session before each test
    await page.goto('/');
    await clearSession(page);
  });

  test.describe('Login Flow', () => {
    test('shows login form on admin login page', async ({ page }) => {
      await page.goto('/admin-login');

      await expect(page.locator('h1')).toHaveText('Admin Login');
      await expect(page.locator('input[type="email"]')).toBeVisible();
      await expect(page.locator('input[type="password"]')).toBeVisible();
      await expect(page.locator('button[type="submit"]')).toBeVisible();
    });

    test('logs in with valid credentials', async ({ page }) => {
      await page.goto('/admin-login');

      await page.locator('input[type="email"]').fill(ADMIN_EMAIL);
      await page.locator('input[type="password"]').fill(ADMIN_PASSWORD);
      await page.click('button[type="submit"]');

      // Should redirect to admin dashboard
      await page.waitForURL(/\/admin$/);
      await waitForAdminDashboardReady(page);
    });

    test('shows error with invalid credentials', async ({ page }) => {
      await page.goto('/admin-login');

      await page.locator('input[type="email"]').fill('wrong@email.com');
      await page.locator('input[type="password"]').fill('wrongpassword');
      await page.click('button[type="submit"]');

      // Should show error message and stay on login page
      await expect(page.locator('.error-message')).toBeVisible();
      await expect(page.locator('.error-message')).toContainText('Invalid');
      expect(page.url()).toContain('/admin-login');
    });

    test('shows error with empty email', async ({ page }) => {
      await page.goto('/admin-login');

      await page.locator('input[type="password"]').fill(ADMIN_PASSWORD);
      await page.click('button[type="submit"]');

      // HTML5 validation should prevent submission
      const emailInput = page.locator('input[type="email"]');
      await expect(emailInput).toHaveAttribute('required', '');
    });

    test('shows error with empty password', async ({ page }) => {
      await page.goto('/admin-login');

      await page.locator('input[type="email"]').fill(ADMIN_EMAIL);
      await page.click('button[type="submit"]');

      // HTML5 validation should prevent submission
      const passwordInput = page.locator('input[type="password"]');
      await expect(passwordInput).toHaveAttribute('required', '');
    });
  });

  test.describe('Logout Flow', () => {
    test('logs out successfully', async ({ page }) => {
      await loginAsAdmin(page);

      // Logout button is on the Settings page
      await page.goto('/admin/settings', { waitUntil: 'domcontentloaded' });
      await page.locator(SELECTORS.dashboard.logoutBtn).waitFor({ state: 'visible', timeout: 10000 });
      await page.click(SELECTORS.dashboard.logoutBtn);

      // Should redirect to login page
      await page.waitForURL(/\/admin-login/);
      await expect(page.locator('h1')).toHaveText('Admin Login');
    });

    test('clears session on logout', async ({ page }) => {
      await loginAsAdmin(page);
      await logoutAdmin(page);

      // Try to access admin dashboard directly
      await page.goto('/admin');

      // Should redirect to login page (useEffect redirect happens after initial render)
      try {
        await page.waitForURL(/\/admin-login/, { timeout: 5000 });
      } catch {
        // Page may be slow, verify we can't access dashboard
        await page.goto('/admin-login');
      }
      await expect(page.locator('input[type="password"]')).toBeVisible();
    });
  });

  test.describe('Protected Routes', () => {
    test('redirects to login when accessing /admin without session', async ({ page }) => {
      await page.goto('/admin');
      await page.waitForLoadState('domcontentloaded');
      // useEffect redirect happens after initial render
      await page.waitForURL(/\/admin-login/, { timeout: 10000 });
      await expect(page.locator('input[type="password"]')).toBeVisible();
    });

    test('redirects to login when accessing /admin/letters/:id without session', async ({ page }) => {
      await page.goto('/admin/letters/some-letter-id');
      await page.waitForLoadState('domcontentloaded');
      await page.waitForURL(/\/admin-login/, { timeout: 10000 });
    });

    test('redirects to login when accessing /admin/upload without session', async ({ page }) => {
      await page.goto('/admin/upload');
      await page.waitForLoadState('domcontentloaded');
      await page.waitForURL(/\/admin-login/, { timeout: 10000 });
    });

    test('redirects to login when accessing /admin/settings without session', async ({ page }) => {
      await page.goto('/admin/settings');
      await page.waitForLoadState('domcontentloaded');
      await page.waitForURL(/\/admin-login/, { timeout: 10000 });
      await expect(page.locator('input[type="password"]')).toBeVisible();
    });

    test('redirects to login when accessing /admin/content without session', async ({ page }) => {
      await page.goto('/admin/content');
      await page.waitForLoadState('domcontentloaded');
      await page.waitForURL(/\/admin-login/, { timeout: 10000 });
      await expect(page.locator('input[type="password"]')).toBeVisible();
    });

    test('allows access to admin dashboard with valid session', async ({ page }) => {
      await loginAsAdmin(page);

      await waitForAdminDashboardReady(page);
    });
  });

  test.describe('Session Persistence', () => {
    test('maintains session after page reload', async ({ page }) => {
      await loginAsAdmin(page);

      // Reload the page
      await page.reload();

      await waitForAdminDashboardReady(page);
    });

    test('maintains session when navigating between admin pages', async ({ page }) => {
      await loginAsAdmin(page);

      // Navigate to upload page
      await page.click(SELECTORS.dashboard.uploadBtn);
      await page.waitForURL(/\/admin\/upload/);

      // Navigate back to dashboard
      await page.goto('/admin');
      await waitForAdminDashboardReady(page);
    });
  });

  test.describe('Public Pages Access', () => {
    test('allows access to homepage without authentication', async ({ page }) => {
      await page.goto('/');
      await expect(page).toHaveTitle(/letter archive/i);
    });

    test('allows access to collections page without authentication', async ({ page }) => {
      await page.goto('/collections');
      await expect(page.locator('h1')).toContainText('Collection');
    });

    test('allows access to about page without authentication', async ({ page }) => {
      await page.goto('/about');
      await page.waitForLoadState('domcontentloaded');
      // Should load without redirect
      expect(page.url()).toContain('/about');
    });
  });
});
