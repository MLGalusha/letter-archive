import { test, expect } from '@playwright/test';

test('homepage loads', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/fragments-of-us/i);
});

test('admin login page loads', async ({ page }) => {
  await page.goto('/admin-login');
  await expect(page.locator('input[type="password"]')).toBeVisible();
});
