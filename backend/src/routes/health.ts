import { Router } from 'express';
import { sql } from '../db/index.js';

const router = Router();

// Liveness probe — always returns ok if the process is running.
// Used by Cloud Run startupProbe / livenessProbe.
router.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// Readiness probe — validates database connectivity.
// Useful for deployment checks and monitoring dashboards.
router.get('/health/ready', async (_req, res) => {
  try {
    const [row] = await sql`SELECT 1 AS ok`;
    if (row?.ok === 1) {
      res.json({ ok: true, db: 'connected' });
    } else {
      res.status(503).json({ ok: false, db: 'unexpected response' });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(503).json({ ok: false, db: 'disconnected', error: message });
  }
});

export default router;
