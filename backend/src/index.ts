import 'dotenv/config';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import express from 'express';
import compression from 'compression';
import cors from 'cors';
import { eq } from 'drizzle-orm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import routes from './routes/index.js';
import { errorHandler } from './middleware/error-handler.js';
import { requestLogger } from './middleware/request-logger.js';
import { env, hasOpenAI } from './config/env.js';
import { logger, LOG_DIR, getLogRetentionHours } from './utils/logger.js';
import { securityHeaders } from './middleware/security.js';
import { recoverOrphanedJobs } from './services/processing-queue.js';
import { db, sql, adminUsers } from './db/index.js';
import { hashPassword } from './auth/jwt.js';
import { notify } from './services/notifications.js';
import { startNotificationSweeper, stopNotificationSweeper } from './services/notification-sweeper.js';
import { initNotificationStreamBroadcaster } from './routes/admin/notifications-stream.js';
import { initProcessingStreamBroadcaster } from './routes/admin/processing-stream.js';

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

// Compress JSON/text responses (skip images — already optimized by sharp)
app.use(compression({
  filter: (req, res) => {
    if (req.path.startsWith('/images/') || req.path.startsWith('/blog-images/')) return false;
    return compression.filter(req, res);
  },
}));

// Request logging (must be first to capture all requests)
app.use(requestLogger);

// Rate limiting
import { globalRateLimit } from './middleware/rate-limit.js';
app.use(globalRateLimit);
app.use(securityHeaders);

// Middleware
const isProd = process.env.NODE_ENV === 'production';
const explicitCorsOrigins = env.CORS_ORIGINS
  ? env.CORS_ORIGINS.split(',').map(s => s.trim())
  : ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:3000', 'http://localhost:3002'];

// In dev, also accept requests from any private-network origin (e.g. a phone
// on the same Wi-Fi hitting the vite --host LAN URL).
const privateNetworkOriginPattern = /^https?:\/\/(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/;

app.use(
  cors({
    origin(origin, callback) {
      // Same-origin / curl / server-to-server requests have no Origin header.
      if (!origin) return callback(null, true);
      if (explicitCorsOrigins.includes(origin)) return callback(null, true);
      if (!isProd && privateNetworkOriginPattern.test(origin)) {
        return callback(null, true);
      }
      // Reject without throwing: returning `false` tells the cors middleware
      // to omit CORS headers, so the browser blocks the request naturally.
      // Throwing here would route through the global error handler and
      // surface as a 500, polluting error logs for expected denials.
      logger.warn({ origin }, 'CORS: origin not allowed');
      return callback(null, false);
    },
    credentials: true,
  })
);

// Parse JSON bodies, but skip for multipart/form-data (file uploads)
app.use((req, res, next) => {
  const contentType = req.headers['content-type'] || '';
  if (contentType.includes('multipart/form-data')) {
    return next();
  }
  return express.json({ limit: '5mb' })(req, res, next);
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

  // Attempt startup recovery for RUNNING candidates. This is not lease-aware
  // and cannot prove that an observed owner is no longer live.
  recoverOrphanedJobs().catch(err => {
    logger.error({ err }, 'Failed to run startup job recovery');
  });

  // Wire the SSE broadcaster into notify() so every notification pushes to connected clients
  initNotificationStreamBroadcaster();
  initProcessingStreamBroadcaster();

  // Start the notification sweeper (stuck jobs, failure rate, worker silence, retention)
  startNotificationSweeper();

  // Boot-time health notifications
  void runBootChecks();

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

/**
 * Fire boot-time notifications so admins are aware of mode/state issues
 * the moment they open the page after a restart.
 */
async function runBootChecks(): Promise<void> {
  if (!hasOpenAI) {
    void notify({
      type: 'stub_mode_active',
      title: 'Stub mode active',
      message: 'No OPENAI_API_KEY configured — AI calls return mocked responses.',
      dedupeKey: 'stub_mode_active',
      dedupeWindowMinutes: 1440,
      expiresInDays: 1,
    });
  }

  // Detect pending Drizzle migrations: compare on-disk journal vs DB tracking table.
  try {
    const [appliedRow] = await sql<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM drizzle.__drizzle_migrations
    `;
    const appliedCount = appliedRow?.count ?? 0;

    const journalPath = path.resolve(__dirname, '../src/db/migrations/meta/_journal.json');
    const journalRaw = await readFile(journalPath, 'utf8');
    const journal = JSON.parse(journalRaw) as { entries: unknown[] };
    const expectedCount = journal.entries.length;

    if (appliedCount < expectedCount) {
      void notify({
        type: 'migrations_pending',
        title: 'Pending database migrations',
        message: `${expectedCount - appliedCount} migration(s) on disk but not yet applied. Run \`npm run drizzle:migrate\`.`,
        metadata: { applied: appliedCount, expected: expectedCount },
        dedupeKey: 'migrations_pending',
      });
    }
  } catch (err) {
    // Silent: drizzle migrations table or journal file may not exist in some environments
    logger.debug({ err }, 'Could not check migration state');
  }
}

/* ── Graceful shutdown (Cloud Run sends SIGTERM, gives 10s) ── */
let shuttingDown = false;

function gracefulShutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Graceful shutdown initiated');

  stopNotificationSweeper();

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
