import { test, expect } from '@playwright/test';
import { API_BASE_URL, loginAsAdmin } from './utils/test-helpers';

/**
 * E2E tests for Relationship Graph Feature (Phase 4)
 *
 * Tests cover:
 * - Public Explore page with graph visualization
 * - Collection filtering
 * - Connection finder
 * - Admin relationships page
 * - Relationship CRUD operations
 */

test.describe('Public Explore Page', () => {
  test('explore page loads and shows graph or empty state', async ({ page }) => {
    await page.goto('/explore');
    await page.waitForLoadState('networkidle');

    // Page should have the explore page structure
    await expect(page.locator('h1:has-text("Explore Relationships")')).toBeVisible();

    // Should have collection selector
    await expect(page.locator('#collection-select')).toBeVisible();

    // Should show either graph or empty state
    const graph = page.locator('.graph-svg');
    const emptyState = page.locator('.empty-state');

    const hasGraph = await graph.isVisible().catch(() => false);
    const hasEmptyState = await emptyState.isVisible().catch(() => false);

    // One of them should be visible
    expect(hasGraph || hasEmptyState).toBe(true);
  });

  test('collection selector changes graph data', async ({ page }) => {
    await page.goto('/explore');
    await page.waitForLoadState('networkidle');

    const selector = page.locator('#collection-select');
    await expect(selector).toBeVisible();

    // Get options count
    const options = await selector.locator('option').count();
    expect(options).toBeGreaterThanOrEqual(1); // At least "All Collections"

    // If there are collection options, try changing
    if (options > 1) {
      await selector.selectOption({ index: 1 });
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(500);

      // Page should update (may show different data or empty state)
      const pageContent = await page.content();
      expect(pageContent).toContain('Explore Relationships');
    }
  });

  test('connection finder toggle works', async ({ page }) => {
    await page.goto('/explore');
    await page.waitForLoadState('networkidle');

    // Find and click the connection finder toggle
    const toggle = page.locator('button:has-text("Show Connection Finder")');
    await expect(toggle).toBeVisible();
    await toggle.click();

    // Connection finder should appear
    await expect(page.locator('.connection-finder')).toBeVisible();
    await expect(page.locator('.finder-header')).toBeVisible();

    // Click again to hide
    await page.locator('button:has-text("Hide Connection Finder")').click();

    // Connection finder should be hidden
    await expect(page.locator('.connection-finder')).not.toBeVisible();
  });

  test('graph has zoom controls', async ({ page }) => {
    await page.goto('/explore');
    await page.waitForLoadState('networkidle');

    const graph = page.locator('.graph-svg');
    if (await graph.isVisible()) {
      // Check for zoom controls
      const zoomIn = page.locator('.graph-control-btn[title="Zoom In"]');
      const zoomOut = page.locator('.graph-control-btn[title="Zoom Out"]');
      const reset = page.locator('.graph-control-btn[title="Reset View"]');

      await expect(zoomIn).toBeVisible();
      await expect(zoomOut).toBeVisible();
      await expect(reset).toBeVisible();
    } else {
      test.skip(true, 'No graph visible - no relationships in database');
    }
  });

  test('instructions section is visible', async ({ page }) => {
    await page.goto('/explore');
    await page.waitForLoadState('networkidle');

    // Should show instructions
    await expect(page.locator('.graph-instructions')).toBeVisible();
    await expect(page.locator('.graph-instructions h4:has-text("Instructions")')).toBeVisible();
  });
});

test.describe('Admin Relationships Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('relationships page loads with table view by default', async ({ page }) => {
    await page.goto('/admin/entities/relationships');
    await page.waitForLoadState('networkidle');

    // Page title
    await expect(page.locator('h1:has-text("Relationships")')).toBeVisible();

    // View toggle should show Table as active
    const tableToggle = page.locator('.toggle-btn:has-text("Table")');
    await expect(tableToggle).toHaveClass(/active/);

    // Should show table or empty state
    const table = page.locator('.relationships-table');
    const emptyState = page.locator('.empty-state');

    const hasTable = await table.isVisible().catch(() => false);
    const hasEmpty = await emptyState.isVisible().catch(() => false);

    expect(hasTable || hasEmpty).toBe(true);
  });

  test('can switch between table and graph views', async ({ page }) => {
    await page.goto('/admin/entities/relationships');
    await page.waitForLoadState('networkidle');

    // Wait for the page header to be visible (ensures page is fully loaded)
    await expect(page.locator('h1:has-text("Relationships")')).toBeVisible();

    // Switch to graph view
    await page.locator('.toggle-btn:has-text("Graph")').click();
    await page.waitForTimeout(300);

    // Graph toggle should now be active
    await expect(page.locator('.toggle-btn:has-text("Graph")')).toHaveClass(/active/);

    // Should show graph view wrapper
    const graph = page.locator('.graph-view');
    await expect(graph).toBeVisible();

    // Switch back to table
    await page.locator('.toggle-btn:has-text("Table")').click();
    await page.waitForTimeout(300);

    await expect(page.locator('.toggle-btn:has-text("Table")')).toHaveClass(/active/);
  });

  test('add relationship button opens modal', async ({ page }) => {
    await page.goto('/admin/entities/relationships');
    await page.waitForLoadState('networkidle');

    // Wait for the page header to be visible (ensures page is fully loaded)
    await expect(page.locator('h1:has-text("Relationships")')).toBeVisible();

    // Click add button
    await page.locator('button:has-text("Add Relationship")').click();
    await page.waitForTimeout(300);

    // Modal should appear (check for modal overlay with title)
    await expect(page.locator('.modal-overlay')).toBeVisible();
    await expect(page.locator('.modal-title:has-text("Add Relationship")')).toBeVisible();

    // Should have person A and B search fields
    await expect(page.locator('label:has-text("Person A")')).toBeVisible();
    await expect(page.locator('label:has-text("Person B")')).toBeVisible();
    await expect(page.locator('label:has-text("Type")')).toBeVisible();

    // Close modal
    await page.locator('.modal-close').click();
    await expect(page.locator('.modal-overlay')).not.toBeVisible();
  });

  test('table view has filter controls', async ({ page }) => {
    await page.goto('/admin/entities/relationships');
    await page.waitForLoadState('networkidle');

    // Search input
    await expect(page.locator('.search-input')).toBeVisible();

    // Type filter dropdown
    await expect(page.locator('.type-filter')).toBeVisible();
  });

  test('graph view has connection finder toggle', async ({ page }) => {
    await page.goto('/admin/entities/relationships');
    await page.waitForLoadState('networkidle');

    // Wait for the page header to be visible (ensures page is fully loaded)
    await expect(page.locator('h1:has-text("Relationships")')).toBeVisible();

    // Switch to graph view
    await page.locator('.toggle-btn:has-text("Graph")').click();
    await page.waitForTimeout(300);

    // Connection finder toggle should be visible
    await expect(page.locator('.finder-toggle')).toBeVisible();
  });
});

test.describe('Relationships API', () => {
  test('GET /relationships returns graph data structure', async ({ request }) => {
    const response = await request.get(`${API_BASE_URL}/relationships`);
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty('nodes');
    expect(data).toHaveProperty('edges');
    expect(Array.isArray(data.nodes)).toBe(true);
    expect(Array.isArray(data.edges)).toBe(true);

    // If there are nodes, check structure
    if (data.nodes.length > 0) {
      expect(data.nodes[0]).toHaveProperty('id');
      expect(data.nodes[0]).toHaveProperty('name');
      expect(data.nodes[0]).toHaveProperty('letterCount');
    }

    // If there are edges, check structure
    if (data.edges.length > 0) {
      expect(data.edges[0]).toHaveProperty('id');
      expect(data.edges[0]).toHaveProperty('source');
      expect(data.edges[0]).toHaveProperty('target');
      expect(data.edges[0]).toHaveProperty('relationshipType');
    }
  });

  test('GET /relationships/path/:personAId/:personBId returns path structure', async ({ request }) => {
    // First get some relationships to get person IDs
    const relResponse = await request.get(`${API_BASE_URL}/relationships`);
    const relData = await relResponse.json();

    if (relData.nodes.length < 2) {
      test.skip(true, 'Not enough people for path finding test');
      return;
    }

    const personAId = relData.nodes[0].id;
    const personBId = relData.nodes[1].id;

    const response = await request.get(
      `${API_BASE_URL}/relationships/path/${personAId}/${personBId}`
    );
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty('path');
    expect(data).toHaveProperty('edges');
    expect(Array.isArray(data.path)).toBe(true);
    expect(Array.isArray(data.edges)).toBe(true);
  });

  test('GET /admin/relationships returns relationship list', async ({ request }) => {
    const response = await request.get(`${API_BASE_URL}/admin/relationships`);
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(Array.isArray(data)).toBe(true);

    // If there are relationships, check structure
    if (data.length > 0) {
      expect(data[0]).toHaveProperty('id');
      expect(data[0]).toHaveProperty('personAId');
      expect(data[0]).toHaveProperty('personBId');
      expect(data[0]).toHaveProperty('personAName');
      expect(data[0]).toHaveProperty('personBName');
      expect(data[0]).toHaveProperty('relationshipType');
    }
  });
});

test.describe('Connection Finder', () => {
  test('connection finder component has proper structure', async ({ page }) => {
    await page.goto('/explore');
    await page.waitForLoadState('networkidle');

    // Open connection finder
    await page.locator('button:has-text("Show Connection Finder")').click();
    await page.waitForTimeout(300);

    const finder = page.locator('.connection-finder');
    await expect(finder).toBeVisible();

    // Check for inputs
    await expect(finder.locator('label:has-text("Person A")')).toBeVisible();
    await expect(finder.locator('label:has-text("Person B")')).toBeVisible();
    await expect(finder.locator('.finder-arrow')).toBeVisible();
  });

  test('selecting same person shows path of length 1', async ({ request }) => {
    // Get a person ID
    const relResponse = await request.get(`${API_BASE_URL}/relationships`);
    const relData = await relResponse.json();

    if (relData.nodes.length < 1) {
      test.skip(true, 'No people in database');
      return;
    }

    const personId = relData.nodes[0].id;

    // Same person path
    const response = await request.get(
      `${API_BASE_URL}/relationships/path/${personId}/${personId}`
    );
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data.path).toHaveLength(1);
    expect(data.edges).toHaveLength(0);
  });
});
