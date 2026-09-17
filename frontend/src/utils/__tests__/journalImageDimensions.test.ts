import { describe, expect, it } from 'vitest';
import { journalImageSourcesInPost } from '../journalImageSourcesInPost';
import { dimensionsForPost, validImageDimensions } from '../journalImageDimensions';
describe('journal dimension ownership', () => {
  it('finds inline, reference and collapsed-reference images without modifying float titles', () => {
    const markdown = '![inline](/blog-images/a.jpg "float-left")\n\n![reference][scan]\n\n![scan][]\n\n[scan]: /images/page?v=two "float-right"\n\n`![code](/ignored)`';
    expect(journalImageSourcesInPost(markdown, '/hero')).toEqual(['/hero', '/blog-images/a.jpg', '/images/page?v=two']);
  });
  it('prunes stale exact-source entries and refuses invalid axes', () => {
    const map = { '/old': { width: 1, height: 2 }, '/new?v=1': { width: 100, height: 200 }, '/bad': { width: 0, height: 8 } };
    expect(dimensionsForPost(['/new?v=2', '/bad'], map)).toEqual({});
    expect(dimensionsForPost(['/new?v=1'], map)).toEqual({ '/new?v=1': map['/new?v=1'] });
    expect(validImageDimensions({ width: 100001, height: 2 })).toBeUndefined();
  });
});

it('uses the first duplicate reference definition like the renderer', () => {
  expect(journalImageSourcesInPost('![x][scan]\n\n[scan]: /a.jpg\n[SCAN]: /b.jpg', '')).toEqual(['/a.jpg']);
});

it('matches the renderer reference identifier case and whitespace normalization', () => {
  expect(journalImageSourcesInPost('![x][  Scan   Name  ]\n\n[scan name]: /a.jpg', '')).toEqual(['/a.jpg']);
});
