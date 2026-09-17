import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { journalDimensionsSchema, readImageDimensions, resolveJournalImageDimensions } from '../journal-image-dimensions.js';
let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'journal-dimensions-'));
  await mkdir(join(root, 'blog'));
  await sharp({ create: { width: 160, height: 80, channels: 3, background: 'blue' } }).withMetadata({ orientation: 6 }).jpeg().toFile(join(root, 'blog', 'rotated.jpg'));
  const frames = Buffer.concat([Buffer.alloc(20 * 10 * 3, 20), Buffer.alloc(20 * 10 * 3, 220)]);
  for (const format of ['gif', 'webp'] as const) await sharp(frames, { raw: { width: 20, height: 20, channels: 3, pageHeight: 10 } }).toFormat(format, { loop: 0, delay: [100, 100] }).toFile(join(root, 'blog', `animated.${format}`));
  await writeFile(join(root, 'blog', 'bad.jpg'), 'bad');
});
afterAll(() => rm(root, { recursive: true, force: true }));
describe('journal image dimensions', () => {
  it('validates bounded positive axes and a bounded map', () => {
    expect(journalDimensionsSchema.safeParse({ '/a': { width: 100, height: 200 } }).success).toBe(true);
    for (const width of [0, -1, 1.5, 100001, Infinity]) expect(journalDimensionsSchema.safeParse({ '/a': { width, height: 2 } }).success).toBe(false);
    expect(journalDimensionsSchema.safeParse(Object.fromEntries(Array.from({ length: 65 }, (_, i) => [String(i), { width: 1, height: 1 }]))).success).toBe(false);
  });
  it('uses oriented axes and one animation frame rather than a tall strip', async () => {
    expect(await readImageDimensions(join(root, 'blog', 'rotated.jpg'))).toEqual({ width: 80, height: 160 });
    for (const extension of ['gif', 'webp']) expect(await readImageDimensions(join(root, 'blog', `animated.${extension}`))).toEqual({ width: 20, height: 10 });
    expect(await readImageDimensions(join(root, 'blog', 'bad.jpg'))).toBeUndefined();
  });
  it('resolves exact owned sources, rejects outside paths and does no external fetch', async () => {
    const letterId = '11111111-1111-1111-1111-111111111111';
    const findLetterPath = vi.fn().mockResolvedValue(join(root, 'blog', 'rotated.jpg'));
    const sources = ['/blog-images/rotated.jpg?v=1', `/images/${letterId}?v=2`, 'https://external.test/blog-images/rotated.jpg', '/blog-images/missing.jpg'];
    const result = await resolveJournalImageDimensions(sources, { '/old': { width: 2, height: 3 } }, { storageDir: root, apiOrigin: 'http://api.test', findLetterPath });
    expect(result.dimensions).toEqual({ [sources[0]]: { width: 80, height: 160 }, [sources[1]]: { width: 80, height: 160 } });
    expect(result.unresolved).toEqual(['/blog-images/missing.jpg']);
    expect(findLetterPath).toHaveBeenCalledOnce();
    await symlink('/etc/passwd', join(root, 'blog', 'outside.jpg'));
    const outside = await resolveJournalImageDimensions(['/blog-images/outside.jpg'], {}, { storageDir: root, apiOrigin: 'http://api.test', findLetterPath });
    expect(outside.dimensions).toEqual({});
  });
  it('keeps autosave metadata without reading files and removes failed owned reservations', async () => {
    const dimensions = { '/blog-images/missing.jpg': { width: 2, height: 3 } };
    const options = { storageDir: '/does-not-exist', apiOrigin: 'http://api.test', findLetterPath: vi.fn() };
    expect((await resolveJournalImageDimensions([], dimensions, options)).dimensions).toEqual(dimensions);
    expect((await resolveJournalImageDimensions(Object.keys(dimensions), dimensions, options)).dimensions).toEqual({});
  });
});
