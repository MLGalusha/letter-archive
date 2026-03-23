import { Router } from 'express';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { eq } from 'drizzle-orm';
import { db, letterPages } from '../db/index.js';
import { verifyToken } from '../auth/jwt.js';
import { getAbsoluteStoragePath } from '../services/storage.js';
import { logIfSlow, TIMING_THRESHOLDS } from '../utils/logger.js';

const router = Router();

const MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',
};

/**
 * GET /images/:pageId - Serve an image by page ID
 */
router.get('/images/:pageId', async (req, res, next) => {
  const start = Date.now();
  try {
    const { pageId } = req.params;

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
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000'); // 1 year cache
    res.setHeader('X-Content-Type-Options', 'nosniff');

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
