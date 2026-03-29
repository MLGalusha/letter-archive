import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { env } from '../../config/env.js';
import { createLogger } from '../../utils/logger.js';

const router = Router();
const log = createLogger({ module: 'blog-images' });

const __dirname = dirname(fileURLToPath(import.meta.url));
const UPLOADS_TEMP_DIR = join(__dirname, '..', '..', '..', 'uploads');

// Blog images are stored under storage/blog/
function getBlogImageDir(): string {
  return join(env.STORAGE_DIR, 'blog');
}

const upload = multer({
  dest: UPLOADS_TEMP_DIR,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type: ${file.mimetype}. Only images are allowed.`));
    }
  },
});

/**
 * POST /admin/blog/images - Upload an image for use in journal posts
 * Returns { url: string } with the serving URL
 */
router.post('/blog/images', upload.single('file'), async (req, res, next) => {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'No file provided' });
      return;
    }

    const ext = extname(file.originalname).toLowerCase() || '.jpg';
    const filename = `${randomUUID()}${ext}`;
    const blogDir = getBlogImageDir();

    // Ensure blog image directory exists
    await mkdir(blogDir, { recursive: true });

    // Move file from temp to blog storage
    const destPath = join(blogDir, filename);
    const { rename } = await import('node:fs/promises');
    await rename(file.path, destPath);

    const url = `/blog-images/${filename}`;
    log.info({ filename, originalName: file.originalname, size: file.size }, 'Blog image uploaded');

    res.json({ url });
  } catch (error) {
    next(error);
  }
});

export default router;
