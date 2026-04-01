import { Router } from 'express';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { db, letterPages } from '../db/index.js';
import { verifyToken } from '../auth/jwt.js';
import { getAbsoluteStoragePath } from '../services/storage.js';
import { logIfSlow, TIMING_THRESHOLDS } from '../utils/logger.js';

const router = Router();

// In-memory LRU cache for resized images (avoids re-encoding on repeated requests)
const IMAGE_CACHE_MAX = 300;
const imageCache = new Map<string, { buffer: Buffer; contentType: string }>();

function getCachedImage(key: string) {
  const entry = imageCache.get(key);
  if (entry) {
    imageCache.delete(key);
    imageCache.set(key, entry);
  }
  return entry ?? null;
}

function setCachedImage(key: string, buffer: Buffer, contentType: string) {
  if (imageCache.size >= IMAGE_CACHE_MAX) {
    const oldest = imageCache.keys().next().value;
    if (oldest !== undefined) imageCache.delete(oldest);
  }
  imageCache.set(key, { buffer, contentType });
}

const MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',
};

const MAX_THUMBNAIL_WIDTH = 1600;

/**
 * GET /images/:pageId - Serve an image by page ID
 */
router.get('/images/:pageId', async (req, res, next) => {
  const start = Date.now();
  try {
    const { pageId } = req.params;
    const requestedWidth = parseRequestedWidth(req.query.w);

    // Find the page record
    const page = await db.query.letterPages.findFirst({
      where: eq(letterPages.id, pageId),
      with: {
        letter: {
          columns: {
            visibility: true,
          },
        },
      },
    });

    if (!page || !page.letter) {
      req.log.debug({ pageId }, 'Image page not found');
      res.status(404).json({ error: 'Image not found' });
      return;
    }

    // Public requests can only see published images; admins can see all
    if (page.letter.visibility !== 'PUBLISHED') {
      const authHeader = req.headers.authorization;
      const headerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
      const queryToken = typeof req.query.token === 'string' ? req.query.token : null;
      const token = headerToken || queryToken;
      const isAdmin = token ? !!verifyToken(token) : false;
      if (!isAdmin) {
        req.log.debug({ pageId }, 'Image not published and requester is not admin');
        res.status(404).json({ error: 'Image not found' });
        return;
      }
    }

    // Get absolute path
    const absolutePath = getAbsoluteStoragePath(page.storagePath);

    // Check file exists
    let fileStats;
    try {
      fileStats = await stat(absolutePath);
    } catch {
      req.log.error({ pageId, path: absolutePath }, 'Image file not found on disk');
      res.status(404).json({ error: 'Image file not found on disk' });
      return;
    }

    // Determine content type from original filename
    const ext = extname(page.originalFilename).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    // Set headers
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Timing-Allow-Origin', '*');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (requestedWidth) {
      const acceptHeader = req.headers.accept || '';
      const format = acceptHeader.includes('image/avif') ? 'avif'
        : acceptHeader.includes('image/webp') ? 'webp'
        : 'jpeg';
      const cacheKey = `${pageId}:${requestedWidth}:${format}`;

      const cached = getCachedImage(cacheKey);
      if (cached) {
        res.setHeader('Content-Type', cached.contentType);
        res.setHeader('Vary', 'Accept');
        res.send(cached.buffer);
        return;
      }

      const pipeline = sharp(absolutePath)
        .rotate()
        .resize({
          width: requestedWidth,
          fit: 'inside',
          withoutEnlargement: true,
        });

      const transformed = format === 'avif'
        ? pipeline.avif({ quality: 60, effort: 4 })
        : format === 'webp'
        ? pipeline.webp({ quality: 76, effort: 4 })
        : pipeline.jpeg({ quality: 78, progressive: true, mozjpeg: true });

      const outputBuffer = await transformed.toBuffer();
      const contentType = `image/${format}`;
      setCachedImage(cacheKey, outputBuffer, contentType);

      res.setHeader('Content-Type', contentType);
      res.setHeader('Vary', 'Accept');
      res.send(outputBuffer);

      const duration = Date.now() - start;
      req.log.debug(
        { pageId, requestedWidth, originalSizeBytes: fileStats.size, resizedSizeBytes: outputBuffer.byteLength, duration },
        'Resized image served',
      );
      logIfSlow(req.log, 'resized image serving', duration, TIMING_THRESHOLDS.IMAGE_STREAM, {
        pageId,
        requestedWidth,
      });
      return;
    }

    res.setHeader('Content-Type', contentType);

    // Stream the file
    const stream = createReadStream(absolutePath);
    stream.on('error', (err) => {
      req.log.error({ pageId, path: absolutePath, err }, 'Stream error while serving image');
      if (!res.headersSent) {
        res.status(500).json({ error: 'Error reading image file' });
      }
    });

    stream.on('end', () => {
      const duration = Date.now() - start;
      req.log.debug({ pageId, sizeBytes: fileStats.size, duration }, 'Image served');
      logIfSlow(req.log, 'image streaming', duration, TIMING_THRESHOLDS.IMAGE_STREAM, { pageId });
    });

    stream.pipe(res);
  } catch (error) {
    next(error);
  }
});

export default router;

function parseRequestedWidth(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const width = Number.parseInt(value, 10);
  if (!Number.isFinite(width) || width <= 0) return null;
  return Math.min(width, MAX_THUMBNAIL_WIDTH);
}
