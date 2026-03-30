import { Page, expect } from '@playwright/test';

/**
 * Shared test utilities for E2E tests
 */

// Test credentials — must match the dev seed in backend/src/index.ts
export const ADMIN_EMAIL = 'dev@localhost.test';
export const ADMIN_PASSWORD = 'dev';
export const API_BASE_URL = process.env.E2E_API_BASE_URL || 'http://localhost:3002';
const DASHBOARD_SHELL_SELECTOR = '.admin-header';
const DASHBOARD_READY_SELECTOR = 'table.letters-table';

export async function waitForAdminDashboardReady(page: Page): Promise<void> {
  await page.locator(DASHBOARD_SHELL_SELECTOR).waitFor({ state: 'visible', timeout: 30000 });
  await page.locator(DASHBOARD_READY_SELECTOR).waitFor({ state: 'visible', timeout: 30000 });
}

/**
 * Login as admin user
 *
 * Goes directly to /admin-login to avoid a race condition: navigating to /admin
 * triggers React's useEffect auth redirect, but waitForLoadState('networkidle')
 * can resolve before the redirect fires, causing the helper to exit without logging in.
 *
 * After login, waits for the dashboard shell and table to confirm the initial
 * data load completed.
 */
export async function loginAsAdmin(page: Page): Promise<void> {
  // Use domcontentloaded — networkidle can hang on CI when Vite HMR websocket stays open
  await page.goto('/admin-login', { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"]').waitFor({ state: 'visible', timeout: 15000 });

  await page.locator('input[type="email"]').fill(ADMIN_EMAIL);
  await page.locator('input[type="password"]').fill(ADMIN_PASSWORD);
  await page.click('button[type="submit"]');

  await page.waitForURL(/\/admin$/, { timeout: 15000 });
  await waitForAdminDashboardReady(page);
}

/**
 * Logout from admin
 */
export async function logoutAdmin(page: Page): Promise<void> {
  // Logout button is on the Settings page
  await page.goto('/admin/settings', { waitUntil: 'domcontentloaded' });
  const logoutBtn = page.locator('button:has-text("Logout")');
  await logoutBtn.waitFor({ state: 'visible', timeout: 10000 });
  await logoutBtn.click();
  await page.waitForURL(/\/admin-login/);
}

/**
 * Navigate to first letter in admin dashboard.
 * Returns false if no letters exist (empty database).
 */
export async function navigateToFirstLetter(page: Page): Promise<boolean> {
  await waitForAdminDashboardReady(page);

  const firstRow = page.locator('table tbody tr').first();
  const hasRow = await firstRow
    .waitFor({ state: 'visible', timeout: 10000 })
    .then(() => true)
    .catch(() => false);

  if (hasRow) {
    await firstRow.click();
    await page.waitForURL(/\/admin\/letters\//);
    await page.waitForLoadState('networkidle');
    return true;
  }

  // Fallback: try via API in case dashboard rendering is slow
  const response = await page.request.get(`${API_BASE_URL}/admin/letters?limit=1`);
  if (!response.ok()) return false;

  const payload = await response.json();
  const letters = Array.isArray(payload) ? payload : payload.letters;
  if (!Array.isArray(letters) || letters.length === 0 || !letters[0]?.id) {
    return false;
  }

  await page.goto(`/admin/letters/${letters[0].id}`);
  await page.waitForLoadState('networkidle');
  return true;
}

/**
 * Navigate to a specific letter by ID
 */
export async function navigateToLetter(page: Page, letterId: string): Promise<void> {
  await page.goto(`/admin/letters/${letterId}`);
  await page.waitForLoadState('networkidle');
}

/**
 * Wait for table to load in admin dashboard
 */
export async function waitForDashboardTable(page: Page): Promise<void> {
  await page.locator('table tbody tr').first().waitFor({ state: 'visible', timeout: 10000 });
}

/**
 * Get the count of letters shown in the dashboard
 */
export async function getDashboardLetterCount(page: Page): Promise<number> {
  const rows = page.locator('table tbody tr');
  return await rows.count();
}

/**
 * Wait for a toast notification to appear
 */
export async function waitForToast(page: Page, text?: string): Promise<void> {
  const toastSelector = text
    ? `.toast:has-text("${text}")`
    : '.toast';
  await page.locator(toastSelector).waitFor({ state: 'visible', timeout: 5000 });
}

/**
 * Dismiss any visible toast notifications
 */
export async function dismissToasts(page: Page): Promise<void> {
  const toasts = page.locator('.toast');
  const count = await toasts.count();
  for (let i = 0; i < count; i++) {
    const closeBtn = toasts.nth(i).locator('.toast-close');
    if (await closeBtn.isVisible()) {
      await closeBtn.click();
    }
  }
}

/**
 * Wait for loading state to complete
 */
export async function waitForLoadingComplete(page: Page): Promise<void> {
  // Wait for any loading spinners to disappear
  const spinner = page.locator('.loading, .spinner, [class*="loading"]');
  if (await spinner.isVisible().catch(() => false)) {
    await spinner.waitFor({ state: 'hidden', timeout: 30000 });
  }
  await page.waitForLoadState('networkidle');
}

/**
 * Check if an element is in viewport
 */
export async function isInViewport(page: Page, selector: string): Promise<boolean> {
  return page.locator(selector).isVisible();
}

/**
 * Scroll element into view
 */
export async function scrollIntoView(page: Page, selector: string): Promise<void> {
  await page.locator(selector).scrollIntoViewIfNeeded();
}

/**
 * Fill a contenteditable element
 */
export async function fillContentEditable(page: Page, selector: string, text: string): Promise<void> {
  const element = page.locator(selector);
  await element.click();
  await element.fill('');
  await element.pressSequentially(text);
}

/**
 * Clear session storage (logout without UI)
 */
export async function clearSession(page: Page): Promise<void> {
  await page.evaluate(() => {
    sessionStorage.clear();
  });
}

/**
 * Set session storage to logged in state
 */
export async function setLoggedIn(page: Page): Promise<void> {
  await page.evaluate(() => {
    sessionStorage.setItem('adminAuth', 'true');
  });
}

// CSS Selectors for common elements
export const SELECTORS = {
  // Admin Dashboard
  dashboard: {
    table: 'table.letters-table',
    tableRow: 'table tbody tr',
    shell: DASHBOARD_SHELL_SELECTOR,
    ready: DASHBOARD_READY_SELECTOR,
    uploadBtn: 'a.nav-item:has-text("Upload")',
    editBtn: '.toolbar-buttons button:has-text("Edit")',
    processBtn: 'button:has-text("Process")',
    logoutBtn: '.settings-logout-section button:has-text("Logout")',
    searchInput: '.search-group input',
    collectionInput: '.collection-input',
    paginationPrev: '.pagination-btn:has-text("Previous")',
    paginationNext: '.pagination-btn:has-text("Next")',
    paginationInfo: '.pagination-info',
    filterPills: '.filter-pills',
    visibilityPublished: '.filter-published',
    visibilityHidden: '.filter-hidden',
    columnToggle: 'button:has-text("Columns")',
    clearAllBtn: '.clear-all-btn',
    editToolbar: '.edit-toolbar',
    copyModeBtn: '.toolbar-copy-btn',
    saveChangesBtn: '.toolbar-btn-save',
    cancelBtn: '.toolbar-btn-cancel',
  },

  // Letter Review Page
  letterReview: {
    transcriptSection: '.editor-section, .transcript-section',
    transcriptEditor: '.editor-section .transcript-editor, .transcript-section .transcript-editor, .editor-section [contenteditable], .transcript-section [contenteditable]',
    metadataSection: '.metadata-section',
    extraContentSection: '.extra-content-section',
    aiNotesSection: '.ai-notes-section',
    aiNotesEditor: '.ai-notes-editor',
    verifyBtn: '.verify-btn',
    verifiedInfo: '.verified-info',
    transcribeBtn: '.transcribe-btn',
    senderInput: 'input[name="sender"]',
    recipientInput: 'input[name="recipient"]',
    imageViewer: '.letter-image-viewer',
  },

  // Public Pages
  public: {
    searchBar: '.search',
    searchInput: '.search-input',
    archiveList: '.archive-section',
    letterCard: '.letter-card',
    collectionsGrid: '.public-collections-grid',
    collectionCard: '.public-collection-card',
    footer: 'footer',
    header: 'header',
  },

  // Modals and Dialogs
  modal: {
    confirmDialog: '.confirm-dialog',
    confirmBtn: '.confirm-dialog .confirm-btn',
    cancelBtn: '.confirm-dialog .cancel-btn',
    closeBtn: '.modal-close',
  },

  // Processing
  processing: {
    progressBar: '.progress-bar',
    progressText: '.progress-text',
    pauseBtn: '.pause-button',
    resumeBtn: '.resume-button',
    abortBtn: '.abort-button',
  },

  // Entity Pages
  entities: {
    peopleList: '.people-list',
    placesTable: '.places-table',
    searchInput: '.entity-search input',
    createBtn: 'button:has-text("Create")',
    mergeBtn: 'button:has-text("Merge")',
  },

  // Upload Page
  upload: {
    dropzone: '.upload-dropzone',
    fileList: '.file-list',
    uploadBtn: 'button:has-text("Upload")',
    collectionSelect: '.collection-select',
  },
} as const;

// Status values for content workflow
export type ContentStatus = 'EMPTY' | 'AI_DRAFT' | 'EDITED' | 'VERIFIED';

// Visibility values
export type Visibility = 'PUBLISHED' | 'HIDDEN';
