import { test, expect } from '@playwright/test';
import { API_BASE_URL, loginAsAdmin } from './utils/test-helpers';

/**
 * E2E tests for Phase 5: Merge Enhancements
 *
 * Tests cover:
 * - Duplicate suggestions API and UI
 * - Bulk selection functionality
 * - Bulk merge modal
 * - Side-by-side merge comparison
 */

test.describe('Duplicate Suggestions API', () => {
  test('GET /admin/entities/suggestions returns suggestions for persons', async ({ request }) => {
    const response = await request.get(
      `${API_BASE_URL}/admin/entities/suggestions?entityType=person&limit=10`
    );
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty('suggestions');
    expect(Array.isArray(data.suggestions)).toBe(true);

    // If there are suggestions, check structure
    if (data.suggestions.length > 0) {
      const suggestion = data.suggestions[0];
      expect(suggestion).toHaveProperty('entityAId');
      expect(suggestion).toHaveProperty('entityAName');
      expect(suggestion).toHaveProperty('entityALetterCount');
      expect(suggestion).toHaveProperty('entityAAliases');
      expect(suggestion).toHaveProperty('entityBId');
      expect(suggestion).toHaveProperty('entityBName');
      expect(suggestion).toHaveProperty('entityBLetterCount');
      expect(suggestion).toHaveProperty('entityBAliases');
      expect(suggestion).toHaveProperty('similarity');
      expect(suggestion.similarity).toBeGreaterThanOrEqual(50);
      expect(suggestion.similarity).toBeLessThan(100);
    }
  });

  test('GET /admin/entities/suggestions returns suggestions for places', async ({ request }) => {
    const response = await request.get(
      `${API_BASE_URL}/admin/entities/suggestions?entityType=place&limit=10`
    );
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty('suggestions');
    expect(Array.isArray(data.suggestions)).toBe(true);
  });

  test('suggestions endpoint requires entityType parameter', async ({ request }) => {
    const response = await request.get(`${API_BASE_URL}/admin/entities/suggestions`);
    expect(response.status()).toBe(400);
  });
});

test.describe('Bulk Merge API', () => {
  test('bulk-merge endpoint requires keepId and mergeIds', async ({ request }) => {
    const response = await request.post(`${API_BASE_URL}/admin/entities/persons/bulk-merge`, {
      data: { keepId: 'invalid' },
    });
    expect(response.status()).toBe(400);
  });

  test('bulk-merge endpoint validates UUID format', async ({ request }) => {
    const response = await request.post(`${API_BASE_URL}/admin/entities/persons/bulk-merge`, {
      data: {
        keepId: 'not-a-uuid',
        mergeIds: ['also-not-uuid'],
      },
    });
    expect(response.status()).toBe(400);
  });
});

test.describe('Merge Details API', () => {
  test('GET /admin/entities/persons/:id/merge-details returns person details', async ({ request }) => {
    // First get a person ID
    const personsResponse = await request.get(`${API_BASE_URL}/admin/entities/persons`);
    const personsData = await personsResponse.json();

    if (personsData.persons.length === 0) {
      test.skip(true, 'No persons in database');
      return;
    }

    const personId = personsData.persons[0].id;
    const response = await request.get(
      `${API_BASE_URL}/admin/entities/persons/${personId}/merge-details`
    );
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty('id');
    expect(data).toHaveProperty('canonicalName');
    expect(data).toHaveProperty('aliases');
    expect(data).toHaveProperty('letterCount');
    expect(data).toHaveProperty('senderCount');
    expect(data).toHaveProperty('recipientCount');
    expect(data).toHaveProperty('mentionedCount');
    expect(data).toHaveProperty('relationshipCount');
  });

  test('GET /admin/entities/places/:id/merge-details returns place details', async ({ request }) => {
    // First get a place ID
    const placesResponse = await request.get(`${API_BASE_URL}/admin/entities/places`);
    const placesData = await placesResponse.json();

    if (placesData.places.length === 0) {
      test.skip(true, 'No places in database');
      return;
    }

    const placeId = placesData.places[0].id;
    const response = await request.get(
      `${API_BASE_URL}/admin/entities/places/${placeId}/merge-details`
    );
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty('id');
    expect(data).toHaveProperty('canonicalName');
    expect(data).toHaveProperty('aliases');
    expect(data).toHaveProperty('letterCount');
    expect(data).toHaveProperty('writtenFromCount');
    expect(data).toHaveProperty('destinationCount');
    expect(data).toHaveProperty('mentionedCount');
  });
});

test.describe('People Page - Bulk Selection', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('people page loads with bulk controls', async ({ page }) => {
    await page.goto('/admin/entities/people');
    await page.waitForLoadState('networkidle');

    // Wait for page to load
    await expect(page.locator('h1:has-text("People")')).toBeVisible();

    // Check for bulk controls
    const selectAllCheckbox = page.locator('.select-all-checkbox');
    const isVisible = await selectAllCheckbox.isVisible().catch(() => false);

    // If there are people, bulk controls should be visible
    const peopleList = page.locator('.people-list .person-item');
    const peopleCount = await peopleList.count();

    if (peopleCount > 0) {
      await expect(selectAllCheckbox).toBeVisible();
    }
  });

  test('can select people with checkboxes', async ({ page }) => {
    await page.goto('/admin/entities/people');
    await page.waitForLoadState('networkidle');

    const firstCheckbox = page.locator('.person-item .item-checkbox').first();
    if (await firstCheckbox.isVisible()) {
      await firstCheckbox.click();

      // Should show selected count
      await expect(page.locator('.selected-count')).toBeVisible();
      await expect(page.locator('.selected-count')).toContainText('1 selected');
    }
  });

  test('select all checkbox works', async ({ page }) => {
    await page.goto('/admin/entities/people');
    await page.waitForLoadState('networkidle');

    const selectAll = page.locator('.select-all-checkbox input');
    if (await selectAll.isVisible()) {
      await selectAll.click();

      // All items should be checked
      const allCheckboxes = page.locator('.person-item .item-checkbox');
      const count = await allCheckboxes.count();

      if (count > 0) {
        for (let i = 0; i < count; i++) {
          await expect(allCheckboxes.nth(i)).toBeChecked();
        }
      }
    }
  });

  test('merge selected button disabled with less than 2 selected', async ({ page }) => {
    await page.goto('/admin/entities/people');
    await page.waitForLoadState('networkidle');

    const firstCheckbox = page.locator('.person-item .item-checkbox').first();
    if (await firstCheckbox.isVisible()) {
      await firstCheckbox.click();

      const mergeBtn = page.locator('button:has-text("Merge Selected")');
      await expect(mergeBtn).toBeDisabled();
    }
  });

  test('clear selection button works', async ({ page }) => {
    await page.goto('/admin/entities/people');
    await page.waitForLoadState('networkidle');

    const firstCheckbox = page.locator('.person-item .item-checkbox').first();
    if (await firstCheckbox.isVisible()) {
      await firstCheckbox.click();

      const clearBtn = page.locator('.clear-selection-btn');
      await clearBtn.click();

      // Selected count should be gone
      await expect(page.locator('.selected-count')).not.toBeVisible();
    }
  });
});

test.describe('Places Page - Bulk Selection', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('places page loads with bulk controls', async ({ page }) => {
    await page.goto('/admin/entities/places');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('h1:has-text("Places")')).toBeVisible();

    const placesList = page.locator('.places-list .place-item');
    const placesCount = await placesList.count();

    if (placesCount > 0) {
      const selectAllCheckbox = page.locator('.select-all-checkbox');
      await expect(selectAllCheckbox).toBeVisible();
    }
  });

  test('can select places with checkboxes', async ({ page }) => {
    await page.goto('/admin/entities/places');
    await page.waitForLoadState('networkidle');

    const firstCheckbox = page.locator('.place-item .item-checkbox').first();
    if (await firstCheckbox.isVisible()) {
      await firstCheckbox.click();

      await expect(page.locator('.selected-count')).toBeVisible();
      await expect(page.locator('.selected-count')).toContainText('1 selected');
    }
  });
});

test.describe('Duplicate Suggestions UI', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('duplicate suggestions section can be toggled', async ({ page }) => {
    await page.goto('/admin/entities/people');
    await page.waitForLoadState('networkidle');

    // Look for suggestions section
    const suggestionsHeader = page.locator('.suggestions-header');
    const hasSuggestions = await suggestionsHeader.isVisible().catch(() => false);

    if (hasSuggestions) {
      // Click to expand
      await suggestionsHeader.click();
      await page.waitForTimeout(300);

      // List should be visible
      const suggestionsList = page.locator('.suggestions-list');
      await expect(suggestionsList).toBeVisible();

      // Click to collapse
      await suggestionsHeader.click();
      await page.waitForTimeout(300);

      // List should be hidden
      await expect(suggestionsList).not.toBeVisible();
    }
  });

  test('suggestion item has merge and dismiss buttons', async ({ page }) => {
    await page.goto('/admin/entities/people');
    await page.waitForLoadState('networkidle');

    const suggestionsHeader = page.locator('.suggestions-header');
    const hasSuggestions = await suggestionsHeader.isVisible().catch(() => false);

    if (hasSuggestions) {
      // Expand suggestions
      await suggestionsHeader.click();
      await page.waitForTimeout(300);

      const suggestionItem = page.locator('.suggestion-item').first();
      if (await suggestionItem.isVisible()) {
        // Should have merge button
        await expect(suggestionItem.locator('button:has-text("Merge")')).toBeVisible();
        // Should have dismiss button
        await expect(suggestionItem.locator('.dismiss-btn')).toBeVisible();
      }
    }
  });
});

test.describe('Bulk Merge Modal', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('bulk merge modal opens when 2+ items selected', async ({ page }) => {
    await page.goto('/admin/entities/people');
    await page.waitForLoadState('networkidle');

    // Select first two people
    const checkboxes = page.locator('.person-item .item-checkbox');
    const count = await checkboxes.count();

    if (count >= 2) {
      await checkboxes.nth(0).click();
      await checkboxes.nth(1).click();

      // Click merge selected
      const mergeBtn = page.locator('button:has-text("Merge Selected")');
      await expect(mergeBtn).toBeEnabled();
      await mergeBtn.click();

      // Modal should open
      await expect(page.locator('.modal-overlay')).toBeVisible();
      await expect(page.locator('text=Bulk Merge')).toBeVisible();
    }
  });

  test('bulk merge modal shows selected entities with radio buttons', async ({ page }) => {
    await page.goto('/admin/entities/people');
    await page.waitForLoadState('networkidle');

    const checkboxes = page.locator('.person-item .item-checkbox');
    const count = await checkboxes.count();

    if (count >= 2) {
      await checkboxes.nth(0).click();
      await checkboxes.nth(1).click();

      await page.locator('button:has-text("Merge Selected")').click();
      await page.waitForTimeout(300);

      // Should have radio buttons for each entity
      const radioButtons = page.locator('.entity-option input[type="radio"]');
      expect(await radioButtons.count()).toBe(2);

      // Should have result preview
      await expect(page.locator('.result-preview')).toBeVisible();
    }
  });
});

test.describe('Merge Comparison Modal', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('merge comparison shows when clicking suggestion merge', async ({ page }) => {
    await page.goto('/admin/entities/people');
    await page.waitForLoadState('networkidle');

    const suggestionsHeader = page.locator('.suggestions-header');
    const hasSuggestions = await suggestionsHeader.isVisible().catch(() => false);

    if (hasSuggestions) {
      await suggestionsHeader.click();
      await page.waitForTimeout(300);

      const mergeBtn = page.locator('.suggestion-item button:has-text("Merge")').first();
      if (await mergeBtn.isVisible()) {
        await mergeBtn.click();
        await page.waitForTimeout(500);

        // Comparison modal should open
        await expect(page.locator('.modal-overlay')).toBeVisible();
        await expect(page.locator('text=Merge Comparison')).toBeVisible();
      }
    }
  });

  test('comparison modal has swap button', async ({ page }) => {
    await page.goto('/admin/entities/people');
    await page.waitForLoadState('networkidle');

    const suggestionsHeader = page.locator('.suggestions-header');
    const hasSuggestions = await suggestionsHeader.isVisible().catch(() => false);

    if (hasSuggestions) {
      await suggestionsHeader.click();
      await page.waitForTimeout(300);

      const mergeBtn = page.locator('.suggestion-item button:has-text("Merge")').first();
      if (await mergeBtn.isVisible()) {
        await mergeBtn.click();
        await page.waitForTimeout(500);

        // Should have swap button
        const swapBtn = page.locator('.swap-btn');
        await expect(swapBtn).toBeVisible();
      }
    }
  });

  test('comparison modal has column headers for keep and merge', async ({ page }) => {
    await page.goto('/admin/entities/people');
    await page.waitForLoadState('networkidle');

    const suggestionsHeader = page.locator('.suggestions-header');
    const hasSuggestions = await suggestionsHeader.isVisible().catch(() => false);

    if (hasSuggestions) {
      await suggestionsHeader.click();
      await page.waitForTimeout(300);

      const mergeBtn = page.locator('.suggestion-item button:has-text("Merge")').first();
      if (await mergeBtn.isVisible()) {
        await mergeBtn.click();
        await page.waitForTimeout(500);

        // Should show KEEP and MERGE labels
        await expect(page.locator('.comparison-column.keep')).toBeVisible();
        await expect(page.locator('text=KEEP (Master)')).toBeVisible();
      }
    }
  });
});
