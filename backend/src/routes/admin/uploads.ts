import { Router } from 'express';
import multer from 'multer';
import { unlink } from 'node:fs/promises';
import { processUploadedFile } from '../../services/upload.js';

const router = Router();

// Configure multer for file uploads
const upload = multer({
  dest: 'uploads/',
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max file size
  },
  fileFilter: (_req, file, cb) => {
    // Accept only image files
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type: ${file.mimetype}. Only images are allowed.`));
    }
  },
});

/**
 * POST /admin/uploads - Upload letter images
 *
 * Accepts multipart/form-data with files field.
 * Each file is parsed, stored, and recorded in the database.
 * L-type letters are automatically queued for processing.
 */
router.post('/uploads', upload.array('files', 100), async (req, res, next) => {
  const files = req.files as Express.Multer.File[] | undefined;

  if (!files || files.length === 0) {
    res.status(400).json({ error: 'No files uploaded' });
    return;
  }

  const results: Array<{
    filename: string;
    letterId: string;
    pageId: string;
    collectionCode: string;
    storagePath: string;
    alreadyExists: boolean;
  }> = [];

  const errors: Array<{
    filename: string;
    error: string;
  }> = [];

  for (const file of files) {
    try {
      const result = await processUploadedFile(file.path, file.originalname);

      results.push({
        filename: file.originalname,
        letterId: result.letter.id,
        pageId: result.page.id,
        collectionCode: result.collection.collectionCode,
        storagePath: result.storagePath,
        alreadyExists: result.alreadyExists,
      });
    } catch (error) {
      errors.push({
        filename: file.originalname,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      // Clean up temp file
      await unlink(file.path).catch(() => {
        // Ignore cleanup errors
      });
    }
  }

  res.json({
    success: results.length,
    failed: errors.length,
    results,
    errors: errors.length > 0 ? errors : undefined,
  });
});

export default router;
