import type { Page } from '@playwright/test';
import { API_BASE_URL } from './test-helpers';

type ProcessKey =
  | 'transcription'
  | 'metadata'
  | 'entity_extraction'
  | 'background_worker';

interface QueuedItem {
  letterId: string;
  letterTitle: string;
  collectionCode: string;
  sender: string | null;
  recipient: string | null;
  queuedAt: string;
}

interface ActiveJob {
  letterId: string;
  letterTitle: string;
  collectionCode: string;
  sender: string | null;
  recipient: string | null;
  startedAt: string;
  progress: { step: number; totalSteps: number; stepLabel: string } | null;
}

interface RecentJob {
  letterId: string;
  letterTitle: string;
  collectionCode: string;
  status: 'SUCCESS' | 'FAILED' | 'CLEARED';
  error?: string;
  completedAt: string;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const DEFAULT_CAPS = {
  start: true,
  pauseResume: true,
  abort: true,
  perItemCancel: true,
  perItemRemove: true,
  perItemRetry: true,
  clearQueue: true,
  bulkRetryFailed: false,
  readOnly: false,
};

const WORKER_CAPS = {
  start: false,
  pauseResume: false,
  abort: false,
  perItemCancel: false,
  perItemRemove: false,
  perItemRetry: false,
  clearQueue: false,
  bulkRetryFailed: false,
  readOnly: true,
};

export function createMockProcessingState() {
  const transcriptionActive: ActiveJob = {
    letterId: 'letter-1',
    letterTitle: '19470810',
    collectionCode: '009',
    sender: 'Alice Smith',
    recipient: 'Bob Baker',
    startedAt: '2026-03-09T12:00:00.000Z',
    progress: { step: 1, totalSteps: 3, stepLabel: 'OCR' },
  };

  const transcriptionQueue: QueuedItem[] = [
    {
      letterId: 'letter-2',
      letterTitle: '19470811',
      collectionCode: '009',
      sender: 'Carol Clark',
      recipient: 'David Dunn',
      queuedAt: '2026-03-09T12:01:00.000Z',
    },
  ];

  const metadataQueue: QueuedItem[] = [
    {
      letterId: 'letter-3',
      letterTitle: '19470812',
      collectionCode: '009',
      sender: 'Ellen Gray',
      recipient: 'Frank Hale',
      queuedAt: '2026-03-09T12:02:00.000Z',
    },
  ];

  const recent: Record<ProcessKey, RecentJob[]> = {
    transcription: [
      {
        letterId: 'letter-5',
        letterTitle: '19470814',
        collectionCode: '009',
        status: 'SUCCESS',
        completedAt: '2026-03-09T12:04:00.000Z',
      },
    ],
    metadata: [
      {
        letterId: 'letter-4',
        letterTitle: '19470813',
        collectionCode: '009',
        status: 'FAILED',
        error: 'metadata offline',
        completedAt: '2026-03-09T12:03:00.000Z',
      },
    ],
    entity_extraction: [],
    background_worker: [],
  };

  return {
    transcriptionActive: transcriptionActive as ActiveJob | null,
    transcriptionQueue,
    metadataQueue,
    entityQueue: [] as QueuedItem[],
    recent,
    activeBatch: {
      processKey: 'transcription' as ProcessKey,
      total: 2,
      completed: 0,
      failed: 0,
      isPaused: false,
      shouldAbort: false,
      startedAt: '2026-03-09T12:00:00.000Z',
      lastProgressAt: '2026-03-09T12:00:00.000Z',
      currentJob: { letterId: 'letter-1' },
    },
  };
}

function buildSnapshot(state: ReturnType<typeof createMockProcessingState>) {
  return {
    processes: [
      {
        key: 'transcription',
        label: 'Transcription',
        description: 'OCR and handwriting recognition for uploaded letter pages.',
        order: 0,
        group: 'batch',
        capabilities: DEFAULT_CAPS,
        eligibleCount: 4,
        queued: state.transcriptionQueue,
        active: state.transcriptionActive,
        recent: state.recent.transcription,
      },
      {
        key: 'metadata',
        label: 'Metadata extraction',
        description: 'Extract sender, recipient, date, summary, and hooks from confirmed transcripts.',
        order: 1,
        group: 'batch',
        capabilities: DEFAULT_CAPS,
        eligibleCount: 1,
        queued: state.metadataQueue,
        active: null,
        recent: state.recent.metadata,
      },
      {
        key: 'entity_extraction',
        label: 'Entity extraction',
        description: 'Resolve persons and places mentioned in each letter.',
        order: 2,
        group: 'batch',
        capabilities: DEFAULT_CAPS,
        eligibleCount: 1,
        queued: state.entityQueue,
        active: null,
        recent: state.recent.entity_extraction,
      },
      {
        key: 'background_worker',
        label: 'Background worker',
        description: 'Autonomous process that handles pending letters on its own.',
        order: 3,
        group: 'autonomous',
        capabilities: WORKER_CAPS,
        eligibleCount: 0,
        queued: [],
        active: null,
        recent: [],
        observed: {
          lastTickAt: '2026-03-09T12:00:00.000Z',
          isPolling: true,
          lastError: null,
          currentBatchSize: 0,
        },
      },
    ],
    activeBatch: state.activeBatch,
  };
}

export async function installMockProcessingQueueApi(
  page: Page,
  options: {
    snapshotError?: { message: string; requestId: string };
    cancelError?: { message: string; requestId: string };
    startTranscriptionError?: { message: string; requestId: string };
    withoutActiveBatch?: boolean;
  } = {},
) {
  await page.addInitScript(() => {
    localStorage.setItem('adminToken', 'mock-token');
  });

  const state = createMockProcessingState();
  if (options.withoutActiveBatch) {
    state.transcriptionActive = null;
    state.activeBatch = null as never;
  }
  const removeRequests: Array<{ letterId: string; processKey: ProcessKey }> = [];
  const cancelRequests: Array<{ letterId: string; processKey: ProcessKey }> = [];
  const startTranscriptionRequests: Array<Record<string, unknown>> = [];

  // Snapshot (all processes at once)
  await page.route(
    new RegExp(`${escapeRegex(API_BASE_URL)}/admin/processing/snapshot$`),
    async (route) => {
      if (options.snapshotError) {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          headers: { 'x-request-id': options.snapshotError.requestId },
          body: JSON.stringify({
            error: options.snapshotError.message,
            requestId: options.snapshotError.requestId,
          }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(buildSnapshot(state)),
      });
    },
  );

  // Stream token — always succeed with a dummy token; the SSE endpoint itself
  // will be stubbed below so the client transitions to fallback-polling.
  await page.route(
    new RegExp(`${escapeRegex(API_BASE_URL)}/admin/processing/stream-token$`),
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ token: 'mock-stream-token', expiresAt: Date.now() + 60000 }),
      });
    },
  );

  // SSE stream — abort immediately so the client falls back to snapshot polling.
  await page.route(
    new RegExp(`${escapeRegex(API_BASE_URL)}/admin/processing/stream(\\?.*)?$`),
    async (route) => {
      await route.abort();
    },
  );

  // Start transcription (new per-process endpoint)
  await page.route(
    new RegExp(
      `${escapeRegex(API_BASE_URL)}/admin/processing/processes/transcription/start$`,
    ),
    async (route) => {
      startTranscriptionRequests.push(
        (route.request().postDataJSON() as Record<string, unknown> | null) ?? {},
      );

      if (options.startTranscriptionError) {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          headers: { 'x-request-id': options.startTranscriptionError.requestId },
          body: JSON.stringify({
            error: options.startTranscriptionError.message,
            requestId: options.startTranscriptionError.requestId,
          }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Started transcription', total: 2 }),
      });
    },
  );

  // Per-process queue/remove
  await page.route(
    new RegExp(
      `${escapeRegex(API_BASE_URL)}/admin/processing/processes/([^/]+)/queue/remove$`,
    ),
    async (route, request) => {
      const match = request.url().match(/\/processes\/([^/]+)\/queue\/remove$/);
      const processKey = (match?.[1] ?? 'transcription') as ProcessKey;
      const body = (request.postDataJSON() as { letterId: string }) ?? { letterId: '' };
      removeRequests.push({ letterId: body.letterId, processKey });

      if (processKey === 'metadata') {
        state.metadataQueue = state.metadataQueue.filter((i) => i.letterId !== body.letterId);
      } else if (processKey === 'transcription') {
        state.transcriptionQueue = state.transcriptionQueue.filter(
          (i) => i.letterId !== body.letterId,
        );
      } else if (processKey === 'entity_extraction') {
        state.entityQueue = state.entityQueue.filter((i) => i.letterId !== body.letterId);
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Removed from queue' }),
      });
    },
  );

  // Per-process cancel active
  await page.route(
    new RegExp(
      `${escapeRegex(API_BASE_URL)}/admin/processing/processes/([^/]+)/cancel$`,
    ),
    async (route, request) => {
      const match = request.url().match(/\/processes\/([^/]+)\/cancel$/);
      const processKey = (match?.[1] ?? 'transcription') as ProcessKey;
      const body = (request.postDataJSON() as { letterId: string }) ?? { letterId: '' };
      cancelRequests.push({ letterId: body.letterId, processKey });

      if (options.cancelError) {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          headers: { 'x-request-id': options.cancelError.requestId },
          body: JSON.stringify({
            error: options.cancelError.message,
            requestId: options.cancelError.requestId,
          }),
        });
        return;
      }

      if (processKey === 'transcription') {
        state.transcriptionActive = null;
        state.activeBatch = null as never;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Job cancelled' }),
      });
    },
  );

  return {
    state,
    removeRequests,
    cancelRequests,
    startTranscriptionRequests,
  };
}
