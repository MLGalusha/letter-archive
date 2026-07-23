import { Router } from 'express';
import { z } from 'zod';

const router = Router();

export const IMAGE_PERF_BATCH_LIMIT = 20;

const imagePerfEntrySchema = z.object({
  url: z.string().min(1).max(1024),
  tier: z.enum(['thumb', 'mid', 'full']),
  context: z.string().trim().min(1).max(64),
  durationMs: z.number().finite().min(0).max(300_000),
  cached: z.boolean(),
}).strict();

const imagePerfBatchSchema = z
  .array(imagePerfEntrySchema)
  .min(1)
  .max(IMAGE_PERF_BATCH_LIMIT);

/**
 * POST /images/perf - Receive a bounded batch of frontend image-load telemetry.
 */
router.post('/images/perf', (req, res) => {
  const result = imagePerfBatchSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: 'Invalid image performance report' });
    return;
  }

  const entries = result.data.map((entry) => ({
    ...entry,
    url: sanitizeImageTelemetryUrl(entry.url),
  }));

  // One bounded log record per request prevents a batch from multiplying into
  // dozens of independent log entries.
  req.log.info(
    {
      entryCount: entries.length,
      entries,
    },
    'client image load batch',
  );

  res.status(204).end();
});

export function sanitizeImageTelemetryUrl(value: string): string {
  return value.split(/[?#]/, 1)[0];
}

export default router;
