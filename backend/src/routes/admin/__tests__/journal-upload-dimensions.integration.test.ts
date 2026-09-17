import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import express from 'express';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Server } from 'node:http';
import sharp from 'sharp';
const config = vi.hoisted(() => ({ root: '' }));
vi.mock('../../../config/env.js', () => ({ env: { get STORAGE_DIR() { return config.root; } } }));
import router from '../blog-images.js';
let server: Server, base: string;
beforeAll(async () => { config.root = await mkdtemp(join(tmpdir(), 'journal-upload-')); const app = express(); app.use(router); server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${(server.address() as { port: number }).port}`; });
afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(config.root, { recursive: true, force: true }); });
it('returns displayed dimensions on upload while retaining original rotated and animated bytes', async () => {
  const jpg = await sharp({ create: { width: 120, height: 60, channels: 3, background: 'red' } }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const gif = await sharp(Buffer.concat([Buffer.alloc(600, 0), Buffer.alloc(600, 255)]), { raw: { width: 20, height: 20, channels: 3, pageHeight: 10 } }).gif({ loop: 0, delay: [100, 100] }).toBuffer();
  for (const [name, mime, bytes, dimensions] of [['scan.jpg', 'image/jpeg', jpg, { width: 60, height: 120 }], ['animation.gif', 'image/gif', gif, { width: 20, height: 10 }]] as const) {
    const form = new FormData(); form.append('file', new Blob([new Uint8Array(bytes)], { type: mime }), name);
    const response = await fetch(base + '/blog/images', { method: 'POST', body: form });
    expect(response.status).toBe(200);
    const result = await response.json() as { url: string; dimensions: unknown };
    expect(result.dimensions).toEqual(dimensions);
    expect(await readFile(join(config.root, 'blog', result.url.split('/').pop()!))).toEqual(bytes);
  }
});
