import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { eq } from 'drizzle-orm';
import routes from './routes/index.js';
import { errorHandler } from './middleware/error-handler.js';
import { requestLogger } from './middleware/request-logger.js';
import { env, hasOpenAI } from './config/env.js';
import { logger, LOG_DIR, getLogRetentionHours } from './utils/logger.js';
import { securityHeaders } from './middleware/security.js';
import { recoverOrphanedJobs } from './services/processing-queue.js';
import { db, sql, adminUsers } from './db/index.js';
import { hashPassword } from './auth/jwt.js';

/* ── Process-level error monitoring ─────────────────────── */
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'UNCAUGHT EXCEPTION');
});
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'UNHANDLED REJECTION');
});

const app = express();

/* ── Request flight tracking ────────────────────────────── */
let totalRequests = 0;
let inFlight = 0;
let peakInFlight = 0;

app.use((_req, _res, next) => {
  totalRequests++;
  inFlight++;
  if (inFlight > peakInFlight) peakInFlight = inFlight;
  const onComplete = () => {
    inFlight--;
    _res.removeListener('finish', onComplete);
    _res.removeListener('close', onComplete);
  };
  _res.on('finish', onComplete);
  _res.on('close', onComplete);
  next();
});

/* ── Health / debug endpoint (no auth) ──────────────────── */
app.get('/debug/health', async (_req, res) => {
  const mem = process.memoryUsage();
  let pgStat: Record<string, unknown> = {};
  try {
    const [row] = await sql`SELECT numbackends, xact_commit, xact_rollback, blks_hit, blks_read, tup_returned, tup_fetched FROM pg_stat_database WHERE datname = current_database()`;
    pgStat = row ?? {};
  } catch (e) {
    pgStat = { error: String(e) };
  }
  res.json({
    uptime: process.uptime(),
    requests: { total: totalRequests, inFlight, peakInFlight },
    memory: {
      rss: `${(mem.rss / 1024 / 1024).toFixed(1)} MB`,
      heapUsed: `${(mem.heapUsed / 1024 / 1024).toFixed(1)} MB`,
      heapTotal: `${(mem.heapTotal / 1024 / 1024).toFixed(1)} MB`,
      external: `${(mem.external / 1024 / 1024).toFixed(1)} MB`,
    },
    pg: pgStat,
  });
});

app.set('trust proxy', 1);
app.disable('x-powered-by');

// Request logging (must be first to capture all requests)
app.use(requestLogger);

// Rate limiting
import { globalRateLimit } from './middleware/rate-limit.js';
app.use(globalRateLimit);
app.use(securityHeaders);

// Middleware
const corsOrigins = env.CORS_ORIGINS
  ? env.CORS_ORIGINS.split(',').map(s => s.trim())
  : ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:3000', 'http://localhost:3002'];
app.use(
  cors({
    origin: corsOrigins,
    credentials: true,
  })
);

// Parse JSON bodies, but skip for multipart/form-data (file uploads)
app.use((req, res, next) => {
  const contentType = req.headers['content-type'] || '';
  if (contentType.includes('multipart/form-data')) {
    return next();
  }
  return express.json()(req, res, next);
});

// Routes
app.use(routes);

// Error handling (must be last)
app.use(errorHandler);

// Start server
const server = app.listen(env.PORT, () => {
  logger.info(
    {
      port: env.PORT,
      openai: hasOpenAI ? 'enabled' : 'stub mode',
      storageDir: env.STORAGE_DIR,
      logDir: LOG_DIR,
      logRetentionHours: getLogRetentionHours(),
    },
    'Server started'
  );

  // Recover any jobs left in RUNNING state from a previous crash/restart
  recoverOrphanedJobs().catch(err => {
    logger.error({ err }, 'Failed to recover orphaned jobs');
  });

  // Seed a dev admin only when explicitly requested.
  if (env.SEED_DEV_ADMIN) {
    const DEV_EMAIL = 'dev@localhost.test';
    const DEV_PASSWORD = 'dev';
    db.select().from(adminUsers).where(eq(adminUsers.email, DEV_EMAIL)).limit(1)
      .then(async ([existing]) => {
        if (!existing) {
          const passwordHash = await hashPassword(DEV_PASSWORD);
          await db.insert(adminUsers).values({ email: DEV_EMAIL, passwordHash });
          logger.info({ email: DEV_EMAIL }, 'Dev admin account seeded');
        }
      })
      .catch(err => {
        logger.error({ err }, 'Failed to seed dev admin');
      });
  }
});

/* ── Graceful shutdown (Cloud Run sends SIGTERM, gives 10s) ── */
let shuttingDown = false;

function gracefulShutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Graceful shutdown initiated');

  // Stop accepting new connections and drain in-flight requests
  server.close(() => {
    logger.info('All connections drained, exiting');
    process.exit(0);
  });

  // Force exit after 8s (Cloud Run gives 10s, leave buffer)
  setTimeout(() => {
    logger.warn({ inFlight }, 'Forced shutdown after timeout');
    process.exit(1);
  }, 8_000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
