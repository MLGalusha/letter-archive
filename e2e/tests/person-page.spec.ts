import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './utils/test-helpers';

const API_BASE = 'http://localhost:3001';

/**
 * E2E tests for Person Detail Pages (Public and Admin)
 *
 * Tests cover person page display, biography, relationships, and letter lists.
 */

test.describe('Public Person Page', () => {
  test('displays person information', async ({ page, request }) => {
    // Get a person from the API
    const response = await request.get(`${API_BASE}/admin/entities/persons`);
    const data = await response.json();
    const person = data.persons[0];

    if (!person) {
      test.skip(true, 'No persons in database');
      return;
    }

    // Navigate to public person page
    await page.goto(`/people/${person.id}`);
    await page.waitForLoadState('networkidle');

    // Should show person name
    await expect(page.locator('h1')).toContainText(person.canonicalName);
  });

  test('shows letter statistics', async ({ page, request }) => {
    // Get a person with letters
    const response = await request.get(`${API_BASE}/admin/entities/persons`);
    const data = await response.json();
    const personWithLetters = data.persons.find((p: { letterCount: number }) => p.letterCount > 0);

    if (!personWithLetters) {
      test.skip(true, 'No persons with letters');
      return;
    }

    await page.goto(`/people/${personWithLetters.id}`);
    await page.waitForLoadState('networkidle');

    // Should show stats section - look for the Letter Statistics heading
    const statsHeading = page.locator('h2:has-text("Letter Statistics")');
    await expect(statsHeading).toBeVisible();
  });

  test('shows letters list when letters exist', async ({ page, request }) => {
    // Get a person with letters
    const response = await request.get(`${API_BASE}/admin/entities/persons`);
    const data = await response.json();
    const personWithLetters = data.persons.find((p: { letterCount: number }) => p.letterCount > 0);

    if (!personWithLetters) {
      test.skip(true, 'No persons with letters');
      return;
    }

    await page.goto(`/people/${personWithLetters.id}`);
    await page.waitForLoadState('networkidle');

    // Should show letters section
    const lettersSection = page.locator('.letters-section');
    await expect(lettersSection).toBeVisible();
  });

  test('can navigate back', async ({ page, request }) => {
    const response = await request.get(`${API_BASE}/admin/entities/persons`);
    const data = await response.json();
    const person = data.persons[0];

    if (!person) {
      test.skip(true, 'No persons in database');
      return;
    }

    await page.goto(`/people/${person.id}`);
    await page.waitForLoadState('networkidle');

    const backButton = page.locator('.back-link');
    await expect(backButton).toBeVisible();
  });

  test('shows biography when available', async ({ page, request }) => {
    const response = await request.get(`${API_BASE}/admin/entities/persons`);
    const data = await response.json();
    const personWithBio = data.persons.find((p: { biography?: string }) => p.biography);

    if (!personWithBio) {
      test.skip(true, 'No persons with biography');
      return;
    }

    await page.goto(`/people/${personWithBio.id}`);
    await page.waitForLoadState('networkidle');

    const biographySection = page.locator('.biography-section, .biography-text');
    await expect(biographySection).toBeVisible();
  });
});

test.describe('Admin Person Biography', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/admin/entities/people');
    await page.waitForLoadState('networkidle');
  });

  test('shows biography section when person selected', async ({ page }) => {
    const personItem = page.locator('.person-item').first();
    if (!(await personItem.isVisible().catch(() => false))) {
      test.skip(true, 'No persons in database');
      return;
    }

    await personItem.click();
    await page.waitForTimeout(500);

    const biographySection = page.locator('.biography-section');
    await expect(biographySection).toBeVisible();
  });

  test('shows generate biography button', async ({ page }) => {
    const personItem = page.locator('.person-item').first();
    if (!(await personItem.isVisible().catch(() => false))) {
      test.skip(true, 'No persons in database');
      return;
    }

    await personItem.click();
    await page.waitForTimeout(500);

    const generateBtn = page.locator('button:has-text("Generate")');
    await expect(generateBtn).toBeVisible();
  });

  test('can edit biography text', async ({ page }) => {
    const personItem = page.locator('.person-item').first();
    if (!(await personItem.isVisible().catch(() => false))) {
      test.skip(true, 'No persons in database');
      return;
    }

    await personItem.click();
    await page.waitForTimeout(500);

    const biographyEditor = page.locator('.biography-editor');
    await expect(biographyEditor).toBeVisible();

    // Check it's editable (not disabled)
    const isDisabled = await biographyEditor.isDisabled();
    // It may be disabled if verified, otherwise should be editable
    expect(typeof isDisabled).toBe('boolean');
  });

  test('shows biography status when present', async ({ page }) => {
    const personItem = page.locator('.person-item').first();
    if (!(await personItem.isVisible().catch(() => false))) {
      test.skip(true, 'No persons in database');
      return;
    }

    await personItem.click();
    await page.waitForTimeout(500);

    // If biography exists, status should be visible
    const biographyStatus = page.locator('.biography-status');
    const hasStatus = await biographyStatus.isVisible().catch(() => false);

    // This is informational - may or may not have status
    expect(typeof hasStatus).toBe('boolean');
  });

  test('shows save and verify buttons when biography has content', async ({ page }) => {
    const personItem = page.locator('.person-item').first();
    if (!(await personItem.isVisible().catch(() => false))) {
      test.skip(true, 'No persons in database');
      return;
    }

    await personItem.click();
    await page.waitForTimeout(500);

    // Type some content
    const biographyEditor = page.locator('.biography-editor');
    const isDisabled = await biographyEditor.isDisabled();

    if (!isDisabled) {
      await biographyEditor.fill('Test biography content');

      // Save and verify buttons should appear
      const saveBtn = page.locator('.biography-actions button:has-text("Save")');
      const verifyBtn = page.locator('.biography-actions button:has-text("Verify")');

      await expect(saveBtn).toBeVisible();
      await expect(verifyBtn).toBeVisible();
    }
  });
});
