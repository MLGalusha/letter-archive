import { Page } from '@playwright/test';
import { loginAsAdmin } from '../utils/test-helpers';

/**
 * Viewport configurations for responsive testing
 */
export const VIEWPORTS = {
  desktop: { width: 1920, height: 1080 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 375, height: 667 },
} as const;

export type ViewportName = keyof typeof VIEWPORTS;

/**
 * Theme modes to test
 */
export const THEMES = ['light', 'dark'] as const;
export type ThemeName = (typeof THEMES)[number];

/**
 * Page configuration for audit
 */
export interface PageConfig {
  name: string;
  path: string;
  requiresAuth: boolean;
  /** Function to get a valid path (for dynamic routes) */
  getPath?: (page: Page) => Promise<string | null>;
  /** Function to wait for page to be ready */
  waitForReady?: (page: Page) => Promise<void>;
  /** Interactions to capture different states */
  interactions?: {
    name: string;
    action: (page: Page) => Promise<void>;
  }[];
  /** Skip this page (e.g., Letter Review Page) */
  skip?: boolean;
}

const API_BASE_URL = process.env.VITE_API_URL || 'http://localhost:3002';

async function fetchJson<T>(page: Page, url: string): Promise<T | null> {
  try {
    const response = await page.request.get(`${API_BASE_URL}${url}`);
    if (!response.ok()) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/**
 * All pages to audit
 */
export const PUBLIC_PAGES: PageConfig[] = [
  {
    name: 'HomePage',
    path: '/',
    requiresAuth: false,
    waitForReady: async (page) => {
      await page.waitForLoadState('networkidle');
    },
  },
  {
    name: 'CollectionsPage',
    path: '/collections',
    requiresAuth: false,
    waitForReady: async (page) => {
      await page.waitForLoadState('networkidle');
    },
  },
  {
    name: 'CollectionDetailPage',
    path: '/collections/:code',
    requiresAuth: false,
    getPath: async (page) => {
      const collections = await fetchJson<Array<{ collectionCode: string; letterCount?: number }>>(page, '/collections');
      const collection = collections?.find((c) => (c.letterCount ?? 0) > 0) ?? collections?.[0];
      if (collection?.collectionCode) {
        return `/collections/${collection.collectionCode}`;
      }
      return null;
    },
    waitForReady: async (page) => {
      await page.waitForLoadState('networkidle');
    },
  },
  {
    name: 'LetterDetailPage',
    path: '/letter/:id',
    requiresAuth: false,
    getPath: async (page) => {
      const letters = await fetchJson<{ letters: Array<{ id: string }> }>(page, '/letters?limit=1');
      const letterId = letters?.letters?.[0]?.id;
      if (letterId) return `/letter/${letterId}`;
      return null;
    },
    waitForReady: async (page) => {
      await page.waitForLoadState('networkidle');
      // Wait for image viewer to load
      await page.locator('.letter-viewer, .letter-image-viewer, .images-panel').first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    },
  },
  {
    name: 'PersonPage',
    path: '/people/:id',
    requiresAuth: false,
    getPath: async (page) => {
      const graph = await fetchJson<{ nodes: Array<{ id: string }> }>(page, '/relationships');
      const graphPersonId = graph?.nodes?.[0]?.id;
      if (graphPersonId) return `/people/${graphPersonId}`;

      const people = await fetchJson<{ persons: Array<{ id: string }> }>(page, '/admin/entities/persons');
      const personId = people?.persons?.[0]?.id;
      if (personId) return `/people/${personId}`;
      return null;
    },
    waitForReady: async (page) => {
      await page.waitForLoadState('networkidle');
    },
  },
  {
    name: 'PlacePage',
    path: '/places/:id',
    requiresAuth: false,
    getPath: async (page) => {
      const places = await fetchJson<{ places: Array<{ id: string }> }>(page, '/admin/entities/places');
      const placeId = places?.places?.[0]?.id;
      if (placeId) return `/places/${placeId}`;
      return null;
    },
    waitForReady: async (page) => {
      await page.waitForLoadState('networkidle');
    },
  },
  {
    name: 'ExplorePage',
    path: '/explore',
    requiresAuth: false,
    waitForReady: async (page) => {
      await page.waitForLoadState('networkidle');
      // Wait for graph to render
      await page.waitForTimeout(1000);
    },
  },
  {
    name: 'AboutPage',
    path: '/about',
    requiresAuth: false,
    waitForReady: async (page) => {
      await page.waitForLoadState('networkidle');
    },
  },
  {
    name: 'ContactPage',
    path: '/contact',
    requiresAuth: false,
    waitForReady: async (page) => {
      await page.waitForLoadState('networkidle');
    },
  },
];

export const ADMIN_PAGES: PageConfig[] = [
  {
    name: 'AdminLoginPage',
    path: '/admin-login',
    requiresAuth: false,
    waitForReady: async (page) => {
      await page.waitForLoadState('networkidle');
    },
  },
  {
    name: 'AdminDashboard',
    path: '/admin',
    requiresAuth: true,
    waitForReady: async (page) => {
      await page.waitForLoadState('networkidle');
      // Wait for table to load
      await page.locator('table tbody tr').first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    },
  },
  {
    name: 'UploadLetterPage',
    path: '/admin/upload',
    requiresAuth: true,
    waitForReady: async (page) => {
      await page.waitForLoadState('networkidle');
    },
  },
  {
    name: 'ProcessingQueuePage',
    path: '/admin/processing',
    requiresAuth: true,
    waitForReady: async (page) => {
      await page.waitForLoadState('networkidle');
    },
  },
  {
    name: 'LetterReviewPage',
    path: '/admin/letters/:id',
    requiresAuth: true,
    skip: true, // User requested to skip this page
    getPath: async (page) => {
      await page.goto('/admin');
      await page.waitForLoadState('networkidle');
      const firstRow = page.locator('table tbody tr').first();
      if (await firstRow.isVisible().catch(() => false)) {
        await firstRow.click();
        await page.waitForURL(/\/admin\/letters\//);
        return page.url().replace(/^.*?(\/admin\/letters\/.*)$/, '$1');
      }
      return null;
    },
  },
  {
    name: 'PeoplePage',
    path: '/admin/entities/people',
    requiresAuth: true,
    waitForReady: async (page) => {
      await page.waitForLoadState('networkidle');
    },
  },
  {
    name: 'PlacesPage',
    path: '/admin/entities/places',
    requiresAuth: true,
    waitForReady: async (page) => {
      await page.waitForLoadState('networkidle');
    },
  },
  {
    name: 'RelationshipsPage',
    path: '/admin/entities/relationships',
    requiresAuth: true,
    waitForReady: async (page) => {
      await page.waitForLoadState('networkidle');
    },
  },
  {
    name: 'EntityReviewPage',
    path: '/admin/entities/review',
    requiresAuth: true,
    waitForReady: async (page) => {
      await page.waitForLoadState('networkidle');
    },
  },
];

export const ALL_PAGES = [...PUBLIC_PAGES, ...ADMIN_PAGES];

/**
 * Toggle dark mode
 */
export async function setDarkMode(page: Page, enabled: boolean): Promise<void> {
  await page.evaluate((dark) => {
    if (dark) {
      document.body.classList.add('dark');
      localStorage.setItem('darkMode', 'true');
    } else {
      document.body.classList.remove('dark');
      localStorage.setItem('darkMode', 'false');
    }
  }, enabled);
  // Small delay for styles to apply
  await page.waitForTimeout(100);
}

/**
 * Get screenshot filename
 */
export function getScreenshotFilename(
  pageName: string,
  viewport: ViewportName,
  theme: ThemeName,
  suffix?: string
): string {
  const parts = [pageName, viewport, theme];
  if (suffix) parts.push(suffix);
  return `${parts.join('-')}.png`;
}

/**
 * Navigate to a page, handling dynamic routes
 */
export async function navigateToPage(page: Page, config: PageConfig): Promise<boolean> {
  if (config.skip) {
    return false;
  }

  // Handle auth
  if (config.requiresAuth) {
    await loginAsAdmin(page);
  }

  // Get path (handle dynamic routes)
  let path = config.path;
  if (config.getPath) {
    const dynamicPath = await config.getPath(page);
    if (!dynamicPath) {
      console.log(`Could not resolve dynamic path for ${config.name}`);
      return false;
    }
    path = dynamicPath;
  }

  // Navigate
  if (!page.url().endsWith(path)) {
    await page.goto(path);
  }

  // Wait for ready
  if (config.waitForReady) {
    await config.waitForReady(page);
  }

  return true;
}

/**
 * Capture console errors during page interaction
 */
export function captureConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });
  return errors;
}

/**
 * Capture network failures
 */
export function captureNetworkFailures(page: Page): string[] {
  const failures: string[] = [];
  page.on('requestfailed', (request) => {
    failures.push(`${request.method()} ${request.url()} - ${request.failure()?.errorText}`);
  });
  return failures;
}

/**
 * Check for common UI issues
 */
export interface UIIssue {
  type: 'visual' | 'accessibility' | 'console' | 'network';
  severity: 'critical' | 'high' | 'medium' | 'low';
  message: string;
  element?: string;
}

export async function checkCommonIssues(page: Page): Promise<UIIssue[]> {
  const issues: UIIssue[] = [];

  // Check for horizontal overflow (broken layouts)
  const hasHorizontalScroll = await page.evaluate(() => {
    return document.documentElement.scrollWidth > document.documentElement.clientWidth;
  });
  if (hasHorizontalScroll) {
    issues.push({
      type: 'visual',
      severity: 'medium',
      message: 'Page has unexpected horizontal scroll',
    });
  }

  // Check for very small touch targets (< 44px)
  const smallTargets = await page.evaluate(() => {
    const clickables = document.querySelectorAll('button, a, [role="button"], input, select');
    const small: string[] = [];
    clickables.forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        if (rect.width < 44 || rect.height < 44) {
          const id = el.id || el.className || el.tagName;
          small.push(`${el.tagName}${id ? `#${id}` : ''} (${Math.round(rect.width)}x${Math.round(rect.height)})`);
        }
      }
    });
    return small.slice(0, 10); // Limit to 10
  });
  if (smallTargets.length > 0) {
    issues.push({
      type: 'accessibility',
      severity: 'medium',
      message: `Small touch targets found: ${smallTargets.join(', ')}`,
    });
  }

  // Check for images without alt text
  const imagesWithoutAlt = await page.evaluate(() => {
    const images = document.querySelectorAll('img');
    let count = 0;
    images.forEach((img) => {
      if (!img.alt && !img.getAttribute('aria-label') && !img.getAttribute('role')) {
        count++;
      }
    });
    return count;
  });
  if (imagesWithoutAlt > 0) {
    issues.push({
      type: 'accessibility',
      severity: 'high',
      message: `${imagesWithoutAlt} image(s) missing alt text`,
    });
  }

  // Check for buttons without accessible names
  const buttonsWithoutLabels = await page.evaluate(() => {
    const buttons = document.querySelectorAll('button, [role="button"]');
    let count = 0;
    buttons.forEach((btn) => {
      const text = btn.textContent?.trim();
      const ariaLabel = btn.getAttribute('aria-label');
      const title = btn.getAttribute('title');
      if (!text && !ariaLabel && !title) {
        count++;
      }
    });
    return count;
  });
  if (buttonsWithoutLabels > 0) {
    issues.push({
      type: 'accessibility',
      severity: 'high',
      message: `${buttonsWithoutLabels} button(s) without accessible name`,
    });
  }

  return issues;
}

/**
 * Output directory for screenshots (absolute path)
 */
export const SCREENSHOT_DIR = 'ui-audit-output';
