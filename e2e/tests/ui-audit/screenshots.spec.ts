import { test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import {
  VIEWPORTS,
  THEMES,
  PUBLIC_PAGES,
  ADMIN_PAGES,
  setDarkMode,
  getScreenshotFilename,
  navigateToPage,
  captureConsoleErrors,
  checkCommonIssues,
  SCREENSHOT_DIR,
  ViewportName,
  ThemeName,
  PageConfig,
  UIIssue,
} from './helpers';

// Ensure screenshot directory exists
const outputDir = path.resolve(process.cwd(), SCREENSHOT_DIR);

test.beforeAll(async () => {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
});

// Collect all issues for summary
const allIssues: { page: string; viewport: ViewportName; theme: ThemeName; issues: UIIssue[] }[] = [];

/**
 * Capture screenshots for a page at all viewports and themes
 */
async function auditPage(
  page: any,
  config: PageConfig,
  viewport: ViewportName,
  theme: ThemeName
) {
  // Set viewport
  await page.setViewportSize(VIEWPORTS[viewport]);

  // Navigate to page
  const success = await navigateToPage(page, config);
  if (!success) {
    console.log(`Skipping ${config.name} - could not navigate`);
    return;
  }

  // Set theme
  await setDarkMode(page, theme === 'dark');

  // Capture console errors
  const errors = captureConsoleErrors(page);

  // Wait a moment for any animations
  await page.waitForTimeout(500);

  // Take screenshot
  const filename = getScreenshotFilename(config.name, viewport, theme);
  await page.screenshot({
    path: path.join(outputDir, filename),
    fullPage: true,
  });

  // Check for common issues
  const issues = await checkCommonIssues(page);

  // Add console errors as issues
  errors.forEach((err) => {
    issues.push({
      type: 'console',
      severity: 'medium',
      message: err,
    });
  });

  if (issues.length > 0) {
    allIssues.push({ page: config.name, viewport, theme, issues });
  }

  return issues;
}

// Public pages tests
test.describe('Public Pages Screenshot Audit', () => {
  for (const pageConfig of PUBLIC_PAGES) {
    if (pageConfig.skip) continue;

    test.describe(pageConfig.name, () => {
      for (const viewport of Object.keys(VIEWPORTS) as ViewportName[]) {
        for (const theme of THEMES) {
          test(`${viewport} - ${theme} mode`, async ({ page }) => {
            await auditPage(page, pageConfig, viewport, theme);
          });
        }
      }
    });
  }
});

// Admin pages tests
test.describe('Admin Pages Screenshot Audit', () => {
  for (const pageConfig of ADMIN_PAGES) {
    if (pageConfig.skip) continue;

    test.describe(pageConfig.name, () => {
      for (const viewport of Object.keys(VIEWPORTS) as ViewportName[]) {
        for (const theme of THEMES) {
          test(`${viewport} - ${theme} mode`, async ({ page }) => {
            await auditPage(page, pageConfig, viewport, theme);
          });
        }
      }
    });
  }
});

// Summary test that runs last
test.describe('Audit Summary', () => {
  test.afterAll(async () => {
    // Write summary report
    const summaryPath = path.join(outputDir, 'audit-summary.json');
    fs.writeFileSync(summaryPath, JSON.stringify(allIssues, null, 2));

    // Write markdown report
    let mdReport = '# UI Audit Screenshot Report\n\n';
    mdReport += `Generated: ${new Date().toISOString()}\n\n`;

    if (allIssues.length === 0) {
      mdReport += '## No issues found!\n\n';
    } else {
      mdReport += '## Issues Found\n\n';

      // Group by page
      const byPage = new Map<string, typeof allIssues>();
      allIssues.forEach((item) => {
        if (!byPage.has(item.page)) {
          byPage.set(item.page, []);
        }
        byPage.get(item.page)!.push(item);
      });

      byPage.forEach((items, pageName) => {
        mdReport += `### ${pageName}\n\n`;
        items.forEach((item) => {
          mdReport += `**${item.viewport} - ${item.theme}**\n`;
          item.issues.forEach((issue) => {
            mdReport += `- [${issue.severity.toUpperCase()}] (${issue.type}) ${issue.message}\n`;
          });
          mdReport += '\n';
        });
      });
    }

    // Screenshot list
    mdReport += '## Screenshots Captured\n\n';
    const screenshots = fs.readdirSync(outputDir).filter(f => f.endsWith('.png'));
    screenshots.forEach((s) => {
      mdReport += `- ${s}\n`;
    });

    fs.writeFileSync(path.join(outputDir, 'audit-report.md'), mdReport);

    console.log(`\n=== UI Audit Complete ===`);
    console.log(`Screenshots saved to: ${outputDir}`);
    console.log(`Total issues found: ${allIssues.reduce((sum, item) => sum + item.issues.length, 0)}`);
  });

  test('generate summary', async () => {
    // This test exists to trigger afterAll
    console.log('Generating audit summary...');
  });
});
