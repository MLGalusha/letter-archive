import { Router } from 'express';
import { sql } from '../db/index.js';
import { startupTiming } from '../utils/startup-timing.js';

const router = Router();

// Liveness probe — always returns ok if the process is running.
// Used by Cloud Run startupProbe / livenessProbe.
router.get('/health', (_req, res) => {
  res.json({
    ok: true,
    releaseSha: process.env.RELEASE_SHA ?? 'development',
  });
});

// Readiness probe — validates database connectivity.
// Useful for deployment checks and monitoring dashboards.
router.get('/health/ready', async (req, res) => {
  const finishTiming = startupTiming.startReadinessAttempt();
  const recordTiming = (outcome: 'connected' | 'unexpected-response' | 'disconnected') => {
    const timing = finishTiming(outcome);
    if (timing) req.log?.info(timing, 'Startup readiness measured');
  };
  try {
    const [row] = await sql`SELECT 1 AS ok`;
    if (row?.ok === 1) {
      recordTiming('connected');
      res.json({ ok: true, db: 'connected' });
    } else {
      recordTiming('unexpected-response');
      res.status(503).json({ ok: false, db: 'unexpected response' });
    }
  } catch (err) {
    recordTiming('disconnected');
    req.log?.error({ err }, 'Database readiness check failed');
    res.status(503).json({ ok: false, db: 'disconnected' });
  }
});

export default router;
