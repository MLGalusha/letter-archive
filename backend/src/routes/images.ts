import { Router } from 'express';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { eq } from 'drizzle-orm';
import { db, letterPages } from '../db/index.js';
import { getAbsoluteStoragePath } from '../services/storage.js';

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
  try {
    const { pageId } = req.params;

    // Find the page record
    const page = await db.query.letterPages.findFirst({
      where: eq(letterPages.id, pageId),
    });

    if (!page) {
      res.status(404).json({ error: 'Image not found' });
      return;
    }

    // Get absolute path
    const absolutePath = getAbsoluteStoragePath(page.storagePath);

    // Check file exists
    try {
      await stat(absolutePath);
    } catch {
      console.error(`Image file not found at: ${absolutePath}`);
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
      console.error('Stream error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Error reading image file' });
      }
    });

    stream.pipe(res);
  } catch (error) {
    next(error);
  }
});

export default router;
