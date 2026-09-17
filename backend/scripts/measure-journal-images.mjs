// Local fixture only; no database or production requests.
// node --import tsx scripts/measure-journal-images.mjs [--serve]
import express from 'express';
import { mkdtemp, mkdir, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { createBlogImagesRouter } from '../src/routes/blog-images.ts';
const root = await mkdtemp(join(tmpdir(), 'journal-fixture-'));
await mkdir(join(root, 'blog'));
const fixture = fileURLToPath(new URL('../../frontend/src/assets/mock/002-L-12141900-3.jpg', import.meta.url));
await copyFile(fixture, join(root, 'blog', 'scan.jpg'));
await copyFile(fixture, join(root, 'blog', 'fallback.jpg'));
const frames = Buffer.concat([Buffer.alloc(20 * 20 * 3, 20), Buffer.alloc(20 * 20 * 3, 220)]);
await sharp(frames, { raw: { width: 20, height: 40, channels: 3, pageHeight: 20 } }).gif({ loop: 0, delay: [100, 100] }).toFile(join(root, 'blog', 'animated.gif'));
const post = { id: 'fixture', slug: 'fixture', title: 'Journal image fixture', excerpt: 'Local image delivery checks',
  authorDisplayName: 'Local fixture', publishedAt: '2026-09-17', createdAt: '2026-09-17', heroImageUrl: '/blog-images/scan.jpg',
  heroImageAlt: 'Hero scan', bodyMarkdown: `${Array.from({ length: 65 }, () => 'Fixture paragraph for offscreen image checks.').join('\n\n')}\n\n![Inline scan](/blog-images/scan.jpg?inline=1)\n\n![Animated scan](/blog-images/animated.gif)\n\n![Recovering scan](/blog-images/fallback.jpg)` };
const app = express();
app.use((_req, res, next) => { res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:4196'); res.setHeader('Access-Control-Allow-Credentials', 'true'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); res.setHeader('Timing-Allow-Origin', '*'); next(); });
app.get('/settings/public', (_req, res) => res.json({}));
app.get('/collections', (_req, res) => res.json([]));
app.get('/blog', (_req, res) => res.json({ posts: [post], total: 1 }));
app.get('/blog/fixture', (_req, res) => res.json(post));
app.get('/blog-images/fallback.jpg', (req, res, next) => req.query.w ? res.status(503).end() : next());
app.use(createBlogImagesRouter(root));
const server = app.listen(process.argv.includes('--serve') ? 4197 : 0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
if (process.argv.includes('--serve')) {
  console.log(JSON.stringify({ base, fixture, root }));
  const close = () => { server.closeAllConnections(); server.close(async () => { await rm(root, { recursive: true, force: true }); process.exit(0); }); };
  process.on('SIGTERM', close); process.on('SIGINT', close);
} else {
  try {
    const measurements = [];
    for (const width of [null, 480, 800, 1200, 1600]) {
      const started = performance.now();
      const response = await fetch(`${base}/blog-images/scan.jpg${width ? `?w=${width}&rendition=1` : ''}`, { headers: { accept: 'image/webp' } });
      const bytes = Buffer.from(await response.arrayBuffer());
      const metadata = await sharp(bytes).metadata();
      measurements.push({ requestedWidth: width, bytes: bytes.length, width: metadata.width, height: metadata.height,
        format: metadata.format, responseMs: +(performance.now() - started).toFixed(2), decodedRgbaBytes: metadata.width * metadata.height * 4 });
    }
    console.log(JSON.stringify({ fixture, note: 'Local route/encoding samples, not production timings or device memory measurements.', measurements }, null, 2));
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); }
}
