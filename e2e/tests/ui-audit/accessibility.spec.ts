import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import * as fs from 'fs';
import * as path from 'path';
import {
  THEMES,
  PUBLIC_PAGES,
  ADMIN_PAGES,
  setDarkMode,
  navigateToPage,
  SCREENSHOT_DIR,
  ThemeName,
  PageConfig,
} from './helpers';

// Output directory for accessibility reports
const outputDir = path.join(process.cwd(), SCREENSHOT_DIR);

test.beforeAll(async () => {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
});

interface A11yViolation {
  id: string;
  impact: string;
  description: string;
  helpUrl: string;
  nodes: number;
  targets: string[];
}

interface PageA11yResult {
  page: string;
  theme: ThemeName;
  violations: A11yViolation[];
  passes: number;
  incomplete: number;
}

const allResults: PageA11yResult[] = [];

/**
 * Run accessibility audit on a page
 */
async function auditPageAccessibility(
  page: any,
  config: PageConfig,
  theme: ThemeName
): Promise<PageA11yResult | null> {
  // Navigate to page
  const success = await navigateToPage(page, config);
  if (!success) {
    console.log(`Skipping ${config.name} - could not navigate`);
    return null;
  }

  // Set theme
  await setDarkMode(page, theme === 'dark');

  // Wait for page to stabilize
  await page.waitForTimeout(500);

  // Run axe with WCAG 2.1 AA standard
  const accessibilityScanResults = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  const violations: A11yViolation[] = accessibilityScanResults.violations.map((v) => ({
    id: v.id,
    impact: v.impact || 'unknown',
    description: v.description,
    helpUrl: v.helpUrl,
    nodes: v.nodes.length,
    targets: v.nodes.slice(0, 5).map((n) => n.target.join(' > ')),
  }));

  return {
    page: config.name,
    theme,
    violations,
    passes: accessibilityScanResults.passes.length,
    incomplete: accessibilityScanResults.incomplete.length,
  };
}

// Public pages accessibility tests
test.describe('Public Pages Accessibility Audit', () => {
  for (const pageConfig of PUBLIC_PAGES) {
    if (pageConfig.skip) continue;

    test.describe(pageConfig.name, () => {
      for (const theme of THEMES) {
        test(`${theme} mode - WCAG 2.1 AA`, async ({ page }) => {
          const result = await auditPageAccessibility(page, pageConfig, theme);
          if (result) {
            allResults.push(result);

            // Log violations for this test
            if (result.violations.length > 0) {
              console.log(`\n${result.page} (${theme}): ${result.violations.length} violations`);
              result.violations.forEach((v) => {
                console.log(`  - [${v.impact}] ${v.id}: ${v.description}`);
              });
            }

            // Don't fail test, just report (we're auditing, not enforcing)
            // But we can soft-assert for critical issues
            const criticalViolations = result.violations.filter(
              (v) => v.impact === 'critical' || v.impact === 'serious'
            );
            if (criticalViolations.length > 0) {
              console.warn(`WARNING: ${criticalViolations.length} critical/serious violations on ${result.page}`);
            }
          }
        });
      }
    });
  }
});

// Admin pages accessibility tests
test.describe('Admin Pages Accessibility Audit', () => {
  for (const pageConfig of ADMIN_PAGES) {
    if (pageConfig.skip) continue;

    test.describe(pageConfig.name, () => {
      for (const theme of THEMES) {
        test(`${theme} mode - WCAG 2.1 AA`, async ({ page }) => {
          const result = await auditPageAccessibility(page, pageConfig, theme);
          if (result) {
            allResults.push(result);

            if (result.violations.length > 0) {
              console.log(`\n${result.page} (${theme}): ${result.violations.length} violations`);
              result.violations.forEach((v) => {
                console.log(`  - [${v.impact}] ${v.id}: ${v.description}`);
              });
            }
          }
        });
      }
    });
  }
});

// Summary report
test.describe('Accessibility Audit Summary', () => {
  test.afterAll(async () => {
    // Write JSON report
    const jsonPath = path.join(outputDir, 'accessibility-audit.json');
    fs.writeFileSync(jsonPath, JSON.stringify(allResults, null, 2));

    // Write markdown report
    let mdReport = '# Accessibility Audit Report (WCAG 2.1 AA)\n\n';
    mdReport += `Generated: ${new Date().toISOString()}\n\n`;

    // Summary stats
    const totalViolations = allResults.reduce((sum, r) => sum + r.violations.length, 0);
    const pagesWithIssues = allResults.filter((r) => r.violations.length > 0).length;

    mdReport += '## Summary\n\n';
    mdReport += `- **Total violations found:** ${totalViolations}\n`;
    mdReport += `- **Pages with issues:** ${pagesWithIssues} / ${allResults.length}\n\n`;

    // Violations by impact
    const byImpact = new Map<string, number>();
    allResults.forEach((r) => {
      r.violations.forEach((v) => {
        byImpact.set(v.impact, (byImpact.get(v.impact) || 0) + 1);
      });
    });

    mdReport += '### Violations by Impact\n\n';
    ['critical', 'serious', 'moderate', 'minor'].forEach((impact) => {
      const count = byImpact.get(impact) || 0;
      if (count > 0) {
        mdReport += `- **${impact}:** ${count}\n`;
      }
    });
    mdReport += '\n';

    // Most common violations
    const violationCounts = new Map<string, { count: number; description: string; helpUrl: string }>();
    allResults.forEach((r) => {
      r.violations.forEach((v) => {
        const existing = violationCounts.get(v.id);
        if (existing) {
          existing.count += v.nodes;
        } else {
          violationCounts.set(v.id, { count: v.nodes, description: v.description, helpUrl: v.helpUrl });
        }
      });
    });

    const sortedViolations = Array.from(violationCounts.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10);

    if (sortedViolations.length > 0) {
      mdReport += '### Most Common Violations\n\n';
      mdReport += '| Rule | Count | Description |\n';
      mdReport += '|------|-------|-------------|\n';
      sortedViolations.forEach(([id, data]) => {
        mdReport += `| [${id}](${data.helpUrl}) | ${data.count} | ${data.description} |\n`;
      });
      mdReport += '\n';
    }

    // Detailed results by page
    mdReport += '## Detailed Results\n\n';

    // Group by page
    const byPage = new Map<string, PageA11yResult[]>();
    allResults.forEach((r) => {
      if (!byPage.has(r.page)) {
        byPage.set(r.page, []);
      }
      byPage.get(r.page)!.push(r);
    });

    byPage.forEach((results, pageName) => {
      const hasViolations = results.some((r) => r.violations.length > 0);
      const icon = hasViolations ? '' : '';
      mdReport += `### ${icon} ${pageName}\n\n`;

      results.forEach((r) => {
        if (r.violations.length === 0) {
          mdReport += `**${r.theme} mode:** No violations\n\n`;
        } else {
          mdReport += `**${r.theme} mode:** ${r.violations.length} violation(s)\n\n`;
          r.violations.forEach((v) => {
            mdReport += `- **[${v.impact.toUpperCase()}] ${v.id}**: ${v.description}\n`;
            mdReport += `  - Affected elements: ${v.nodes}\n`;
            mdReport += `  - [Learn more](${v.helpUrl})\n`;
            if (v.targets.length > 0) {
              mdReport += `  - Examples: \`${v.targets.slice(0, 3).join('`, `')}\`\n`;
            }
          });
          mdReport += '\n';
        }
      });
    });

    fs.writeFileSync(path.join(outputDir, 'accessibility-report.md'), mdReport);

    console.log(`\n=== Accessibility Audit Complete ===`);
    console.log(`Report saved to: ${path.join(outputDir, 'accessibility-report.md')}`);
    console.log(`Total violations: ${totalViolations}`);
  });

  test('generate accessibility summary', async () => {
    // Trigger afterAll
    console.log('Generating accessibility summary...');
  });
});
