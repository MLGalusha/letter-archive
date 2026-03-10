import type { Page } from '@playwright/test';
import { API_BASE_URL } from './test-helpers';

type QueueJobType = 'transcription' | 'metadata' | 'entity_extraction';

interface QueuedItem {
  letterId: string;
  letterTitle: string;
  collectionCode: string;
  sender: string | null;
  recipient: string | null;
  queuedAt: string;
}

interface QueueRecentJob {
  letterId: string;
  letterTitle: string;
  collectionCode: string;
  type: QueueJobType;
  status: 'SUCCESS' | 'FAILED';
  error?: string;
  completedAt: string;
}

interface QueueActiveJob {
  letterId: string;
  letterTitle: string;
  collectionCode: string;
  sender: string | null;
  recipient: string | null;
  type: QueueJobType;
  startedAt: string;
  progress: {
    step: number;
    totalSteps: number;
    stepLabel: string;
  } | null;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function createMockQueueState() {
  return {
    active: [
      {
        letterId: 'letter-1',
        letterTitle: '19470810',
        collectionCode: '009',
        sender: 'Alice Smith',
        recipient: 'Bob Baker',
        type: 'transcription' as QueueJobType,
        startedAt: '2026-03-09T12:00:00.000Z',
        progress: {
          step: 1,
          totalSteps: 3,
          stepLabel: 'OCR',
        },
      },
    ] satisfies QueueActiveJob[],
    queued: {
      transcription: [
        {
          letterId: 'letter-2',
          letterTitle: '19470811',
          collectionCode: '009',
          sender: 'Carol Clark',
          recipient: 'David Dunn',
          queuedAt: '2026-03-09T12:01:00.000Z',
        },
      ] satisfies QueuedItem[],
      metadata: [
        {
          letterId: 'letter-3',
          letterTitle: '19470812',
          collectionCode: '009',
          sender: 'Ellen Gray',
          recipient: 'Frank Hale',
          queuedAt: '2026-03-09T12:02:00.000Z',
        },
      ] satisfies QueuedItem[],
      entityExtraction: [] as QueuedItem[],
    },
    recent: [
      {
        letterId: 'letter-4',
        letterTitle: '19470813',
        collectionCode: '009',
        type: 'metadata' as QueueJobType,
        status: 'FAILED' as const,
        error: 'metadata offline',
        completedAt: '2026-03-09T12:03:00.000Z',
      },
      {
        letterId: 'letter-5',
        letterTitle: '19470814',
        collectionCode: '009',
        type: 'transcription' as QueueJobType,
        status: 'SUCCESS' as const,
        completedAt: '2026-03-09T12:04:00.000Z',
      },
    ] satisfies QueueRecentJob[],
    onDemandProcessing: {
      isRunning: false,
      isPaused: false,
      shouldAbort: false,
      currentJob: null,
      completed: 0,
      failed: 0,
      total: 0,
      errors: [] as string[],
      lastCompletedAt: null as number | null,
    },
  };
}

function buildQueueResponse(state: ReturnType<typeof createMockQueueState>) {
  return {
    active: state.active,
    queued: state.queued,
    recent: state.recent,
    counts: {
      activeCount: state.active.length,
      queuedTranscription: state.queued.transcription.length,
      queuedMetadata: state.queued.metadata.length,
      queuedEntityExtraction: state.queued.entityExtraction.length,
      recentSuccessCount: state.recent.filter((job) => job.status === 'SUCCESS').length,
      recentFailedCount: state.recent.filter((job) => job.status === 'FAILED').length,
    },
    onDemandProcessing: state.onDemandProcessing,
  };
}

export async function installMockProcessingQueueApi(
  page: Page,
  options: {
    queueError?: { message: string; requestId: string };
    cancelError?: { message: string; requestId: string };
    startTranscriptionError?: { message: string; requestId: string };
  } = {},
) {
  await page.addInitScript(() => {
    sessionStorage.setItem('adminAuth', 'true');
  });

  const state = createMockQueueState();
  const removeRequests: Array<{ letterId: string; type: QueueJobType }> = [];
  const cancelRequests: Array<{ letterId: string; type: QueueJobType }> = [];
  const startTranscriptionRequests: Array<Record<string, never>> = [];

  await page.route(new RegExp(`${escapeRegex(API_BASE_URL)}/admin/processing/queue$`), async (route) => {
    if (options.queueError) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        headers: {
          'x-request-id': options.queueError.requestId,
        },
        body: JSON.stringify({
          error: options.queueError.message,
          requestId: options.queueError.requestId,
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildQueueResponse(state)),
    });
  });

  await page.route(
    new RegExp(`${escapeRegex(API_BASE_URL)}/admin/processing/start-transcription$`),
    async (route) => {
      startTranscriptionRequests.push({});

      if (options.startTranscriptionError) {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          headers: {
            'x-request-id': options.startTranscriptionError.requestId,
          },
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

  await page.route(
    new RegExp(`${escapeRegex(API_BASE_URL)}/admin/processing/queue/remove$`),
    async (route) => {
      const body = route.request().postDataJSON() as {
        letterId: string;
        type: QueueJobType;
      };
      removeRequests.push(body);

      const queueKey = body.type === 'entity_extraction' ? 'entityExtraction' : body.type;
      state.queued[queueKey] = state.queued[queueKey].filter((item) => item.letterId !== body.letterId);

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Removed from queue' }),
      });
    },
  );

  await page.route(new RegExp(`${escapeRegex(API_BASE_URL)}/admin/processing/cancel$`), async (route) => {
    const body = route.request().postDataJSON() as {
      letterId: string;
      type: QueueJobType;
    };
    cancelRequests.push(body);

    if (options.cancelError) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        headers: {
          'x-request-id': options.cancelError.requestId,
        },
        body: JSON.stringify({
          error: options.cancelError.message,
          requestId: options.cancelError.requestId,
        }),
      });
      return;
    }

    state.active = state.active.filter((job) => job.letterId !== body.letterId || job.type !== body.type);

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Job cancelled' }),
    });
  });

  return {
    state,
    removeRequests,
    cancelRequests,
    startTranscriptionRequests,
  };
}
