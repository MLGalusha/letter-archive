import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createBlogImagesRouter } from '../blog-images.js';
import { ImageVariantStore } from '../../services/image-variant-store.js';
import { ImageTransformScheduler } from '../../services/image-transform-scheduler.js';

let root: string, base: string, server: Server, original: Buffer;
const animations: Record<string, Buffer> = {};
let store: ImageVariantStore;
let schedule: ReturnType<typeof vi.spyOn>;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'journal-image-route-'));
  await mkdir(join(root, 'blog'));
  original = await sharp({ create: { width: 1800, height: 1200, channels: 3, background: '#ad7352' } }).jpeg().toBuffer();
  await writeFile(join(root, 'blog', 'legacy.jpg'), original);
  await sharp({ create: { width: 1600, height: 800, channels: 3, background: 'blue' } })
    .withMetadata({ orientation: 6 }).jpeg().toFile(join(root, 'blog', 'rotated.jpg'));
  const frames = Buffer.concat([Buffer.alloc(20 * 20 * 3, 20), Buffer.alloc(20 * 20 * 3, 220)]);
  animations.webp = await sharp(frames, { raw: { width: 20, height: 40, channels: 3, pageHeight: 20 } }).webp({ loop: 0, delay: [100, 100] }).toBuffer();
  animations.gif = await sharp(animations.webp, { animated: true }).gif().toBuffer();
  const png = await sharp(original).png().toBuffer();
  // acTL before IDAT: this envelope only tests byte-exact preservation, not decode.
  const control = Buffer.alloc(20); control.writeUInt32BE(8); control.write('acTL', 4); control.writeUInt32BE(2, 8);
  animations.png = Buffer.concat([png.subarray(0, 33), control, png.subarray(33)]);
  for (const [extension, bytes] of Object.entries(animations)) await writeFile(join(root, 'blog', `animated.${extension}`), bytes);
  await writeFile(join(root, 'blog', 'broken.jpg'), 'not an image');
  store = new ImageVariantStore(root);
  const scheduler = new ImageTransformScheduler({ concurrency: 1, maxQueued: 16, maxWaiters: 32 });
  schedule = vi.spyOn(scheduler, 'schedule');
  const app = express();
  app.use(createBlogImagesRouter(root, scheduler, store));
  app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(500).end());
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/blog-images/`;
});
afterAll(async () => { server?.closeAllConnections(); await new Promise<void>(resolve => server?.close(() => resolve())); await rm(root, { recursive: true, force: true }); });

describe('journal image delivery', () => {
  it('keeps legacy originals and immutable caching unchanged', async () => {
    const response = await fetch(`${base}legacy.jpg`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('immutable');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(original);
  });
  it.each([480, 800, 1200, 1600])('serves bounded %dpx WebP and reuses saved bytes', async (width) => {
    const url = `${base}legacy.jpg?w=${width}&rendition=1`;
    const response = await fetch(url, { headers: { accept: 'image/webp' } });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('image/webp');
    expect(response.headers.get('vary')).toBe('Accept');
    const bytes = Buffer.from(await response.arrayBuffer());
    expect((await sharp(bytes).metadata()).width).toBe(width);
    const count = schedule.mock.calls.length;
    const saved = await fetch(url, { headers: { accept: 'image/webp' } });
    expect(Buffer.from(await saved.arrayBuffer())).toEqual(bytes);
    expect(schedule.mock.calls.length).toBe(count);
    const conditional = await fetch(url, { headers: { accept: 'image/webp', 'cache-control': 'max-age=0', 'if-none-match': response.headers.get('etag')! } });
    expect(conditional.status).toBe(304);
    expect(await conditional.text()).toBe('');
    expect(schedule.mock.calls.length).toBe(count);
  });
  it('negotiates separate representations and keeps orientation', async () => {
    const jpeg = await fetch(`${base}rotated.jpg?w=480`, { headers: { accept: 'image/jpeg' } });
    const avif = await fetch(`${base}rotated.jpg?w=480`, { headers: { accept: 'image/avif' } });
    expect(jpeg.headers.get('etag')).not.toBe(avif.headers.get('etag'));
    expect(await sharp(Buffer.from(await jpeg.arrayBuffer())).metadata()).toMatchObject({ width: 480, height: 960, format: 'jpeg' });
    expect(await sharp(Buffer.from(await avif.arrayBuffer())).metadata()).toMatchObject({ width: 480, height: 960, format: 'heif' });
  });
  it.each(['webp', 'gif', 'png'])('preserves animated %s original bytes', async (extension) => {
    const response = await fetch(`${base}animated.${extension}?w=480`, { headers: { accept: 'image/avif' } });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain(`image/${extension}`);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(animations[extension]);
    if (extension === 'webp') expect((await sharp(animations.webp).metadata()).pages).toBe(2);
  });
  it('rejects unsupported widths and missing/traversal paths without immutable error caching', async () => {
    for (const suffix of ['legacy.jpg?w=500', 'legacy.jpg?w=abc', 'legacy.jpg?w=480&w=800', '%2e%2e%2fsecret.jpg?w=480', 'missing.jpg?w=480']) {
      const response = await fetch(base + suffix);
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.headers.get('cache-control')).not.toContain('immutable');
    }
  });
  it('tolerates optional storage failures and replaces validators with changed source bytes', async () => {
    const read = vi.spyOn(store, 'read').mockResolvedValueOnce({ status: 'invalid' });
    const write = vi.spyOn(store, 'write').mockResolvedValueOnce('error');
    const response = await fetch(`${base}legacy.jpg?w=480`, { headers: { accept: 'image/jpeg' } });
    expect(response.status).toBe(200); await response.arrayBuffer();
    expect(write).toHaveBeenCalled(); read.mockRestore(); write.mockRestore();
    await writeFile(join(root, 'blog', 'legacy.jpg'), await sharp(original).resize(900).jpeg().toBuffer());
    const replaced = await fetch(`${base}legacy.jpg?w=480`, { headers: { accept: 'image/jpeg', 'if-none-match': response.headers.get('etag')! } });
    expect(replaced.status).toBe(200);
    expect(replaced.headers.get('etag')).not.toBe(response.headers.get('etag'));
    expect((await sharp(Buffer.from(await replaced.arrayBuffer())).metadata()).width).toBe(480);
    expect((await fetch(`${base}broken.jpg?w=480`)).status).toBe(500);
  });
});
