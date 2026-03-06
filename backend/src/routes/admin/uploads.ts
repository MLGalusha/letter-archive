import { Router } from 'express';
import multer from 'multer';
import { unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { processUploadedFile } from '../../services/upload.js';
import { parseFilename } from '../../services/filename-parser.js';
import { buildStoragePath, fileExists } from '../../services/storage.js';

const router = Router();

// Resolve uploads temp dir relative to the backend project root (not process.cwd())
const __dirname = dirname(fileURLToPath(import.meta.url));
const UPLOADS_TEMP_DIR = join(__dirname, '..', '..', '..', 'uploads');

// Configure multer for file uploads
const upload = multer({
  dest: UPLOADS_TEMP_DIR,
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
 * POST /admin/uploads/check-duplicates - Check which filenames already exist in storage
 *
 * Accepts JSON body: { filenames: string[] }
 * Returns: { duplicates: Record<string, boolean> }
 */
router.post('/uploads/check-duplicates', async (req, res, next) => {
  try {
    const { filenames } = req.body as { filenames?: string[] };

    if (!filenames || !Array.isArray(filenames)) {
      res.status(400).json({ error: 'filenames must be an array of strings' });
      return;
    }

    const duplicates: Record<string, boolean> = {};

    for (const filename of filenames) {
      const parsed = parseFilename(filename);
      if (!parsed) {
        duplicates[filename] = false;
        continue;
      }

      const storagePath = buildStoragePath(
        parsed.collectionCode,
        parsed.dateRaw,
        parsed.type,
        parsed.typeSequence,
        filename
      );

      duplicates[filename] = await fileExists(storagePath);
    }

    res.json({ duplicates });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/uploads - Upload letter images
 *
 * Accepts multipart/form-data with files field.
 * Each file is parsed, stored, and recorded in the database.
 * L-type letters are automatically queued for processing.
 *
 * Query params:
 *   force=true - Overwrite existing files instead of skipping
 */
router.post('/uploads', upload.array('files', 500), async (req, res, next) => {
  const files = req.files as Express.Multer.File[] | undefined;
  const force = req.query.force === 'true';

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
      const result = await processUploadedFile(file.path, file.originalname, force);

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
