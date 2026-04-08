import { Router, type Request, type Response, type NextFunction } from 'express';
import { getProcess, orderedProcesses } from '../../../services/processes/registry.js';
import {
  getActiveBatch,
  startBatch,
  pauseBatch,
  resumeBatch,
  abortBatch,
  notifyQueueChanged,
} from '../../../services/processes/runner.js';
import {
  ProcessingError,
  type AllProcessesStatus,
  type ProcessStatus,
} from '../../../services/processes/types.js';
import { issueProcessingStreamToken } from '../processing-stream.js';

const router = Router();

// ============================================================================
// Helpers
// ============================================================================

function requireCapability(key: string, capability: keyof import('../../../services/processes/types.js').ProcessCapabilities) {
  const config = getProcess(key);
  if (!config.capabilities[capability]) {
    throw new ProcessingError(
      `Process ${key} does not support ${capability}`,
      405
    );
  }
  return config;
}

async function asyncHandler(
  fn: (req: Request, res: Response) => Promise<void>
): Promise<(req: Request, res: Response, next: NextFunction) => void> {
  return (req, res, next) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

// ============================================================================
// Error handling middleware: maps ProcessingError to its statusCode.
// ============================================================================

function handleProcessingError(err: unknown, res: Response): boolean {
  if (err instanceof ProcessingError) {
    res.status(err.statusCode).json({ error: err.message });
    return true;
  }
  return false;
}

function wrap(fn: (req: Request, res: Response) => Promise<void> | void) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (handleProcessingError(err, res)) return;
      next(err);
    }
  };
}

// ============================================================================
// GET /snapshot — full snapshot for the new processing page.
//
// NOTE: this is temporarily mounted as /snapshot (not /status) because the
// legacy /admin/processing/status route still exists and serves a different
// shape to AdminDashboard. Checkpoint E deletes the legacy route and this
// can be renamed back to /status.
// ============================================================================

router.get(
  '/snapshot',
  wrap(async (_req, res) => {
    const processes: ProcessStatus[] = [];
    for (const config of orderedProcesses()) {
      const [queued, active, recent, observed] = await Promise.all([
        config.getQueue(),
        config.getActiveJob(),
        config.getRecent(20),
        config.getObservedState?.() ?? Promise.resolve(undefined),
      ]);
      // Eligible count is filter-dependent; default to queue length for the
      // unfiltered case. The eligibility endpoint returns filtered counts.
      let eligibleCount = 0;
      try {
        // Cast — each config knows its own schema; empty object satisfies the
        // common "all optional" processingFilterSchema.
        eligibleCount = await config.getEligibleCount({} as never);
      } catch {
        eligibleCount = 0;
      }
      processes.push({
        key: config.key,
        label: config.label,
        description: config.description,
        order: config.order,
        group: config.group,
        capabilities: config.capabilities,
        eligibleCount,
        queued,
        active,
        recent,
        observed,
      });
    }

    const payload: AllProcessesStatus = {
      processes,
      activeBatch: getActiveBatch(),
    };
    res.json(payload);
  })
);

// ============================================================================
// Per-process eligibility / queue / recent
// ============================================================================

router.get(
  '/processes/:key/eligibility',
  wrap(async (req, res) => {
    const config = getProcess(String(req.params.key));
    const filters = config.filterSchema.parse(req.query);
    const count = await config.getEligibleCount(filters);
    res.json({ count });
  })
);

router.get(
  '/processes/:key/queue',
  wrap(async (req, res) => {
    const config = getProcess(String(req.params.key));
    const queue = await config.getQueue();
    res.json({ queue });
  })
);

router.get(
  '/processes/:key/recent',
  wrap(async (req, res) => {
    const config = getProcess(String(req.params.key));
    const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);
    const recent = await config.getRecent(limit);
    res.json({ recent });
  })
);

// ============================================================================
// Start a batch
// ============================================================================

router.post(
  '/processes/:key/start',
  wrap(async (req, res) => {
    const config = requireCapability(String(req.params.key), 'start');
    const filters = config.filterSchema.parse(req.body ?? {});
    const letterIds = await config.resolveEligibleLetterIds(filters);
    if (letterIds.length === 0) {
      res.json({ message: 'No letters match the current filters', total: 0 });
      return;
    }
    const state = startBatch({ config, letterIds });
    res.json({ message: 'Batch started', total: letterIds.length, batch: state });
  })
);

// ============================================================================
// Batch lifecycle — pause / resume / abort
// ============================================================================

router.post(
  '/batch/pause',
  wrap(async (_req, res) => {
    pauseBatch();
    res.json({ message: 'Batch paused' });
  })
);

router.post(
  '/batch/resume',
  wrap(async (_req, res) => {
    resumeBatch();
    res.json({ message: 'Batch resumed' });
  })
);

router.post(
  '/batch/abort',
  wrap(async (_req, res) => {
    abortBatch();
    res.json({ message: 'Batch abort requested' });
  })
);

// ============================================================================
// Per-item queue operations
// ============================================================================

router.post(
  '/processes/:key/queue/remove',
  wrap(async (req, res) => {
    const config = requireCapability(String(req.params.key), 'perItemRemove');
    const letterId = String(req.body?.letterId ?? '').trim();
    if (!letterId) throw new ProcessingError('letterId required', 400);
    await config.removeFromQueue!(letterId);
    notifyQueueChanged(config.key);
    res.json({ message: 'Removed from queue' });
  })
);

router.post(
  '/processes/:key/queue/clear',
  wrap(async (req, res) => {
    const config = requireCapability(String(req.params.key), 'clearQueue');
    const result = await config.clearQueue!();
    notifyQueueChanged(config.key);
    res.json({ message: `Cleared ${result.cleared} items`, ...result });
  })
);

router.post(
  '/processes/:key/queue/retry',
  wrap(async (req, res) => {
    const config = requireCapability(String(req.params.key), 'perItemRetry');
    const letterId = String(req.body?.letterId ?? '').trim();
    if (!letterId) throw new ProcessingError('letterId required', 400);
    await config.retry!(letterId);
    notifyQueueChanged(config.key);
    res.json({ message: 'Retry queued' });
  })
);

router.post(
  '/processes/:key/cancel',
  wrap(async (req, res) => {
    const config = requireCapability(String(req.params.key), 'perItemCancel');
    const letterId = String(req.body?.letterId ?? '').trim();
    if (!letterId) throw new ProcessingError('letterId required', 400);
    await config.cancelActive!(letterId);
    notifyQueueChanged(config.key);
    res.json({ message: 'Active job cancelled' });
  })
);

// ============================================================================
// Stream token (authenticated POST — the SSE endpoint is mounted elsewhere)
// ============================================================================

router.post('/stream-token', (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const { token, expiresAt } = issueProcessingStreamToken(
    req.user.userId,
    req.user.email
  );
  res.json({ token, expiresAt });
});

export default router;
