import { expect, test, type Page } from '@playwright/test';
import { API_BASE_URL } from './utils/test-helpers';
import { mockReader } from './utils/reader-viewer-fixture';

test.use({ isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 } });

async function verifyNoPageSwipe(page: Page) {
  const url = page.url();
  const content = page.locator('main.public-site-shell');
  for (const delta of [-250, 250]) {
    await content.evaluate((root, dx) => {
      const target = root.querySelector('h1') || root;
      const dispatch = (type: string, x: number) => {
        // WebKit does not expose a constructible Touch class in automation.
        const point = { identifier: 1, target, clientX: x, clientY: 350 };
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperties(event, { touches: { value: type === 'touchend' ? [] : [point] }, changedTouches: { value: [point] } });
        target.dispatchEvent(event);
      };
      const start = dx < 0 ? 320 : 60;
      dispatch('touchstart', start);
      dispatch('touchmove', start + dx / 2);
      dispatch('touchmove', start + dx);
      dispatch('touchend', start + dx);
    }, delta);
    await page.waitForTimeout(400); // Former navigation committed after a 280ms exit animation.
    await expect(page).toHaveURL(url);
    expect(await content.evaluate(root => [root, ...root.querySelectorAll('.body-layout')]
      .every(el => getComputedStyle(el).transform === 'none'))).toBe(true);
  }
}

test('@mocked site sections and individual collections require navigation controls', async ({ page }) => {
  const collections = ['001', '002', '003'].map(collectionCode => ({ id: collectionCode, collectionCode, title: `Collection ${collectionCode}`, letterCount: 1 }));
  await page.route(`${API_BASE_URL}/**`, route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/collections') return route.fulfill({ json: collections });
    if (/^\/collections\/\d+$/.test(path)) return route.fulfill({ json: { ...collections.find(c => path.endsWith(c.collectionCode)), letters: [] } });
    if (path.endsWith('/profile')) return route.fulfill({ json: {} });
    if (path === '/letters/search') return route.fulfill({ json: { letters: [], total: 0, page: 1, limit: 24, facets: { formats: [], collections: [], correspondents: [], places: [], years: [], topics: [], tones: [], relationships: [] } } });
    if (path === '/blog') return route.fulfill({ json: { posts: [], total: 0 } });
    if (path === '/settings/public') return route.fulfill({ json: {} });
    return route.fulfill({ status: 404, json: {} });
  });
  for (const path of ['/', '/collections', '/blog', '/about', '/support', '/collections/002']) {
    await page.goto(path);
    await expect(page.locator('main h1').first()).toBeVisible();
    if (path === '/collections/002') await expect(page.getByRole('slider')).toHaveAttribute('aria-disabled', 'false');
    await verifyNoPageSwipe(page);
  }
  await page.locator('.dock-strip-arrow').last().click();
  await expect(page).toHaveURL(/\/collections\/003$/);
  await page.locator('header').getByRole('link', { name: 'Home', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('@mocked individual letters require navigation controls', async ({ page }) => {
  await mockReader(page);
  await page.route(`${API_BASE_URL}/letters/summaries**`, route => route.fulfill({ json: { total: 3, letters: ['previous', 'current', 'next'].map(id => ({ id })) } }));
  await page.goto('/letter/current');
  await expect(page.getByRole('slider')).toHaveAttribute('aria-disabled', 'false');
  await verifyNoPageSwipe(page);
  await page.locator('.dock-strip-arrow').last().click();
  await expect(page).toHaveURL(/\/letter\/next$/);
});
