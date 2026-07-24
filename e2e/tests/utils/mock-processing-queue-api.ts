import type { Page, Route } from "@playwright/test";
import {
  API_BASE_URL,
  installMockImageSessionApi,
} from "./test-helpers";

type ProcessingJobType =
  | "transcription"
  | "metadata"
  | "entity_extraction"
  | "extra_content";

interface QueuedItem {
  letterId: string;
  letterTitle: string;
  collectionCode: string;
  sender: string | null;
  recipient: string | null;
  queuedAt: string | null;
}

interface ActiveJob {
  letterId: string;
  letterTitle: string;
  collectionCode: string;
  sender: string | null;
  recipient: string | null;
  type: ProcessingJobType;
  startedAt: string;
}

interface RecentJob {
  letterId: string;
  letterTitle: string;
  collectionCode: string;
  type: ProcessingJobType;
  status: "SUCCESS" | "FAILED" | "CLEARED";
  error?: string;
  completedAt: string;
}

interface MockProcessingState {
  active: ActiveJob[];
  queued: {
    transcription: QueuedItem[];
    metadata: QueuedItem[];
    entityExtraction: QueuedItem[];
    extraContent: QueuedItem[];
  };
  recent: RecentJob[];
  worker: {
    lastTickAt: string | null;
    isPolling: boolean;
    lastError: string | null;
    currentBatchSize: number | null;
    updatedAt: string | null;
  };
}

type WakeResult =
  | { requested: true }
  | {
      requested: false;
      reason: "queue_empty" | "worker_not_configured";
    };

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function fulfillJson(
  route: Route,
  body: unknown,
  status = 200,
  requestId?: string,
): Promise<void> {
  await route.fulfill({
    status,
    contentType: "application/json",
    headers: requestId ? { "x-request-id": requestId } : undefined,
    body: JSON.stringify(body),
  });
}

function queueForType(
  state: MockProcessingState,
  type: ProcessingJobType,
): QueuedItem[] {
  switch (type) {
    case "transcription":
      return state.queued.transcription;
    case "metadata":
      return state.queued.metadata;
    case "entity_extraction":
      return state.queued.entityExtraction;
    case "extra_content":
      return state.queued.extraContent;
  }
}

function replaceQueueForType(
  state: MockProcessingState,
  type: ProcessingJobType,
  items: QueuedItem[],
): void {
  switch (type) {
    case "transcription":
      state.queued.transcription = items;
      break;
    case "metadata":
      state.queued.metadata = items;
      break;
    case "entity_extraction":
      state.queued.entityExtraction = items;
      break;
    case "extra_content":
      state.queued.extraContent = items;
      break;
  }
}

export function createMockProcessingState(): MockProcessingState {
  return {
    active: [
      {
        letterId: "letter-1",
        letterTitle: "19470810",
        collectionCode: "009",
        sender: "Alice Smith",
        recipient: "Bob Baker",
        type: "transcription",
        startedAt: "2026-03-09T12:00:00.000Z",
      },
      {
        letterId: "letter-6",
        letterTitle: "19470815",
        collectionCode: "009",
        sender: "Grace Hill",
        recipient: "Henry Irwin",
        type: "transcription",
        startedAt: "2026-03-09T12:00:30.000Z",
      },
    ],
    queued: {
      transcription: [
        {
          letterId: "letter-2",
          letterTitle: "19470811",
          collectionCode: "009",
          sender: "Carol Clark",
          recipient: "David Dunn",
          queuedAt: "2026-03-09T12:01:00.000Z",
        },
      ],
      metadata: [
        {
          letterId: "letter-3",
          letterTitle: "19470812",
          collectionCode: "009",
          sender: "Ellen Gray",
          recipient: "Frank Hale",
          queuedAt: "2026-03-09T12:02:00.000Z",
        },
      ],
      entityExtraction: [],
      extraContent: [
        {
          letterId: "letter-extra",
          letterTitle: "19470816",
          collectionCode: "009",
          sender: null,
          recipient: null,
          queuedAt: null,
        },
      ],
    },
    recent: [
      {
        letterId: "letter-5",
        letterTitle: "19470814",
        collectionCode: "009",
        type: "transcription",
        status: "SUCCESS",
        completedAt: "2026-03-09T12:04:00.000Z",
      },
      {
        letterId: "letter-4",
        letterTitle: "19470813",
        collectionCode: "009",
        type: "metadata",
        status: "FAILED",
        error: "metadata offline",
        completedAt: "2026-03-09T12:03:00.000Z",
      },
    ],
    worker: {
      lastTickAt: "2026-03-09T12:00:00.000Z",
      isPolling: true,
      lastError: null,
      currentBatchSize: 2,
      updatedAt: "2026-03-09T12:00:10.000Z",
    },
  };
}

function buildQueueStatus(state: MockProcessingState) {
  return {
    ...state,
    counts: {
      activeCount: state.active.length,
      queuedTranscription: state.queued.transcription.length,
      queuedMetadata: state.queued.metadata.length,
      queuedEntityExtraction: state.queued.entityExtraction.length,
      queuedExtraContent: state.queued.extraContent.length,
      recentSuccessCount: state.recent.filter(
        (job) => job.status === "SUCCESS",
      ).length,
      recentFailedCount: state.recent.filter(
        (job) => job.status === "FAILED",
      ).length,
      recentClearedCount: state.recent.filter(
        (job) => job.status === "CLEARED",
      ).length,
    },
  };
}

export async function installMockProcessingQueueApi(
  page: Page,
  options: {
    snapshotError?: { message: string; requestId: string };
    cancelError?: { message: string; requestId: string };
    retryError?: { message: string; requestId: string };
    wakeResult?: WakeResult;
  } = {},
) {
  await installMockImageSessionApi(page);

  await page.addInitScript(() => {
    localStorage.setItem("adminToken", "mock-token");
  });

  const state = createMockProcessingState();
  const removeRequests: Array<{
    letterId: string;
    type: ProcessingJobType;
  }> = [];
  const cancelRequests: Array<{
    letterId: string;
    type: ProcessingJobType;
  }> = [];
  const retryRequests: Array<{
    letterId: string;
    type: ProcessingJobType;
  }> = [];
  const wakeRequests: Array<Record<string, never>> = [];

  await page.route(
    new RegExp(`${escapeRegex(API_BASE_URL)}/admin/processing/queue$`),
    async (route) => {
      if (options.snapshotError) {
        await fulfillJson(
          route,
          {
            error: options.snapshotError.message,
            requestId: options.snapshotError.requestId,
          },
          500,
          options.snapshotError.requestId,
        );
        return;
      }
      await fulfillJson(route, buildQueueStatus(state));
    },
  );

  await page.route(
    new RegExp(`${escapeRegex(API_BASE_URL)}/admin/processing/wake$`),
    async (route) => {
      wakeRequests.push({});
      await fulfillJson(route, options.wakeResult ?? { requested: true });
    },
  );

  await page.route(
    new RegExp(
      `${escapeRegex(API_BASE_URL)}/admin/processing/queue/remove$`,
    ),
    async (route, request) => {
      const body = request.postDataJSON() as {
        letterId: string;
        type: ProcessingJobType;
      };
      removeRequests.push(body);
      replaceQueueForType(
        state,
        body.type,
        queueForType(state, body.type).filter(
          (item) => item.letterId !== body.letterId,
        ),
      );
      await fulfillJson(route, { message: "Removed from queue" });
    },
  );

  await page.route(
    new RegExp(`${escapeRegex(API_BASE_URL)}/admin/processing/cancel$`),
    async (route, request) => {
      const body = request.postDataJSON() as {
        letterId: string;
        type: ProcessingJobType;
      };
      cancelRequests.push(body);
      if (options.cancelError) {
        await fulfillJson(
          route,
          {
            error: options.cancelError.message,
            requestId: options.cancelError.requestId,
          },
          500,
          options.cancelError.requestId,
        );
        return;
      }
      state.active = state.active.filter(
        (job) =>
          job.letterId !== body.letterId || job.type !== body.type,
      );
      await fulfillJson(route, { message: "Job cancelled" });
    },
  );

  await page.route(
    new RegExp(
      `${escapeRegex(API_BASE_URL)}/admin/processing/queue/retry$`,
    ),
    async (route, request) => {
      const body = request.postDataJSON() as {
        letterId: string;
        type: ProcessingJobType;
      };
      retryRequests.push(body);
      if (options.retryError) {
        await fulfillJson(
          route,
          {
            error: options.retryError.message,
            requestId: options.retryError.requestId,
          },
          500,
          options.retryError.requestId,
        );
        return;
      }
      await fulfillJson(route, { message: "Retry queued" });
    },
  );

  await page.route(
    new RegExp(
      `${escapeRegex(API_BASE_URL)}/admin/processing/queue/clear$`,
    ),
    async (route, request) => {
      const body = request.postDataJSON() as { type: ProcessingJobType };
      const cleared = queueForType(state, body.type).length;
      replaceQueueForType(state, body.type, []);
      await fulfillJson(route, { message: "Queue cleared", cleared });
    },
  );

  return {
    state,
    removeRequests,
    cancelRequests,
    retryRequests,
    wakeRequests,
  };
}
