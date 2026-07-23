import type { Page, Request } from '@playwright/test';
import {
  API_BASE_URL,
  installMockImageSessionApi,
} from './test-helpers';

interface MockLetter {
  id: string;
  title: string;
  collectionCode?: string;
  images: Array<{
    id: string;
    type: string;
    imageUrl: string;
    pageNumber?: number;
  }>;
  transcript: {
    pages: Array<{ pageNumber: number; text: string }>;
    fullText: string;
    verified: boolean;
  };
  metadata: {
    sender?: string;
    recipient?: string;
    dateRaw?: string;
    description?: string;
    hook?: string;
    verified: boolean;
  };
  status: string;
  workflowState: string;
  visibility: 'PUBLISHED' | 'HIDDEN';
  transcriptStatus: 'EMPTY' | 'AI_DRAFT' | 'EDITED' | 'VERIFIED';
  metadataContentStatus: 'EMPTY' | 'AI_DRAFT' | 'EDITED' | 'VERIFIED';
  extraContentStatus: 'EMPTY' | 'AI_DRAFT' | 'EDITED' | 'VERIFIED';
  createdAt: string;
  updatedAt?: string;
  flagged: boolean;
  lettersCount?: number;
  extrasCount?: number;
}

const baseLetters: MockLetter[] = [
  {
    id: 'letter-1',
    title: 'Letter One',
    collectionCode: '001',
    images: [{ id: 'img-1', type: 'letter', imageUrl: '/images/1', pageNumber: 1 }],
    transcript: {
      pages: [{ pageNumber: 1, text: 'My dear mother' }],
      fullText: 'My dear mother',
      verified: false,
    },
    metadata: {
      sender: 'Alice Smith',
      recipient: 'Bob Smith',
      dateRaw: '19320706',
      description: 'Alice wrote to Bob about family.',
      hook: 'Family update from Alice.',
      verified: false,
    },
    status: 'needs_review',
    workflowState: 'TRANSCRIBED',
    visibility: 'PUBLISHED',
    transcriptStatus: 'AI_DRAFT',
    metadataContentStatus: 'EDITED',
    extraContentStatus: 'EMPTY',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-02T00:00:00.000Z',
    flagged: false,
    lettersCount: 1,
    extrasCount: 0,
  },
  {
    id: 'letter-2',
    title: 'Letter Two',
    collectionCode: '002',
    images: [{ id: 'img-2', type: 'letter', imageUrl: '/images/2', pageNumber: 1 }],
    transcript: {
      pages: [{ pageNumber: 1, text: 'Travel plans for summer' }],
      fullText: 'Travel plans for summer',
      verified: true,
    },
    metadata: {
      sender: 'Clara Jones',
      recipient: 'David Jones',
      dateRaw: '19330508',
      description: 'Travel plans and train tickets.',
      hook: 'Trip planning.',
      verified: true,
    },
    status: 'published',
    workflowState: 'REVIEWED',
    visibility: 'HIDDEN',
    transcriptStatus: 'VERIFIED',
    metadataContentStatus: 'VERIFIED',
    extraContentStatus: 'EMPTY',
    createdAt: '2025-02-01T00:00:00.000Z',
    updatedAt: '2025-02-02T00:00:00.000Z',
    flagged: true,
    lettersCount: 1,
    extrasCount: 0,
  },
];

function cloneLetters(letters: MockLetter[]): MockLetter[] {
  return JSON.parse(JSON.stringify(letters)) as MockLetter[];
}

function buildStats(letters: MockLetter[]) {
  const published = letters.filter((letter) => letter.visibility === 'PUBLISHED').length;
  const hidden = letters.filter((letter) => letter.visibility === 'HIDDEN').length;
  const flagged = letters.filter((letter) => letter.flagged).length;

  return {
    total: letters.length,
    uploaded: 0,
    transcribed: letters.filter((letter) => letter.workflowState === 'TRANSCRIBED').length,
    metadataReady: letters.filter((letter) => letter.metadataContentStatus !== 'EMPTY').length,
    reviewed: letters.filter((letter) => letter.workflowState === 'REVIEWED').length,
    published,
    hidden,
    flagged,
    transcript: {
      empty: letters.filter((letter) => letter.transcriptStatus === 'EMPTY').length,
      aiDraft: letters.filter((letter) => letter.transcriptStatus === 'AI_DRAFT').length,
      edited: letters.filter((letter) => letter.transcriptStatus === 'EDITED').length,
      verified: letters.filter((letter) => letter.transcriptStatus === 'VERIFIED').length,
    },
    metadata: {
      empty: letters.filter((letter) => letter.metadataContentStatus === 'EMPTY').length,
      aiDraft: letters.filter((letter) => letter.metadataContentStatus === 'AI_DRAFT').length,
      edited: letters.filter((letter) => letter.metadataContentStatus === 'EDITED').length,
      verified: letters.filter((letter) => letter.metadataContentStatus === 'VERIFIED').length,
    },
  };
}

function buildAdminLettersResponse(letters: MockLetter[], statsSource: MockLetter[] = letters) {
  return {
    letters,
    pagination: {
      page: 1,
      limit: 50,
      total: letters.length,
      totalPages: 1,
    },
    stats: buildStats(statsSource),
  };
}

function matchesSearch(letter: MockLetter, search: string): boolean {
  const haystack = [
    letter.metadata.sender,
    letter.metadata.recipient,
    letter.metadata.description,
    letter.metadata.hook,
    letter.title,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return haystack.includes(search.toLowerCase());
}

function filterLetters(letters: MockLetter[], requestUrl: URL): MockLetter[] {
  const visibility = requestUrl.searchParams.get('visibility');
  const search = requestUrl.searchParams.get('search');
  const flagged = requestUrl.searchParams.get('flagged');

  return letters.filter((letter) => {
    if (visibility && letter.visibility !== visibility) {
      return false;
    }
    if (flagged === 'true' && !letter.flagged) {
      return false;
    }
    if (flagged === 'false' && letter.flagged) {
      return false;
    }
    if (search && !matchesSearch(letter, search)) {
      return false;
    }
    return true;
  });
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface MockAdminDashboardContext {
  adminLettersRequests: URL[];
  flagRequests: Array<{ url: string; body: unknown }>;
}

interface MockAdminDashboardOptions {
  lettersError?: {
    message: string;
    requestId?: string;
    status?: number;
  };
  processingStatusError?: {
    message: string;
    requestId?: string;
    status?: number;
  };
  flagError?: {
    message: string;
    requestId?: string;
    status?: number;
  };
}

export async function installMockAdminDashboardApi(
  page: Page,
  options: MockAdminDashboardOptions = {},
): Promise<MockAdminDashboardContext> {
  await installMockImageSessionApi(page);

  const letters = cloneLetters(baseLetters);
  const adminLettersRequests: URL[] = [];
  const flagRequests: Array<{ url: string; body: unknown }> = [];

  await page.addInitScript(() => {
    localStorage.setItem('adminToken', 'mock-token');
    localStorage.removeItem('adminDashboardState');
    localStorage.removeItem('adminDashboardColumns');
    sessionStorage.removeItem('adminDashboardState');
  });

  await page.route(`${API_BASE_URL}/admin/processing/status`, async (route) => {
    if (options.processingStatusError) {
      await route.fulfill({
        status: options.processingStatusError.status ?? 500,
        contentType: 'application/json',
        headers: options.processingStatusError.requestId
          ? { 'x-request-id': options.processingStatusError.requestId }
          : undefined,
        body: JSON.stringify({
          error: options.processingStatusError.message,
          requestId: options.processingStatusError.requestId,
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        isRunning: false,
        completed: 0,
        total: 0,
        currentJob: null,
        lastCompletedAt: null,
      }),
    });
  });

  await page.route(new RegExp(`${escapeRegex(API_BASE_URL)}/admin/letters(?:\\?.*)?$`), async (route) => {
    const requestUrl = new URL(route.request().url());
    adminLettersRequests.push(requestUrl);

    if (options.lettersError) {
      await route.fulfill({
        status: options.lettersError.status ?? 500,
        contentType: 'application/json',
        headers: options.lettersError.requestId
          ? { 'x-request-id': options.lettersError.requestId }
          : undefined,
        body: JSON.stringify({
          error: options.lettersError.message,
          requestId: options.lettersError.requestId,
        }),
      });
      return;
    }

    const filteredLetters = filterLetters(letters, requestUrl);

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildAdminLettersResponse(filteredLetters, letters)),
    });
  });

  await page.route(new RegExp(`${escapeRegex(API_BASE_URL)}/admin/letters/[^/]+/flag$`), async (route) => {
    const request = route.request();
    const body = request.postDataJSON() as { flagged?: boolean };
    const letterId = request.url().split('/').slice(-2)[0];
    flagRequests.push({ url: request.url(), body });

    if (options.flagError) {
      await route.fulfill({
        status: options.flagError.status ?? 500,
        contentType: 'application/json',
        headers: options.flagError.requestId
          ? { 'x-request-id': options.flagError.requestId }
          : undefined,
        body: JSON.stringify({
          error: options.flagError.message,
          requestId: options.flagError.requestId,
        }),
      });
      return;
    }

    const target = letters.find((letter) => letter.id === letterId);
    if (target && typeof body?.flagged === 'boolean') {
      target.flagged = body.flagged;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(target ?? { ok: true }),
    });
  });

  return {
    adminLettersRequests,
    flagRequests,
  };
}

export async function waitForAdminLettersRequest(
  page: Page,
  predicate: (url: URL) => boolean,
): Promise<URL> {
  const request = await page.waitForRequest((candidate: Request) => {
    if (!candidate.url().startsWith(`${API_BASE_URL}/admin/letters`)) {
      return false;
    }

    const url = new URL(candidate.url());
    if (url.pathname !== '/admin/letters') {
      return false;
    }

    return predicate(url);
  });

  return new URL(request.url());
}
