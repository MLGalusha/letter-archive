import { and, eq, lt, or, sql, gte } from 'drizzle-orm';
import { db, letters, adminNotifications } from '../db/index.js';
import { notify } from './notifications.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger({ module: 'notification-sweeper' });

// ============================================================================
// Thresholds
// ============================================================================

/** A PENDING job older than this is considered stuck. */
const STUCK_JOB_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

/** Failure rate over the lookback window that triggers a high-failure-rate alert. */
const HIGH_FAILURE_RATE_THRESHOLD = 0.3; // 30%
const FAILURE_RATE_LOOKBACK_MS = 60 * 60 * 1000; // 1 hour
const FAILURE_RATE_MIN_SAMPLE = 5; // need at least 5 jobs to bother reporting a rate

/** How long the worker can go without RUNNING any job while PENDING exists before we alert. */
const WORKER_SILENT_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

/** Default sweeper interval. Overridable for tests. */
const DEFAULT_SWEEP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// ============================================================================
// Individual checks
// ============================================================================

/**
 * Detect letters whose job has been PENDING longer than STUCK_JOB_THRESHOLD_MS.
 * Uses `updatedAt` as the approximation for "when did this job last transition".
 */
export async function checkStuckJobs(now: Date = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - STUCK_JOB_THRESHOLD_MS);

  const stuck = await db
    .select({
      id: letters.id,
      transcriptionStatus: letters.transcriptionStatus,
      metadataStatus: letters.metadataStatus,
      entityExtractionStatus: letters.entityExtractionStatus,
      updatedAt: letters.updatedAt,
    })
    .from(letters)
    .where(
      and(
        lt(letters.updatedAt, cutoff),
        eq(letters.deadLetter, false),
        or(
          eq(letters.transcriptionStatus, 'PENDING'),
          eq(letters.metadataStatus, 'PENDING'),
          eq(letters.entityExtractionStatus, 'PENDING'),
        ),
      ),
    )
    .limit(200);

  if (stuck.length === 0) return;

  const ids = stuck.map((s) => s.id);
  log.warn({ count: stuck.length, ids: ids.slice(0, 10) }, 'Detected stuck jobs');

  void notify({
    type: 'sweeper_stuck_jobs',
    title: `${stuck.length} stuck job${stuck.length === 1 ? '' : 's'}`,
    message: `Job${stuck.length === 1 ? ' has' : 's have'} been PENDING for more than 2 hours.`,
    metadata: { count: stuck.length, ids: ids.slice(0, 20) },
    dedupeKey: 'sweeper_stuck_jobs',
    dedupeWindowMinutes: 60,
  });
}

/**
 * Check the failure rate for jobs in the last hour. Looks at admin notifications
 * of type *_failed vs *_success, since those are the canonical signal that a
 * pipeline stage actually ran to completion.
 */
export async function checkFailureRate(now: Date = new Date()): Promise<void> {
  const since = new Date(now.getTime() - FAILURE_RATE_LOOKBACK_MS);

  const rows = await db
    .select({
      type: adminNotifications.type,
      total: sql<number>`COUNT(*)::int`,
    })
    .from(adminNotifications)
    .where(gte(adminNotifications.createdAt, since))
    .groupBy(adminNotifications.type);

  let failed = 0;
  let succeeded = 0;
  for (const row of rows) {
    if (row.type.endsWith('_failed')) failed += Number(row.total);
    else if (row.type.endsWith('_success')) succeeded += Number(row.total);
  }
  const total = failed + succeeded;

  if (total < FAILURE_RATE_MIN_SAMPLE) return;

  const rate = failed / total;
  if (rate < HIGH_FAILURE_RATE_THRESHOLD) return;

  log.warn({ failed, succeeded, rate }, 'High failure rate detected');

  void notify({
    type: 'sweeper_high_failure_rate',
    title: `High failure rate: ${Math.round(rate * 100)}%`,
    message: `${failed} of ${total} pipeline jobs failed in the last hour.`,
    metadata: { failed, succeeded, total, rate },
    dedupeKey: 'sweeper_high_failure_rate',
    dedupeWindowMinutes: 60,
  });
}

/**
 * If jobs are PENDING but no letter has had its `updatedAt` touched recently,
 * the worker is probably silent. Fire a critical notification.
 */
export async function checkWorkerSilent(now: Date = new Date()): Promise<void> {
  const pendingCutoff = new Date(now.getTime() - WORKER_SILENT_THRESHOLD_MS);

  // Are there ANY PENDING jobs right now?
  const [pendingRow] = await db
    .select({ value: sql<number>`COUNT(*)::int` })
    .from(letters)
    .where(
      and(
        eq(letters.deadLetter, false),
        or(
          eq(letters.transcriptionStatus, 'PENDING'),
          eq(letters.metadataStatus, 'PENDING'),
          eq(letters.entityExtractionStatus, 'PENDING'),
        ),
      ),
    );

  const pendingCount = Number(pendingRow?.value ?? 0);
  if (pendingCount === 0) return;

  // Was ANY letter touched (updatedAt) in the silent window?
  const [recentRow] = await db
    .select({ value: sql<number>`COUNT(*)::int` })
    .from(letters)
    .where(gte(letters.updatedAt, pendingCutoff));

  const recentCount = Number(recentRow?.value ?? 0);
  if (recentCount > 0) return;

  log.error({ pendingCount }, 'Worker appears silent — pending jobs but no recent updates');

  void notify({
    type: 'system_worker_error',
    severity: 'critical',
    title: 'Worker appears silent',
    message: `${pendingCount} job${pendingCount === 1 ? '' : 's'} PENDING but no letter has been touched in the last ${WORKER_SILENT_THRESHOLD_MS / 60_000} minutes.`,
    metadata: { pendingCount, silenceWindowMinutes: WORKER_SILENT_THRESHOLD_MS / 60_000 },
    dedupeKey: 'worker_silent',
    dedupeWindowMinutes: 30,
  });
}

/**
 * Retention pass: delete notifications whose `expires_at` has passed (except
 * those explicitly archived — archival is the user's choice).
 */
export async function runRetentionSweep(): Promise<number> {
  const result = await db
    .delete(adminNotifications)
    .where(
      and(
        sql`${adminNotifications.expiresAt} IS NOT NULL`,
        sql`${adminNotifications.expiresAt} < now()`,
        or(
          eq(adminNotifications.status, 'open'),
          eq(adminNotifications.status, 'acknowledged'),
          eq(adminNotifications.status, 'resolved'),
        ),
      ),
    )
    .returning({ id: adminNotifications.id });

  if (result.length > 0) {
    log.info({ deleted: result.length }, 'Retention sweep deleted expired notifications');
  }
  return result.length;
}

// ============================================================================
// Full cycle + scheduler
// ============================================================================

/**
 * Run one full sweeper pass. Each check is independent — a failure in one
 * does NOT abort the others.
 */
export async function runSweeperCycle(now: Date = new Date()): Promise<void> {
  const checks = [
    { name: 'stuck_jobs', fn: () => checkStuckJobs(now) },
    { name: 'failure_rate', fn: () => checkFailureRate(now) },
    { name: 'worker_silent', fn: () => checkWorkerSilent(now) },
    { name: 'retention', fn: () => runRetentionSweep() },
  ];

  for (const check of checks) {
    try {
      await check.fn();
    } catch (err) {
      log.error({ err, check: check.name }, 'Sweeper check failed');
    }
  }
}

let sweeperInterval: NodeJS.Timeout | null = null;

/** Kick off the sweeper on a recurring interval. Call once on server startup. */
export function startNotificationSweeper(intervalMs: number = DEFAULT_SWEEP_INTERVAL_MS): void {
  if (sweeperInterval) {
    log.warn('Sweeper already running — ignoring start call');
    return;
  }
  log.info({ intervalMs }, 'Starting notification sweeper');

  // Run once on startup (after a small delay so the app finishes booting)
  setTimeout(() => {
    void runSweeperCycle();
  }, 10_000).unref();

  sweeperInterval = setInterval(() => {
    void runSweeperCycle();
  }, intervalMs);
  sweeperInterval.unref();
}

/** Stop the sweeper (for graceful shutdown / tests). */
export function stopNotificationSweeper(): void {
  if (sweeperInterval) {
    clearInterval(sweeperInterval);
    sweeperInterval = null;
  }
}
