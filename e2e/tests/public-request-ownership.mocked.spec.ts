import { expect, test } from '@playwright/test';
import { API_BASE_URL } from './utils/test-helpers';

const journal = (title: string) => ({ posts: [{ id: title, slug: title, title, excerpt: title,
  bodyMarkdown: '', authorDisplayName: 'Writer', publishedAt: '2026-09-17', heroImageUrl: null }], total: 24 });
const person = (id: string) => ({ person: { id, canonicalName: `Person ${id}`, aliases: [], biography: null },
  relationships: id === 'a' ? ['b', 'c'].map(target => ({ id: target, relatedPersonId: target,
    relatedPersonName: `Person ${target}`, relationshipType: 'friend' })) : [],
  stats: { asSender: 0, asRecipient: 0, asMentioned: 0, total: 0 }, letters: [] });

test.describe('@mocked Public request ownership', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(url => url.origin === new URL(API_BASE_URL).origin, route => route.fulfill({ json: {} }));
  });

  test('keeps the selected journal sort/page when an older request is released', async ({ page }) => {
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route(url => url.origin === new URL(API_BASE_URL).origin && url.pathname === '/blog', async route => {
      const url = new URL(route.request().url());
      const sort = url.searchParams.get('sort') || 'date';
      if (sort === 'title') await held;
      await route.fulfill({ json: journal(`${sort}-${url.searchParams.get('offset') || '0'}`) }).catch(() => {});
    });
    await page.goto('/blog');
    await expect(page.getByRole('heading', { name: 'date-0' })).toBeVisible();
    await page.getByRole('button', { name: 'Sort journal entries' }).click();
    const oldStarted = page.waitForRequest(request => new URL(request.url()).searchParams.get('sort') === 'title');
    await page.getByRole('option', { name: 'Title' }).click();
    await oldStarted;
    await page.getByRole('option', { name: 'Author' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'author-0' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('link', { name: 'Older posts' }).click();
    await expect(page.getByRole('heading', { name: 'author-12' })).toBeVisible();
    release();
    await expect(page.getByRole('heading', { name: 'author-12' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sort journal entries' })).toContainText('Author');
    await expect(page).toHaveURL(/page=2/);
  });

  test('person navigation recovers from errors and ignores a superseded response', async ({ page }) => {
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let bRequests = 0;
    await page.route(url => url.origin === new URL(API_BASE_URL).origin && url.pathname.startsWith('/persons/'), async route => {
      const id = new URL(route.request().url()).pathname.split('/').at(-1)!;
      if (id === 'b' && ++bRequests === 1) {
        await route.fulfill({ status: 500, json: { error: 'Person request failed' } }); return;
      }
      if (id === 'b') await held;
      await route.fulfill({ json: person(id) }).catch(() => {});
    });
    await page.goto('/people/a');
    await page.getByRole('link', { name: 'Person b' }).click();
    await expect(page.getByRole('heading', { name: 'Person Not Found' })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Person a' })).toBeVisible();
    await page.getByRole('link', { name: 'Person b' }).click();
    await expect(page.getByText('Loading person...')).toBeVisible();
    await page.goBack();
    await page.getByRole('link', { name: 'Person c' }).click();
    await expect(page.getByRole('heading', { name: 'Person c' })).toBeVisible();
    release();
    await expect(page.getByRole('heading', { name: 'Person c' })).toBeVisible();
    await expect(page).toHaveURL(/people\/c$/);
  });
});
