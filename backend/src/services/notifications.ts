import { and, eq, gte, sql } from 'drizzle-orm';
import { db, adminNotifications } from '../db/index.js';
import type { InferSelectModel } from 'drizzle-orm';
import { createLogger } from '../utils/logger.js';

const log = createLogger({ module: 'notifications' });

// ============================================================================
// Canonical notification types
// ============================================================================

/**
 * Every notification fired in the codebase MUST use one of these canonical types.
 * Adding a new type? Add it here and to the frontend type registry.
 */
export const NOTIFICATION_TYPES = [
  // Uploads
  'upload_success',
  'upload_failed',
  // Transcription
  'transcription_success',
  'transcription_failed',
  // Metadata
  'metadata_success',
  'metadata_failed',
  // Entity extraction
  'entity_success',
  'entity_failed',
  // Extra content transcription
  'extra_content_failed',
  // Batch processing
  'batch_started',
  'batch_complete',
  // Job lifecycle
  'job_max_retries',
  'job_orphan_recovered',
  // External APIs
  'api_error',
  'api_quota',
  // Queue control
  'queue_paused',
  'queue_resumed',
  // Collection profiles
  'collection_profile_started',
  'collection_profile_complete',
  'collection_profile_failed',
  // Admin / auth
  'admin_joined',
  'admin_login_failed',
  // AI notes
  'ai_notes_high_priority',
  // Boot / system
  'migrations_pending',
  'stub_mode_active',
  'system_worker_started',
  'system_worker_error',
  // Sweeper / health detector
  'sweeper_stuck_jobs',
  'sweeper_high_failure_rate',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export type NotificationSeverity = 'info' | 'warn' | 'error' | 'critical';
export type NotificationStatus = 'open' | 'acknowledged' | 'resolved' | 'archived';
export type NotificationSourceType = 'letter' | 'collection' | 'job' | 'admin' | 'system';

export type AdminNotification = InferSelectModel<typeof adminNotifications>;

// ============================================================================
// Defaults
// ============================================================================

/** Default severity for each canonical type. Override per-call when needed. */
const DEFAULT_SEVERITY: Record<NotificationType, NotificationSeverity> = {
  upload_success: 'info',
  upload_failed: 'error',
  transcription_success: 'info',
  transcription_failed: 'error',
  metadata_success: 'info',
  metadata_failed: 'error',
  entity_success: 'info',
  entity_failed: 'warn',
  extra_content_failed: 'error',
  batch_started: 'info',
  batch_complete: 'info',
  job_max_retries: 'critical',
  job_orphan_recovered: 'warn',
  api_error: 'error',
  api_quota: 'critical',
  queue_paused: 'warn',
  queue_resumed: 'info',
  collection_profile_started: 'info',
  collection_profile_complete: 'info',
  collection_profile_failed: 'error',
  admin_joined: 'info',
  admin_login_failed: 'warn',
  ai_notes_high_priority: 'warn',
  migrations_pending: 'critical',
  stub_mode_active: 'warn',
  system_worker_started: 'info',
  system_worker_error: 'critical',
  sweeper_stuck_jobs: 'warn',
  sweeper_high_failure_rate: 'error',
};

/** Default expiration in days by severity. `null` = never auto-expire. */
const DEFAULT_EXPIRY_DAYS: Record<NotificationSeverity, number | null> = {
  info: 90,
  warn: 90,
  error: 180,
  critical: null,
};

// ============================================================================
// SSE broadcast hook (wired in Phase 3)
// ============================================================================

type BroadcastFn = (notification: AdminNotification) => void;
let broadcastHook: BroadcastFn | null = null;

/** Phase 3 wires the SSE stream broadcaster here. No-op until then. */
export function registerNotificationBroadcaster(fn: BroadcastFn | null): void {
  broadcastHook = fn;
}

// ============================================================================
// notify() — the only function callers should use
// ============================================================================

export interface NotifyInput {
  type: NotificationType;
  title: string;
  message?: string | null;
  link?: string | null;
  severity?: NotificationSeverity;
  sourceType?: NotificationSourceType;
  sourceId?: string;
  metadata?: Record<string, unknown>;
  /** If set, an existing open notification with the same key inside the dedupe window is updated instead of inserting a new row. */
  dedupeKey?: string;
  /** Window for dedupe matching, in minutes. Defaults to 60. */
  dedupeWindowMinutes?: number;
  /** Override the default expiry. Pass `null` to disable expiry. */
  expiresInDays?: number | null;
}

/**
 * Create (or dedupe) an admin notification. Fire-and-forget — never let
 * notification creation break the main flow. Returns the notification row,
 * or `null` on failure.
 */
export async function notify(input: NotifyInput): Promise<AdminNotification | null> {
  try {
    const severity = input.severity ?? DEFAULT_SEVERITY[input.type];
    const expiresInDays =
      input.expiresInDays === undefined ? DEFAULT_EXPIRY_DAYS[severity] : input.expiresInDays;
    const expiresAt =
      expiresInDays === null ? null : new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

    // Dedupe path: if an open notification with this key exists in the window, bump it
    if (input.dedupeKey) {
      const windowMinutes = input.dedupeWindowMinutes ?? 60;
      const since = new Date(Date.now() - windowMinutes * 60 * 1000);

      const existing = await db
        .select()
        .from(adminNotifications)
        .where(
          and(
            eq(adminNotifications.dedupeKey, input.dedupeKey),
            eq(adminNotifications.status, 'open'),
            gte(adminNotifications.lastOccurredAt, since),
          ),
        )
        .limit(1);

      if (existing[0]) {
        const [updated] = await db
          .update(adminNotifications)
          .set({
            dedupeCount: sql`${adminNotifications.dedupeCount} + 1`,
            lastOccurredAt: new Date(),
            // Refresh message/metadata so the latest occurrence's context wins
            message: input.message ?? existing[0].message,
            metadata: input.metadata ?? existing[0].metadata,
            // Bump severity if the new one is higher
            severity: severityRank(severity) > severityRank(existing[0].severity as NotificationSeverity)
              ? severity
              : (existing[0].severity as NotificationSeverity),
            // Mark as unread again so it re-surfaces in the bell
            read: false,
          })
          .where(eq(adminNotifications.id, existing[0].id))
          .returning();

        if (updated && broadcastHook) broadcastHook(updated);
        return updated ?? null;
      }
    }

    const [inserted] = await db
      .insert(adminNotifications)
      .values({
        type: input.type,
        severity,
        status: 'open',
        title: input.title,
        message: input.message ?? null,
        link: input.link ?? null,
        sourceType: input.sourceType ?? null,
        sourceId: input.sourceId ?? null,
        metadata: input.metadata ?? null,
        dedupeKey: input.dedupeKey ?? null,
        dedupeCount: 1,
        lastOccurredAt: new Date(),
        expiresAt,
      })
      .returning();

    if (inserted && broadcastHook) broadcastHook(inserted);
    return inserted ?? null;
  } catch (err) {
    log.error({ err, type: input.type, title: input.title }, 'Failed to create notification');
    return null;
  }
}

/**
 * Helper for AI/external API errors. Classifies the error (quota/rate-limit
 * vs generic 5xx) and dedupes by service+endpoint so a burst of failures
 * collapses into one notification with a count.
 */
export function notifyApiError(params: {
  service: string; // 'openai' | 'gemini' | etc.
  endpoint: string; // 'transcription' | 'metadata_extraction' | etc.
  error: unknown;
  letterId?: string;
}): void {
  const message = params.error instanceof Error ? params.error.message : String(params.error);
  const status =
    typeof params.error === 'object' && params.error !== null && 'status' in params.error
      ? Number((params.error as { status: unknown }).status)
      : undefined;

  const isQuotaOrRateLimit = status === 429 || /quota|rate.?limit/i.test(message);

  void notify({
    type: isQuotaOrRateLimit ? 'api_quota' : 'api_error',
    title: isQuotaOrRateLimit
      ? `${params.service} rate limit / quota hit`
      : `${params.service} API error`,
    message: `${params.endpoint}: ${message}`,
    sourceType: params.letterId ? 'letter' : 'system',
    sourceId: params.letterId,
    metadata: { service: params.service, endpoint: params.endpoint, status, error: message },
    dedupeKey: `${isQuotaOrRateLimit ? 'api_quota' : 'api_error'}:${params.service}:${params.endpoint}`,
    dedupeWindowMinutes: 30,
  });
}

function severityRank(s: NotificationSeverity): number {
  switch (s) {
    case 'info':
      return 0;
    case 'warn':
      return 1;
    case 'error':
      return 2;
    case 'critical':
      return 3;
  }
}

// ============================================================================
// Legacy shim — kept temporarily so unmigrated callers don't break.
// Remove after all call sites use notify() directly.
// ============================================================================

interface CreateNotificationParams {
  type: string;
  title: string;
  message?: string;
  link?: string;
}

/** @deprecated Use `notify()` with a canonical NotificationType instead. */
export async function createNotification(params: CreateNotificationParams): Promise<void> {
  // Best-effort map legacy types to canonical types
  const legacyMap: Record<string, NotificationType> = {
    upload: 'upload_success',
    transcription: 'transcription_success',
    metadata: 'metadata_success',
    entity: 'entity_success',
    batch: 'batch_complete',
    error: 'transcription_failed',
    admin: 'admin_joined',
    system: 'ai_notes_high_priority',
  };
  const canonical = legacyMap[params.type] ?? 'system_worker_error';
  await notify({
    type: canonical,
    title: params.title,
    message: params.message,
    link: params.link,
  });
}
