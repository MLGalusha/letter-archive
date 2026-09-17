import { Router } from 'express';
import { createReadStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import sharp from 'sharp';
import fresh from 'fresh';
import { env } from '../config/env.js';
import { imageVariantIdentity, isSavedPreviewWidth } from '../services/image-variant.js';
import { ImageVariantStore } from '../services/image-variant-store.js';
import { ImageTransformScheduler, ImageTransformAbortedError, ImageTransformOverloadError } from '../services/image-transform-scheduler.js';

const MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif',
};
const RESIZABLE = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif']);
const ORIGINAL = 'original-animation';
const MAX_DECODE_PIXELS = 40_000_000;

// Sharp does not expose APNG frames on every build. acTL must precede IDAT.
// Walk headers without decoding or allocating payload chunks; uncertain files
// are passed through rather than risking flattening an animation.
async function mayBeAnimatedPng(path: string, size: number): Promise<boolean> {
  const file = await open(path, 'r');
  try {
    const header = Buffer.alloc(8);
    if ((await file.read(header, 0, 8, 0)).bytesRead !== 8
      || !header.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return true;
    let offset = 8;
    for (let chunk = 0; chunk < 128 && offset + 12 <= size; chunk++) {
      if ((await file.read(header, 0, 8, offset)).bytesRead !== 8) return true;
      const type = header.toString('ascii', 4, 8);
      if (type === 'acTL') return true;
      if (type === 'IDAT' || type === 'IEND') return false;
      offset += 12 + header.readUInt32BE(0);
    }
    return true;
  } finally { await file.close(); }
}

/** Journal uploads are public immutable assets, independent of letter access checks. */
export function createBlogImagesRouter(
  storageDir = env.STORAGE_DIR,
  scheduler = new ImageTransformScheduler({ concurrency: 1, maxQueued: 16, maxWaiters: 32 }),
  store = new ImageVariantStore(resolve(storageDir)),
) {
  const router = Router();
  router.get('/blog-images/:filename', async (req, res, next) => {
    const abandoned = new AbortController();
    const onAborted = () => abandoned.abort();
    const onClose = () => { if (!res.writableFinished) abandoned.abort(); };
    req.once('aborted', onAborted);
    res.once('close', onClose);
    if (req.aborted || res.destroyed) abandoned.abort();
    try {
      res.setHeader('Cache-Control', 'private, no-store');
      const { filename } = req.params;
      if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        res.status(400).json({ error: 'Invalid filename' }); return;
      }
      const blogDir = resolve(join(storageDir, 'blog'));
      const filePath = resolve(join(blogDir, filename));
      if (!filePath.startsWith(blogDir + '/')) {
        res.status(400).json({ error: 'Invalid filename' }); return;
      }
      let source;
      try { source = await stat(filePath); } catch {
        res.status(404).json({ error: 'Image not found' }); return;
      }
      if (!source.isFile()) { res.status(404).json({ error: 'Image not found' }); return; }
      const width = typeof req.query.w === 'string' && /^\d+$/.test(req.query.w) ? Number(req.query.w) : null;
      if (req.query.w !== undefined && (width === null || !isSavedPreviewWidth(width))) {
        res.status(400).json({ error: 'Unsupported image width' }); return;
      }
      const ext = extname(filename).toLowerCase();
      const originalType = MIME_TYPES[ext] || 'application/octet-stream';
      const streamOriginal = () => {
        if (abandoned.signal.aborted) return;
        res.setHeader('Content-Type', originalType);
        res.setHeader('Content-Length', source.size);
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        const stream = createReadStream(filePath);
        res.once('close', () => stream.destroy());
        stream.on('error', () => {
          if (!res.headersSent) { res.setHeader('Cache-Control', 'private, no-store'); res.status(500).end(); }
          else res.destroy();
        });
        stream.pipe(res);
      };
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (!width || !RESIZABLE.has(ext)) { streamOriginal(); return; }
      const accept = req.headers.accept ?? '';
      const format = accept.includes('image/avif') ? 'avif' : accept.includes('image/webp') ? 'webp' : 'jpeg';
      const identity = imageVariantIdentity({ pageId: `blog:${filename}`, storagePath: filePath,
        mtimeMs: source.mtimeMs, size: source.size }, width, format);
      const etag = `W/"blog-preview-${identity}"`;
      res.setHeader('ETag', etag);
      res.setHeader('Vary', 'Accept');
      if (fresh({ 'if-none-match': req.headers['if-none-match'], 'cache-control': req.headers['cache-control'] }, { etag })) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.status(304).end(); return;
      }
      const saved = await store.read(identity, width, format);
      if (abandoned.signal.aborted) return;
      let bytes = saved.status === 'hit' ? saved.buffer : undefined;
      if (!bytes) {
        const variant = await scheduler.schedule(async () => {
          // Animated WebP/APNG/AVIF must retain every frame, like GIF originals.
          if (ext === '.png' && await mayBeAnimatedPng(filePath, source.size)) {
            return { buffer: Buffer.alloc(0), contentType: ORIGINAL };
          }
          const metadata = await sharp(filePath, { limitInputPixels: MAX_DECODE_PIXELS }).metadata();
          if ((metadata.pages ?? 1) > 1) return { buffer: Buffer.alloc(0), contentType: ORIGINAL };
          const pipeline = sharp(filePath, { limitInputPixels: MAX_DECODE_PIXELS })
            .timeout({ seconds: 10 }).rotate().resize({ width, fit: 'inside', withoutEnlargement: true });
          const encoded = format === 'avif' ? pipeline.avif({ quality: 60, effort: 2 })
            : format === 'webp' ? pipeline.webp({ quality: 76, effort: 4 })
            : pipeline.jpeg({ quality: 78, progressive: true, mozjpeg: true });
          return { buffer: await encoded.toBuffer(), contentType: `image/${format}` };
        }, { key: identity, signal: abandoned.signal });
        if (variant.contentType === ORIGINAL) { streamOriginal(); return; }
        bytes = variant.buffer;
        await store.write(identity, width, format, bytes);
      }
      // Never deliver obsolete bytes if a legacy file was replaced during work.
      const current = await stat(filePath);
      if (abandoned.signal.aborted) return;
      if (current.size !== source.size || current.mtimeMs !== source.mtimeMs) {
        res.setHeader('Retry-After', '1'); res.status(503).json({ error: 'Image changed; retry request' }); return;
      }
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('Content-Type', `image/${format}`);
      res.send(bytes);
    } catch (error) {
      if (abandoned.signal.aborted || error instanceof ImageTransformAbortedError) return;
      if (error instanceof ImageTransformOverloadError) {
        res.setHeader('Retry-After', '1'); res.status(503).json({ error: 'Image processing busy' }); return;
      }
      next(error);
    } finally { req.off('aborted', onAborted); }
  });
  return router;
}

export default createBlogImagesRouter();
