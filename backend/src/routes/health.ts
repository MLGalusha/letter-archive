import { Router } from 'express';
import { sql } from '../db/index.js';

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
  try {
    const [row] = await sql`SELECT 1 AS ok`;
    if (row?.ok === 1) {
      res.json({ ok: true, db: 'connected' });
    } else {
      res.status(503).json({ ok: false, db: 'unexpected response' });
    }
  } catch (err) {
    req.log?.error({ err }, 'Database readiness check failed');
    res.status(503).json({ ok: false, db: 'disconnected' });
  }
});

export default router;
