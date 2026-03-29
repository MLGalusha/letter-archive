import { Router } from 'express';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { env } from '../config/env.js';

const router = Router();

const MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

/**
 * GET /blog-images/:filename - Serve a blog image
 */
router.get('/blog-images/:filename', async (req, res, next) => {
  try {
    const { filename } = req.params;

    // Prevent path traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      res.status(400).json({ error: 'Invalid filename' });
      return;
    }

    const blogDir = resolve(join(env.STORAGE_DIR, 'blog'));
    const filePath = resolve(join(blogDir, filename));

    // Verify resolved path is within blog dir
    if (!filePath.startsWith(blogDir + '/')) {
      res.status(400).json({ error: 'Invalid filename' });
      return;
    }

    let fileStats;
    try {
      fileStats = await stat(filePath);
    } catch {
      res.status(404).json({ error: 'Image not found' });
      return;
    }

    const ext = extname(filename).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', fileStats.size);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    const stream = createReadStream(filePath);
    stream.on('error', () => {
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
