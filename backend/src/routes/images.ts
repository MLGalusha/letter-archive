import { Router } from 'express';
import { performance } from 'node:perf_hooks';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { and, eq } from 'drizzle-orm';
import sharp from 'sharp';
import fresh from 'fresh';
import { adminUsers, db, letterPages, letters } from '../db/index.js';
import { readImageSessionCookie } from '../auth/image-session.js';
import { verifyImageSessionToken } from '../auth/jwt.js';
import {
  isPublicCatalogueLetterType,
  publicCatalogueLetterTypeSql,
} from '../services/public-catalogue-unit.js';
import { getAbsoluteStoragePath } from '../services/storage.js';
import { logIfSlow, TIMING_THRESHOLDS } from '../utils/logger.js';
import { isSensitiveQueryKey } from '../utils/log-redaction.js';
import { ImageTransformScheduler, ImageTransformOverloadError, ImageTransformAbortedError } from '../services/image-transform-scheduler.js';
import { imageVariantIdentity } from '../services/image-variant.js';

// In-memory LRU cache for resized images (avoids re-encoding on repeated requests)
const IMAGE_CACHE_MAX = 1000;
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
  imageCache.delete(key);
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

/** Allows isolated diagnostics to exercise the real route with explicit scheduler limits. */
export function createImagesRouter(imageTransforms = new ImageTransformScheduler({ concurrency: 2, maxQueued: 32, maxWaiters: 64 })) {
  const router = Router();

  /**
   * GET /images/:pageId - Serve an image by page ID
   */
  router.get('/images/:pageId', async (req, res, next) => {
    const start = Date.now();
    const abandoned = new AbortController();
    const metrics: Record<string, unknown> = {};
    const onAborted = () => abandoned.abort();
    const onClose = () => {
      if (!res.writableFinished) {
        abandoned.abort();
        req.log.debug({ ...metrics, ...imageTransforms.state, responseMs: Date.now() - start }, 'Image response abandoned');
      }
    };
    req.once('aborted', onAborted);
    if (req.aborted || res.destroyed) abandoned.abort();
    res.once('close', onClose);
    res.once('finish', () => req.log.info({
      ...metrics, ...imageTransforms.state, responseMs: Date.now() - start, statusCode: res.statusCode,
    }, 'Image response completed'));
    try {
      const { pageId } = req.params;
      const requestedWidth = parseRequestedWidth(req.query.w);
      metrics.pageId = pageId;
      metrics.requestedWidth = requestedWidth;
      // Fail closed for every early return. Anonymous, authorized public images
      // override this only after publication and storage checks succeed.
      res.setHeader('Cache-Control', 'private, no-store');
      const imageSessionToken = readImageSessionCookie(req.headers.cookie);
      const hasSensitiveImageQuery = Object.keys(req.query).some((key) => (
        isSensitiveQueryKey(key)
      ));
      const hasImageCredentials = Boolean(
        imageSessionToken
        || req.headers.authorization
        || hasSensitiveImageQuery,
      );

      const accessible = await findAccessibleImage(pageId, imageSessionToken);
      if (!accessible) {
        res.status(404).json({ error: 'Image not found' });
        return;
      }
      const { page, isPublicCatalogueImage } = accessible;

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

      if (abandoned.signal.aborted) return;

      // Determine content type from original filename
      const ext = extname(page.originalFilename).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';

      // Public images must be revalidated so revoking publication takes effect on
      // the next request. Hidden images are authorization-bound and must never be
      // retained by browsers or shared caches.
      if (isPublicCatalogueImage && !hasImageCredentials) {
        res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
      }
      res.setHeader('Timing-Allow-Origin', '*');
      res.setHeader('X-Content-Type-Options', 'nosniff');

      if (requestedWidth) {
        const acceptHeader = req.headers.accept || '';
        const format = acceptHeader.includes('image/avif') ? 'avif'
          : acceptHeader.includes('image/webp') ? 'webp'
          : 'jpeg';
        const cacheKey = imageVariantIdentity({
          pageId, checksumSha256: page.checksumSha256, storagePath: page.storagePath,
          mtimeMs: fileStats.mtimeMs, size: fileStats.size,
        }, requestedWidth, format);
        // Weak validator describes this representation without requiring encoded
        // bytes to exist in this process. Access and source existence were checked
        // above; conditional requests must never bypass those checks.
        const etag = `W/"preview-${cacheKey}"`;
        res.setHeader('ETag', etag);
        res.setHeader('Vary', 'Accept');
        // If-None-Match takes precedence over If-Modified-Since. This route has
        // no Last-Modified validator; do not let Express require both to match.
        if (fresh({
          'if-none-match': req.headers['if-none-match'],
          'cache-control': req.headers['cache-control'],
        }, { etag })) {
          metrics.cache = 'not-modified';
          res.status(304).end();
          return;
        }
        // Authorization affects whether a row is public, not the bytes produced
        // for an already-public image. Reuse that transform even when a request
        // carries stale credentials; response cache headers remain private.
        const canUseSharedCache = isPublicCatalogueImage;

        const cached = canUseSharedCache ? getCachedImage(cacheKey) : null;
        if (cached) {
          metrics.cache = 'hit';
          res.setHeader('Content-Type', cached.contentType);
          res.setHeader('Vary', 'Accept');
          res.send(cached.buffer);
          return;
        }

        metrics.cache = 'miss';
        const variant = await imageTransforms.schedule(async () => {
          const pipeline = sharp(absolutePath).rotate().resize({
            width: requestedWidth, fit: 'inside', withoutEnlargement: true,
          });
          const transformed = format === 'avif'
            ? pipeline.avif({ quality: 60, effort: 2 })
            : format === 'webp'
            ? pipeline.webp({ quality: 76, effort: 4 })
            : pipeline.jpeg({ quality: 78, progressive: true, mozjpeg: true });
          return { buffer: await transformed.toBuffer(), contentType: `image/${format}` };
        }, { key: canUseSharedCache ? cacheKey : undefined, signal: abandoned.signal });
        metrics.queueMs = variant.queueMs;
        metrics.transformMs = variant.transformMs;
        metrics.shared = variant.shared;

        // Waiting must not let a shared result bypass a caller's current access.
        const recheckStarted = performance.now();
        const current = await findAccessibleImage(pageId, imageSessionToken);
        metrics.accessRecheckMs = performance.now() - recheckStarted;
        if (abandoned.signal.aborted) return;
        if (!current) {
          res.setHeader('Cache-Control', 'private, no-store');
          res.status(404).json({ error: 'Image not found' });
          return;
        }
        if (current.page.checksumSha256 !== page.checksumSha256 || current.page.storagePath !== page.storagePath) {
          res.setHeader('Cache-Control', 'private, no-store');
          res.setHeader('Retry-After', '1');
          res.status(503).json({ error: 'Image changed during processing; retry the request' });
          return;
        }
        const versionStarted = performance.now();
        let currentStats;
        try { currentStats = await stat(absolutePath); } catch {
          res.setHeader('Cache-Control', 'private, no-store');
          res.status(404).json({ error: 'Image file not found on disk' });
          return;
        }
        metrics.versionRecheckMs = performance.now() - versionStarted;
        if (currentStats.mtimeMs !== fileStats.mtimeMs || currentStats.size !== fileStats.size) {
          res.setHeader('Cache-Control', 'private, no-store');
          res.setHeader('Retry-After', '1');
          res.status(503).json({ error: 'Image changed during processing; retry the request' });
          return;
        }
        if (abandoned.signal.aborted) return;
        const outputBuffer = variant.buffer;
        const contentType = variant.contentType;
        if (current.isPublicCatalogueImage) setCachedImage(cacheKey, outputBuffer, contentType);
        if (!current.isPublicCatalogueImage) res.setHeader('Cache-Control', 'private, no-store');

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
      if (error instanceof ImageTransformAbortedError || abandoned.signal.aborted) {
        req.log.debug({ ...imageTransforms.state }, 'Abandoned image request');
        return;
      }
      if (error instanceof ImageTransformOverloadError) {
        metrics.overloaded = true;
        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader('Retry-After', '1');
        res.status(503).json({ error: 'Image processing is busy; retry shortly' });
        return;
      }
      next(error);
    } finally {
      req.off('aborted', onAborted);
      res.off('close', onClose);
    }
  });

  return router;
}

export default createImagesRouter();

function parseRequestedWidth(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const width = Number.parseInt(value, 10);
  if (!Number.isFinite(width) || width <= 0) return null;
  return Math.min(width, MAX_THUMBNAIL_WIDTH);
}

async function findAccessibleImage(pageId: string, imageSessionToken: string | null | undefined) {
  const page = await db.query.letterPages.findFirst({
    where: eq(letterPages.id, pageId),
    with: {
      letter: {
        columns: {
          visibility: true,
          collectionId: true,
          dateRaw: true,
          typeSequence: true,
          type: true,
        },
      },
    },
  });

  if (!page || !page.letter) {
    return null;
  }

  const isPublicCatalogueImage = page.letter.visibility === 'PUBLISHED' && (
    isPublicCatalogueLetterType(page.letter.type)
    || Boolean(await db.query.letters.findFirst({
      where: and(
        eq(letters.collectionId, page.letter.collectionId),
        eq(letters.dateRaw, page.letter.dateRaw),
        eq(letters.typeSequence, page.letter.typeSequence),
        eq(letters.visibility, 'PUBLISHED'),
        publicCatalogueLetterTypeSql(letters.type),
      ),
      columns: { id: true },
    }))
  );

  // Public requests can only see images belonging to a public catalogue
  // unit. Admins may inspect hidden rows and orphan supplementary media.
  if (!isPublicCatalogueImage) {
    const imageSession = imageSessionToken
      ? verifyImageSessionToken(imageSessionToken)
      : null;
    const existingAdmin = imageSession
      ? await db.query.adminUsers.findFirst({
        where: eq(adminUsers.id, imageSession.userId),
        columns: { id: true },
      })
      : null;
    const isAdmin = Boolean(existingAdmin);
    if (!isAdmin) {
      return null;
    }
  }

  return { page, isPublicCatalogueImage };
}
