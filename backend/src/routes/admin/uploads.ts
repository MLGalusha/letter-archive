import { Router } from 'express';
import multer from 'multer';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { processUploadedFile } from '../../services/upload.js';
import { parseFilename } from '../../services/filename-parser.js';
import {
  findObservedPageSourcesByIdentity,
  uploadPageIdentityKey,
  type UploadPageIdentity,
  type UploadSourceExpectation,
} from '../../services/letter-pages.js';
import { db, siteSettings } from '../../db/index.js';
import { ensureBackgroundWorkerForQueuedProcessing } from '../../services/processing-queue.js';
import { createLogger } from '../../utils/logger.js';
import { notify } from '../../services/notifications.js';
import { SourceRevisionChangedError } from '../../services/letter/source-revision.js';

const router = Router();
const log = createLogger({ module: 'uploads' });

const uploadSourceExpectationSchema = z.object({
  pageId: z.string().min(1),
  primarySourceRevision: z.number().int().nonnegative(),
  storagePath: z.string().min(1),
  checksumSha256: z.string().nullable(),
}).strict();
const uploadSourceExpectationsSchema = z.record(
  z.string(),
  uploadSourceExpectationSchema,
);

async function cleanupTempFiles(files: Express.Multer.File[]): Promise<void> {
  await Promise.all(
    files.map((file) => unlink(file.path).catch(() => undefined)),
  );
}

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
 * Returns the duplicate flag and exact committed-source expectation per file.
 */
router.post('/uploads/check-duplicates', async (req, res, next) => {
  try {
    const { filenames } = req.body as { filenames?: string[] };

    if (!filenames || !Array.isArray(filenames)) {
      res.status(400).json({ error: 'filenames must be an array of strings' });
      return;
    }

    const parsedByFilename = new Map<string, UploadPageIdentity>();
    for (const filename of filenames) {
      const parsed = parseFilename(filename);
      if (parsed) parsedByFilename.set(filename, parsed);
    }
    const observed = await findObservedPageSourcesByIdentity(
      [...parsedByFilename.values()],
    );
    const duplicates = Object.fromEntries(filenames.map((filename) => {
      const identity = parsedByFilename.get(filename);
      return [
        filename,
        identity ? observed.has(uploadPageIdentityKey(identity)) : false,
      ];
    }));
    const sourceExpectations = Object.fromEntries(filenames.map((filename) => {
      const identity = parsedByFilename.get(filename);
      return [
        filename,
        identity
          ? observed.get(uploadPageIdentityKey(identity)) ?? null
          : null,
      ];
    }));

    res.json({ duplicates, sourceExpectations });
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

  if (force && files.length !== 1) {
    await cleanupTempFiles(files);
    res.status(400).json({
      error: 'Force replacement accepts exactly one file per request',
    });
    return;
  }

  let sourceExpectations: Record<string, UploadSourceExpectation> = {};
  if (force) {
    let rawExpectations: unknown;
    try {
      rawExpectations = typeof req.body?.sourceExpectations === 'string'
        ? JSON.parse(req.body.sourceExpectations)
        : req.body?.sourceExpectations;
    } catch {
      rawExpectations = undefined;
    }
    const parsedExpectations = uploadSourceExpectationsSchema.safeParse(
      rawExpectations,
    );
    const missingExpectation = parsedExpectations.success
      ? files.find((file) => !parsedExpectations.data[file.originalname])
      : files[0];
    if (!parsedExpectations.success || missingExpectation) {
      await cleanupTempFiles(files);
      res.status(400).json({
        error: missingExpectation
          ? `Force replacement requires a duplicate-check source expectation for ${missingExpectation.originalname}`
          : 'Force replacement requires valid duplicate-check source expectations',
      });
      return;
    }
    sourceExpectations = parsedExpectations.data;
  }

  const results: Array<{
    filename: string;
    letterId: string;
    pageId: string;
    collectionCode: string;
    storagePath: string;
    primarySourceRevision: number;
    alreadyExists: boolean;
    outcome: 'created' | 'replaced' | 'unchanged';
    changed: boolean;
  }> = [];

  const errors: Array<{
    filename: string;
    error: string;
    code?: string;
  }> = [];

  for (const file of files) {
    try {
      const result = await processUploadedFile(
        file.path,
        file.originalname,
        force,
        force ? sourceExpectations[file.originalname] : undefined,
      );

      results.push({
        filename: file.originalname,
        letterId: result.letter.id,
        pageId: result.page.id,
        collectionCode: result.collection.collectionCode,
        storagePath: result.storagePath,
        primarySourceRevision: result.primarySourceRevision,
        alreadyExists: result.alreadyExists,
        outcome: result.outcome,
        changed: result.changed,
      });
    } catch (error) {
      if (files.length === 1 && error instanceof SourceRevisionChangedError) {
        next(error);
        return;
      }
      errors.push({
        filename: file.originalname,
        error: error instanceof Error ? error.message : 'Unknown error',
        ...(error instanceof SourceRevisionChangedError
          ? { code: error.code }
          : {}),
      });
    } finally {
      // Clean up temp file
      await unlink(file.path).catch(() => {
        // Ignore cleanup errors
      });
    }
  }

  const changedResults = results.filter((result) => result.changed);
  const createdCount = results.filter((result) => result.outcome === 'created').length;
  const replacedCount = results.filter((result) => result.outcome === 'replaced').length;
  const unchangedCount = results.filter((result) => result.outcome === 'unchanged').length;
  const summary = {
    accepted: results.length,
    failed: errors.length,
    changed: changedResults.length,
    unchanged: unchangedCount,
    created: createdCount,
    replaced: replacedCount,
    affectedLetters: new Set(changedResults.map((result) => result.letterId)).size,
  };

  res.json({
    success: results.length,
    failed: errors.length,
    results,
    errors: errors.length > 0 ? errors : undefined,
    summary,
  });

  // Fire-and-forget: upload notification
  if (changedResults.length > 0) {
    const collectionCodes = [...new Set(changedResults.map(r => r.collectionCode))];
    void notify({
      type: 'upload_success',
      title: 'Letter pages updated',
      message: `${changedResults.length} page${changedResults.length === 1 ? '' : 's'} updated in ${collectionCodes.join(', ')}`,
      link: '/admin',
      sourceType: 'collection',
      metadata: {
        count: results.length,
        changedCount: changedResults.length,
        unchangedCount,
        createdCount,
        replacedCount,
        affectedLetterCount: summary.affectedLetters,
        collectionCodes,
        failedCount: errors.length,
      },
    });
  }

  // Fire-and-forget: auto-transcribe if the setting is enabled
  if (changedResults.length > 0) {
    try {
      const [row] = await db
        .select()
        .from(siteSettings)
        .where(eq(siteSettings.key, 'auto_transcribe'))
        .limit(1);

      if (row?.value === 'true') {
        log.info(
          { changedCount: changedResults.length },
          'Automatic processing enabled, waking worker',
        );
        ensureBackgroundWorkerForQueuedProcessing('upload').catch(err => {
          log.error({ err }, 'Automatic processing failed to start');
        });
      }
    } catch (err) {
      log.error({ err }, 'Failed to check auto_transcribe setting');
    }
  }
});

export default router;
