import { expect, test } from '@playwright/test';
import { API_BASE_URL } from './utils/test-helpers';

for (const width of [390, 1440]) test(`@mocked reader navigation stays mounted and focused through independent reads at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  let releaseDetail!: () => void; let releaseNavigation!: () => void;
  const detail = new Promise<void>(resolve => { releaseDetail = resolve; });
  const navigation = new Promise<void>(resolve => { releaseNavigation = resolve; });
  const requests: string[] = [];
  await page.route(`${API_BASE_URL}/**`, async route => {
    const path = new URL(route.request().url()).pathname;
    requests.push(path);
    if (path === '/settings/public') return route.fulfill({ json: {} });
    if (path === '/letters/summaries') return route.fulfill({ json: { total: 3, letters: ['a', 'b', 'c'].map(id => ({ id })) } });
    if (path.startsWith('/letters/')) {
      const requestedId = path.split('/')[2];
      const id = requestedId === 'a-cover' ? 'a' : requestedId;
      if (id === 'b') await (path.endsWith('/adjacent') ? navigation : detail);
      if (id === 'c' && path.endsWith('/adjacent')) return route.fulfill({ json: { position: 1, total: 1, collectionCode: '002', prev: null, next: null } });
      if (path.endsWith('/adjacent')) return route.fulfill({ json: { position: id === 'a' ? 1 : 2, total: 3, collectionCode: '001', prev: { id: 'a' }, next: { id: 'b' } } });
      return route.fulfill({ json: { id, collectionCode: id === 'c' ? '002' : '001', metadata: { date: `Letter ${id}`, verified: true }, images: [],
        transcript: { pages: [], fullText: 'Published text. '.repeat(150), verified: true }, status: 'published', visibility: 'PUBLISHED',
        transcriptPublished: true, metadataPublished: true, transcriptStatus: 'VERIFIED', metadataContentStatus: 'VERIFIED', extraContentStatus: 'EMPTY' } });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  try {
    // A companion URL resolves to representative a, which is the catalogue ID.
    await page.goto('/letter/a-cover');
    const slider = page.getByRole('slider');
    await expect(slider).toHaveAttribute('aria-disabled', 'false');
    await page.evaluate(() => document.fonts.ready);
    const original = await slider.elementHandle();
    const before = await page.locator('.letter-hero-section').boundingBox();
    const next = page.locator('.dock-strip-arrow').last();
    await next.focus();
    await next.click();
    await expect(page).toHaveURL(/\/letter\/b$/);
    await expect(next).toHaveAttribute('aria-disabled', 'true');
    await expect(next).toBeFocused();
    const article = page.locator('article');
    await expect(article).toHaveAttribute('aria-busy', 'true');
    await expect(article).toHaveAttribute('inert');
    await expect(article).toHaveCSS('opacity', '1');
    await expect(next).toHaveCSS('opacity', '1');
    await expect(slider).toHaveCSS('opacity', '1');
    const loadingStatus = page.getByRole('status').filter({ hasText: 'Loading letter...' });
    await expect(loadingStatus).toHaveCount(1);
    // Announce loading outside the inert content without painting a header bar.
    expect(await loadingStatus.evaluate(el => el.closest('[inert]'))).toBeNull();
    await expect(loadingStatus).toHaveCSS('clip', 'rect(0px, 0px, 0px, 0px)');
    await expect(loadingStatus).toHaveCSS('width', '1px');
    await expect(loadingStatus).toHaveCSS('height', '1px');
    await expect(page.locator('header.header').getByRole('link', { name: 'Collection', exact: true })).toHaveAttribute('href', '/collections/001');
    expect(await original!.evaluate(el => el.isConnected)).toBe(true);
    const pending = await page.locator('.letter-hero-section').boundingBox();
    expect(pending!.y).toBeCloseTo(before!.y, 0);
    await next.press('Enter');
    expect(requests.filter(path => path === '/letters/b')).toHaveLength(1);
    releaseDetail();
    await expect(page.getByRole('heading', { name: 'Letter b', exact: true })).toBeVisible();
    await expect(page.locator('article')).not.toHaveAttribute('inert');
    expect(await original!.evaluate(el => el.isConnected)).toBe(true);
    await expect(next).toHaveAttribute('aria-disabled', 'true');
    await expect(article).toHaveCSS('opacity', '1');
    await expect(next).toHaveCSS('opacity', '1');
    await expect(slider).toHaveCSS('opacity', '1');
    await expect(loadingStatus).toHaveCount(0);
    releaseNavigation();
    await expect(slider).toHaveAttribute('aria-valuenow', '2');
    await expect(next).toHaveAttribute('aria-disabled', 'false');
    await expect(next).toBeFocused();
    await slider.focus();
    await slider.press('Home');
    await expect(page).toHaveURL(/\/letter\/a$/);
    await expect(slider).toHaveAttribute('aria-valuenow', '1');
    await expect(slider).toBeFocused();
    expect(await original!.evaluate(el => el.isConnected)).toBe(true);
    await slider.press('End');
    await expect(page).toHaveURL(/\/letter\/c$/);
    await expect(page.getByRole('heading', { name: 'Letter c', exact: true })).toBeVisible();
    await expect(page.locator('header.header').getByRole('link', { name: 'Collection', exact: true })).toHaveAttribute('href', '/collections/002');
    await expect(slider).toHaveCount(0);
    await page.goBack();
    await expect(slider).toHaveAttribute('aria-valuenow', '1');
    await expect(page.locator('header.header').getByRole('link', { name: 'Collection', exact: true })).toHaveAttribute('href', '/collections/001');
    await page.evaluate(() => window.scrollTo(0, 500));
    if (width < 901) await expect(page.locator('.header-dock-region')).toHaveAttribute('inert');
    else await expect(page.locator('.header-dock-region')).not.toHaveAttribute('inert');
  } finally { releaseDetail(); releaseNavigation(); }
});

test('@mocked collection navigation retains its dock across overview and list loading', async ({ page }) => {
  let releaseOverview!: () => void; let releaseList!: () => void; let holdList = false;
  const overview = new Promise<void>(resolve => { releaseOverview = resolve; });
  const list = new Promise<void>(resolve => { releaseList = resolve; });
  const collections = ['001', '002'].map(collectionCode => ({ id: collectionCode, collectionCode, title: `Collection ${collectionCode}`, letterCount: 1, letters: [] }));
  await page.route(`${API_BASE_URL}/**`, async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/settings/public') return route.fulfill({ json: {} });
    if (path === '/collections') {
      if (holdList) await list;
      return route.fulfill({ json: collections });
    }
    if (path.endsWith('/profile')) return route.fulfill({ json: null });
    if (path === '/collections/002') { await overview; return route.fulfill({ json: collections[1] }); }
    if (path === '/collections/001') return route.fulfill({ json: collections[0] });
    if (path === '/letters/search') return route.fulfill({ json: { letters: [], total: 0, page: 1, limit: 24, facets: { formats: [], collections: [], correspondents: [], places: [], years: [], topics: [], tones: [], relationships: [] } } });
    return route.fulfill({ status: 404, json: {} });
  });
  try {
    await page.goto('/collections/001');
    const slider = page.getByRole('slider');
    await expect(slider).toHaveAttribute('aria-disabled', 'false');
    const original = await slider.elementHandle();
    await slider.focus();
    holdList = true;
    await slider.press('End');
    await expect(page).toHaveURL(/\/collections\/002$/);
    await expect(slider).toHaveAttribute('aria-disabled', 'true');
    expect(await original!.evaluate(el => el.isConnected)).toBe(true);
    await expect(slider).toBeFocused();
    releaseOverview();
    await expect(page.getByRole('heading', { name: 'Collection 002', exact: true })).toBeVisible();
    await expect(slider).toHaveAttribute('aria-disabled', 'true');
    releaseList();
    await expect(slider).toHaveAttribute('aria-valuenow', '2');
    await expect(slider).toHaveAttribute('aria-disabled', 'false');
    expect(await original!.evaluate(el => el.isConnected)).toBe(true);
    await expect(slider).toBeFocused();
  } finally { releaseOverview(); releaseList(); }
});
