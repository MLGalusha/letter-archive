import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { eq } from 'drizzle-orm';
import routes from './routes/index.js';
import { errorHandler } from './middleware/error-handler.js';
import { requestLogger } from './middleware/request-logger.js';
import { env, hasOpenAI } from './config/env.js';
import { logger, LOG_DIR, getLogRetentionHours } from './utils/logger.js';
import { recoverOrphanedJobs } from './services/processing-queue.js';
import { db, adminUsers } from './db/index.js';
import { hashPassword } from './auth/jwt.js';

const app = express();

// Request logging (must be first to capture all requests)
app.use(requestLogger);

// Rate limiting
import { globalRateLimit } from './middleware/rate-limit.js';
app.use(globalRateLimit);

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
app.listen(env.PORT, () => {
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

  // Seed dev admin account in non-production environments
  if (process.env.NODE_ENV !== 'production') {
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
