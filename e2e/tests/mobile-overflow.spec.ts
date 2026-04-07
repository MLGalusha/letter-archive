import { test, expect } from '@playwright/test';
import { PUBLIC_PAGES, VIEWPORTS, navigateToPage } from './ui-audit/helpers';

const MOBILE = VIEWPORTS.mobile;

const PAGES_TO_TEST = [
  'HomePage',
  'CollectionsPage',
  'CollectionDetailPage',
  'LetterDetailPage',
  'AboutPage',
  'ContactPage', // support page
];

/**
 * Find elements that overflow the viewport horizontally.
 * Returns an array of descriptors for any elements whose bounding rect
 * extends past the viewport width.
 */
async function findOverflowingElements(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const offenders: string[] = [];
    const all = document.querySelectorAll('*');
    for (const el of all) {
      const rect = el.getBoundingClientRect();
      // Element sticks out to the right or left of the viewport
      if (rect.right > vw + 1 || rect.left < -1) {
        const tag = el.tagName.toLowerCase();
        const cls = el.className && typeof el.className === 'string'
          ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
          : '';
        const id = el.id ? `#${el.id}` : '';
        const info = `${tag}${id}${cls} (left:${Math.round(rect.left)}, right:${Math.round(rect.right)}, vw:${vw})`;
        offenders.push(info);
      }
    }
    // Deduplicate and limit
    return [...new Set(offenders)].slice(0, 20);
  });
}

for (const pageName of PAGES_TO_TEST) {
  const config = PUBLIC_PAGES.find((p) => p.name === pageName);
  if (!config) continue;

  test(`${pageName} — no horizontal overflow on mobile`, async ({ page }) => {
    await page.setViewportSize(MOBILE);

    const navigated = await navigateToPage(page, config);
    if (!navigated) {
      test.skip();
      return;
    }

    // Check every scroll container in the chain for horizontal overflow
    const overflowInfo = await page.evaluate(() => {
      const html = document.documentElement;
      const body = document.body;
      const root = document.getElementById('root');
      const shell = document.querySelector('.public-site-shell') || document.querySelector('.public-letter-shell');

      function check(el: Element | null, label: string) {
        if (!el) return null;
        const sw = el.scrollWidth;
        const cw = el.clientWidth;
        return { label, scrollWidth: sw, clientWidth: cw, overflows: sw > cw };
      }

      return [
        check(html, 'html'),
        check(body, 'body'),
        check(root, '#root'),
        check(shell, shell?.className.split(' ')[0] || 'shell'),
      ].filter(Boolean);
    });

    const overflowing = overflowInfo.filter((i) => i!.overflows);

    if (overflowing.length > 0) {
      const offenders = await findOverflowingElements(page);

      expect(overflowing.length, [
        `Horizontal overflow detected:`,
        ...overflowing.map((i) => `  ${i!.label}: scrollWidth=${i!.scrollWidth}, clientWidth=${i!.clientWidth}`),
        `Overflowing elements:`,
        ...offenders.map((o) => `  - ${o}`),
      ].join('\n')).toBe(0);
    }

    // Also verify no touch-drag horizontal scroll is possible
    const scrolledHorizontally = await page.evaluate(async () => {
      // Remove overflow-x hidden temporarily to see true content width
      const html = document.documentElement;
      const body = document.body;
      const origHtml = html.style.overflowX;
      const origBody = body.style.overflowX;
      html.style.overflowX = 'auto';
      body.style.overflowX = 'auto';

      // Force reflow
      void html.offsetWidth;

      const canScroll = html.scrollWidth > html.clientWidth || body.scrollWidth > body.clientWidth;
      const details = {
        htmlSW: html.scrollWidth,
        htmlCW: html.clientWidth,
        bodySW: body.scrollWidth,
        bodyCW: body.clientWidth,
      };

      // Restore
      html.style.overflowX = origHtml;
      body.style.overflowX = origBody;

      return { canScroll, ...details };
    });

    if (scrolledHorizontally.canScroll) {
      const offenders = await findOverflowingElements(page);
      expect(scrolledHorizontally.canScroll, [
        `Content wider than viewport (overflow is only hidden, not fixed):`,
        `  html: ${scrolledHorizontally.htmlSW} vs ${scrolledHorizontally.htmlCW}`,
        `  body: ${scrolledHorizontally.bodySW} vs ${scrolledHorizontally.bodyCW}`,
        `Overflowing elements:`,
        ...offenders.map((o) => `  - ${o}`),
      ].join('\n')).toBe(false);
    }
  });
}
