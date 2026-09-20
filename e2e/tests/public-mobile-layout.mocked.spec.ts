import { expect, test, type Page } from '@playwright/test';
import { API_BASE_URL } from './utils/test-helpers';

const facets = { formats: [], collections: [], correspondents: [], places: [], years: [], topics: [], tones: [], relationships: [] };
const text = 'My dear friend, the garden is bright this morning. We walked down to the river and thought of home.\n\n'.repeat(60);
const letters = Array.from({ length: 48 }, (_, i) => ({
  id: `layout-${i + 1}`, title: `Letter ${i + 1}`, collectionCode: '001',
  images: [{ id: `image-${i + 1}`, type: 'letter', pageNumber: 1, imageUrl: '/images/layout.svg', width: 600, height: 800 }],
  transcript: { pages: [{ pageNumber: 1, text }], fullText: text, verified: true },
  metadata: { sender: 'Alice', recipient: 'Bob', date: 'May 1, 1943', dateRaw: '19430501', description: 'A letter about home.', verified: true },
  status: 'published', visibility: 'PUBLISHED', transcriptPublished: true, metadataPublished: true,
  transcriptStatus: 'VERIFIED', metadataContentStatus: 'VERIFIED', extraContentStatus: 'EMPTY',
  createdAt: '2026-01-01T00:00:00Z',
}));
const shelves = letters.map(l => ({ id: l.id, title: l.title, collectionCode: '001', imageType: 'letter', imageUrl: '/images/layout.svg', sender: 'Alice', recipient: 'Bob', verified: true }));
const collection = { id: 'collection-1', collectionCode: '001', title: 'Family letters', description: 'Letters from home.', createdAt: '2026-01-01', letters, letterCount: letters.length };

async function mockPublic(page: Page) {
  let searchDelay = 0;
  await page.route(`${API_BASE_URL}/**`, async route => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    if (p.startsWith('/images/')) {
      await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="#d8c7a5"/><path d="M50 100h500M50 180h400M50 260h450M50 340h500" stroke="#686052" stroke-width="6"/></svg>' });
      return;
    }
    let body: unknown;
    if (p === '/letters/search' || p === '/letters/summaries') {
      if (searchDelay) await new Promise(resolve => setTimeout(resolve, searchDelay));
      const n = Number(url.searchParams.get('page') || 1);
      const limit = Number(url.searchParams.get('limit') || 24);
      body = { letters: shelves.slice((n - 1) * limit, n * limit), total: shelves.length, page: n, limit, facets };
    } else if (p.endsWith('/adjacent')) body = { prev: null, next: null, position: 1, total: 48 };
    else if (p === '/collections') body = [collection, { ...collection, id: 'collection-2', collectionCode: '002', title: 'Other letters' }];
    else if (p === '/collections/001') body = collection;
    else if (p.startsWith('/letters/layout-')) body = letters.find(l => p === `/letters/${l.id}`);
    else if (p === '/blog') body = { posts: [], total: 0 };
    else if (p === '/blog/layout-note') body = {
      id: 'post-1', slug: 'layout-note', title: 'Archive field notes', bodyMarkdown: text,
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', publishedAt: '2026-01-01T00:00:00Z',
    };
    else if (p === '/persons/layout-person') body = {
      person: { id: 'layout-person', canonicalName: 'Alice', aliases: [], biography: text, biographyStatus: 'VERIFIED' },
      relationships: [], stats: { asSender: 0, asRecipient: 0, asMentioned: 0, total: 0 }, letters: [],
    };
    else if (p === '/places/layout-place') body = {
      place: { id: 'layout-place', canonicalName: 'Raleigh', aliases: [], notes: null, themes: ['Family correspondence'] },
      stats: { writtenFrom: 0, destination: 0, mentioned: 0, total: 0 }, letters: [],
    };
    await route.fulfill({ status: body ? 200 : 404, contentType: 'application/json', body: JSON.stringify(body ?? { error: 'Not found' }) });
  });
  return { delaySearch: (ms: number) => { searchDelay = ms; } };
}

async function home(page: Page) {
  await page.goto('/');
  await expect(page.locator('.letter-card').first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

async function scroll(page: Page, y: number) {
  await page.evaluate(y => window.scrollTo(0, y), y);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeCloseTo(y, 0);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

test.describe('@mocked Public mobile layout', () => {
  test('shared public pages keep headings clear and footers reachable', async ({ page }) => {
    await mockPublic(page);
    for (const path of ['/collections', '/blog', '/blog/layout-note', '/about', '/support', '/people/layout-person', '/places/layout-place']) {
      await test.step(path, async () => {
        await page.goto(path);
        const heading = page.locator('#main-content h1').first();
        await expect(heading).toBeVisible();
        await expect(heading).not.toContainText('Not Found');
        await page.evaluate(() => document.fonts.ready);
        const boxes = await page.evaluate(() => ({
          headerBottom: document.querySelector('.header')!.getBoundingClientRect().bottom,
          headingTop: document.querySelector('#main-content h1')!.getBoundingClientRect().top,
          overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        }));
        expect(boxes.headingTop).toBeGreaterThanOrEqual(boxes.headerBottom);
        expect(boxes.overflow).toBe(false);
        await page.locator('.footer-bottom').scrollIntoViewIfNeeded();
        await expect(page.locator('.footer-bottom')).toBeInViewport();
      });
    }
  });

  test('document owns scrolling, loads more cards, and keeps content at the viewport bottom', async ({ page, isMobile }) => {
    await mockPublic(page);
    await home(page);
    expect(await page.locator('.letter-card').count()).toBeGreaterThanOrEqual(24);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(page.locator('.letter-card')).toHaveCount(48);
    await scroll(page, 2000);
    const geometry = await page.evaluate(() => ({
      owner: document.scrollingElement?.tagName,
      bottomElement: document.elementsFromPoint(innerWidth / 2, innerHeight - 2).some(el => el.closest('#main-content')),
      bodyOverflow: getComputedStyle(document.body).overflowY,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    }));
    expect(geometry.owner).toBe('HTML');
    expect(geometry.bodyOverflow).not.toBe('hidden');
    expect(geometry.bottomElement).toBe(true);
    expect(geometry.overflow).toBe(false);
    await scroll(page, 2200);
    if (isMobile) await expect(page.locator('.header')).toHaveClass(/header--hidden/);
    await scroll(page, 1800);
    await expect(page.locator('.header')).not.toHaveClass(/header--hidden/);
    // Height-only changes exercise layout, not native toolbar emulation.
    await page.setViewportSize({ width: isMobile ? 390 : 1280, height: 650 });
    await expect.poll(() => page.evaluate(() => Math.abs(window.scrollY - 1800))).toBeLessThan(2);
    await expect(page.locator('.header-inner')).toBeInViewport();
  });

  test('restores a deep archive position after delayed content returns', async ({ page }) => {
    const api = await mockPublic(page);
    await home(page);
    const card = page.locator('.letter-card').nth(12);
    await card.scrollIntoViewIfNeeded();
    const saved = await page.evaluate(() => scrollY);
    await card.click();
    await expect(page).toHaveURL(/\/letter\/layout-13/);
    await expect(page.locator('.letter-article')).toBeVisible();
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
    api.delaySearch(350);
    await page.goBack();
    await expect(page.locator('.letter-card').first()).toBeVisible();
    await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(saved, 0);
  });

  test('viewer locks the document and returns to the same reading position', async ({ page }) => {
    await mockPublic(page);
    await page.goto('/letter/layout-1');
    const image = page.locator('.scan-slide').first();
    await expect(image).toBeVisible();
    await image.scrollIntoViewIfNeeded();
    const saved = await page.evaluate(() => scrollY);
    await image.focus(); await image.press('+');
    await expect(page.getByRole('dialog', { name: 'Original scans' })).toBeVisible();
    expect(await page.evaluate(() => document.body.style.position)).toBe('fixed');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Original scans' })).toHaveCount(0);
    expect(await page.evaluate(() => document.body.style.position)).toBe('');
    await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(saved, 0);
  });

  test('history navigation out of the viewer does not restore the old letter position', async ({ page }) => {
    await mockPublic(page);
    await home(page);
    // Seed an archive history entry at zero without Playwright scrolling its
    // offscreen link into view before dispatching the route transition.
    await page.locator('.letter-card').first().evaluate(el => (el as HTMLElement).click());
    // The article shell appears before its async letter data. Wait until the
    // scan exists before establishing the reading position for this test.
    await expect(page.locator('.scan-slide').first()).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await scroll(page, 300);
    await page.locator('.scan-slide').first().focus();
    await page.keyboard.press('+');
    await expect(page.getByRole('dialog', { name: 'Original scans' })).toBeVisible();
    expect(await page.evaluate(() => parseFloat(document.body.style.top))).toBeLessThan(0);
    // First Back closes the viewer's own history entry; the next leaves the letter.
    await page.goBack();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.goBack();
    await expect(page.locator('.letter-card').first()).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Original scans' })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  });

  test('floating search responds to one activation and typing preserves position', async ({ page, isMobile }) => {
    await mockPublic(page);
    await home(page);
    // Cross the search observer's viewport boundary as a real scroll does.
    // A single jump can skip it entirely when the panel starts below the fold.
    const searchY = await page.locator('.home-search-panel').evaluate(el => window.scrollY + el.getBoundingClientRect().top);
    await scroll(page, Math.max(0, Math.round(searchY - 150)));
    await scroll(page, 2300);
    await scroll(page, 2100);
    const search = page.getByRole('button', { name: 'Jump to search' });
    await expect(search).toHaveClass(/back-to-search--visible/);
    const destination = await page.evaluate(() => Math.max(0,
      scrollY + document.querySelector('.home-search-panel')!.getBoundingClientRect().top
      - (document.querySelector('.header') as HTMLElement).offsetHeight - 12));
    if (isMobile) {
      const beforeGesture = await page.evaluate(() => scrollY);
      await search.dispatchEvent('touchstart', { touches: [{ identifier: 0, clientX: 195, clientY: 760 }] });
      await search.dispatchEvent('touchmove', { touches: [{ identifier: 0, clientX: 195, clientY: 700 }] });
      await search.dispatchEvent('touchend', { touches: [], changedTouches: [{ identifier: 0, clientX: 195, clientY: 700 }] });
      // These synthetic events do not pan natively; they must not launch the
      // programmatic jump either. A subsequent real tap still activates once.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      expect(await page.evaluate(() => scrollY)).toBe(beforeGesture);
      await search.tap();
    } else await search.click();
    await expect.poll(() => page.evaluate(y => Math.abs(scrollY - y), destination)).toBeLessThan(1);
    const input = page.getByRole('searchbox', { name: 'Search the archive' });
    await input.fill('garden');
    const typingY = await page.evaluate(() => scrollY);
    await expect(page).toHaveURL(/q=garden/);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(typingY, 0);
    await expect(page.locator('.header')).not.toHaveClass(/header--hidden/);
  });

  test('search return stops on input and route changes; desktop focus waits for arrival', async ({ page, isMobile }) => {
    await mockPublic(page);
    await home(page);
    await scroll(page, 2400);
    await page.keyboard.press('/');
    await expect.poll(() => page.evaluate(() => scrollY)).toBeLessThan(2350);
    await page.evaluate(() => window.dispatchEvent(new WheelEvent('wheel', { deltaY: 100 })));
    const stopped = await page.evaluate(() => scrollY);
    // Sample beyond the original maximum animation duration: it must stay stopped.
    await page.waitForTimeout(750);
    expect(await page.evaluate(() => scrollY)).toBeCloseTo(stopped, 0);
    const input = page.getByRole('searchbox', { name: 'Search the archive' });
    await expect(input).not.toBeFocused();

    await page.keyboard.press('/');
    if (!isMobile) {
      const focusY = await input.evaluate(el => new Promise<number>(resolve => {
        if (document.activeElement === el) resolve(scrollY);
        else el.addEventListener('focus', () => resolve(scrollY), { once: true });
      }));
      const destination = await page.evaluate(() => Math.max(0,
        scrollY + document.querySelector('.home-search-panel')!.getBoundingClientRect().top
        - (document.querySelector('.header') as HTMLElement).offsetHeight - 12));
      expect(focusY).toBeCloseTo(destination, 0);
      await input.blur();
    } else {
      await page.waitForTimeout(750);
      await expect(input).not.toBeFocused();
    }
    await scroll(page, 2400);
    await page.keyboard.press('/');
    await expect.poll(() => page.evaluate(() => scrollY)).toBeLessThan(2350);
    // Programmatic SPA navigation deliberately avoids pointer cancellation.
    await page.locator('.page-selector[href="/about"]').evaluate((el: HTMLAnchorElement) => el.click());
    await expect(page).toHaveURL(/\/about$/);
    await page.waitForTimeout(750);
    expect(await page.evaluate(() => scrollY)).toBe(0);
  });

  test('horizontal gestures neither navigate pages nor offset the document', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Exercise touch gestures in the phone projects.');
    await mockPublic(page);
    await home(page);
    const content = page.locator('#main-content');
    await content.dispatchEvent('touchstart', { touches: [{ identifier: 0, clientX: 80, clientY: 300 }] });
    await content.dispatchEvent('touchmove', { touches: [{ identifier: 0, clientX: 240, clientY: 300 }] });
    expect(await content.evaluate(el => [el, el.parentElement!].every(node => getComputedStyle(node).transform === 'none'))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => document.documentElement.clientWidth));
    await page.evaluate(() => window.scrollTo(100, 0));
    expect(await page.evaluate(() => window.scrollX)).toBe(0);
    await content.dispatchEvent('touchend', { touches: [] });
    // The removed page gesture used to navigate after a 280ms exit animation.
    await page.waitForTimeout(400);
    await expect(page).toHaveURL(/\/$/);
    expect(await page.evaluate(() => window.scrollX)).toBe(0);
  });

  test('safe-area inset moves header and content together, including dock rotation', async ({ page, browserName, isMobile }) => {
    test.skip(browserName !== 'chromium' || !isMobile, 'CDP inset injection is Chromium-only; not an iOS simulation.');
    await mockPublic(page);
    await home(page);
    const measure = () => page.evaluate(() => ({
      cardTop: document.querySelector('.header-inner')!.getBoundingClientRect().top,
      contentPadding: parseFloat(getComputedStyle(document.querySelector('.body-layout')!).paddingTop),
      headerHeight: document.querySelector('.header')!.getBoundingClientRect().height,
    }));
    const base = await measure();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 47, bottom: 34, left: 0, right: 0 } });
    await expect.poll(async () => (await measure()).cardTop - base.cardTop).toBeCloseTo(47, 0);
    expect((await measure()).contentPadding - base.contentPadding).toBeCloseTo(47, 0);
    await page.goto('/collections/001');
    await expect(page.locator('.header')).toHaveClass(/header--has-dock/);
    await expect.poll(async () => (await measure()).contentPadding - (await measure()).headerHeight).toBeGreaterThan(15);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, bottom: 21, left: 47, right: 47 } });
    await page.setViewportSize({ width: 844, height: 390 });
    await expect.poll(async () => (await measure()).cardTop).toBeCloseTo(12.8, 0);
    await expect.poll(async () => (await measure()).contentPadding - (await measure()).headerHeight).toBeLessThan(31);
    expect(await page.locator('.header-inner').evaluate(el => el.getBoundingClientRect().left)).toBeGreaterThan(47);
  });
});
