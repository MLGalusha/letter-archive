import { access } from 'node:fs/promises';
import path from 'node:path';
import type { Page, Route } from '@playwright/test';
import {
  API_BASE_URL,
  installMockImageSessionApi,
} from './test-helpers';

interface MockLetterImage {
  id: string;
  type: string;
  imageUrl: string;
  pageNumber?: number;
  originalFilename?: string;
  sourceChecksum?: string;
  lineSegments?: unknown[];
  segmentTrustState?: 'trusted' | 'unverified';
}

interface MockLetterReviewLetter {
  id: string;
  title: string;
  collectionCode?: string;
  primarySourceRevision: number;
  images: MockLetterImage[];
  transcript: {
    pages: Array<{ pageNumber: number; text: string }>;
    fullText: string;
    verified: boolean;
  };
  metadata: {
    sender?: string;
    recipient?: string;
    date?: string;
    dateRaw?: string;
    location?: string;
    description?: string;
    hook?: string;
    notes?: string;
    primaryTopics?: string[];
    verified: boolean;
  };
  status: string;
  workflowState: string;
  visibility: 'PUBLISHED' | 'HIDDEN';
  transcriptStatus: 'EMPTY' | 'AI_DRAFT' | 'EDITED' | 'VERIFIED';
  metadataContentStatus: 'EMPTY' | 'AI_DRAFT' | 'EDITED' | 'VERIFIED';
  extraContentStatus: 'EMPTY' | 'AI_DRAFT' | 'EDITED' | 'VERIFIED';
  extraContentTranscript?: string;
  createdAt: string;
  updatedAt?: string;
  transcriptVerifiedAt?: string;
  metadataVerifiedAt?: string;
  extraContentVerifiedAt?: string;
  flagged: boolean;
  linkedPersons?: unknown[];
  linkedPlaces?: unknown[];
  entityExtractionStatus?: string;
  entityExtractionJson?: unknown;
}

interface MockUpdateLetterRequest {
  url: string;
  body: {
    primarySourceRevision?: number;
    transcriptionText?: string;
    sender?: string | null;
    recipient?: string | null;
    locationWritten?: string | null;
    hook?: string | null;
    summary?: string | null;
    notes?: string | null;
  };
}

interface MockPageLineSegmentsRequest {
  url: string;
  pageId: string;
  body: {
    lineSegments?: unknown[];
    primarySourceRevision?: number;
    sourceChecksum?: string | null;
  };
}

interface MockPageSegmentTrustRequest {
  url: string;
  pageId: string;
  body: {
    trustState?: 'trusted' | 'unverified';
    primarySourceRevision?: number;
    sourceChecksum?: string | null;
  };
}

interface MockLetterSegmentTrustRequest {
  url: string;
  body: {
    trustState?: 'trusted' | 'unverified';
    primarySourceRevision?: number;
    pages?: Array<{
      pageId?: string;
      sourceChecksum?: string | null;
    }>;
  };
}

interface MockVersionRequest {
  url: string;
  body: {
    fieldType?: string;
    content?: unknown;
    source?: string;
  };
}

interface MockExtraContentRequest {
  url: string;
  body: {
    extraContent?: string | null;
    extraContentTranscript?: string | null;
  };
}

interface MockAiNotesRequest {
  url: string;
  body: {
    aiNotes?: string | null;
  };
}

interface MockApiFailure {
  status?: number;
  error: string;
  code?: string;
  requestId?: string;
}

type MockLetterReviewOverrides = Partial<MockLetterReviewLetter> & {
  transcript?: Partial<MockLetterReviewLetter['transcript']>;
  metadata?: Partial<MockLetterReviewLetter['metadata']>;
};

const TRANSCRIPT_VERIFIED_AT = '2025-03-01T00:00:00.000Z';
const METADATA_VERIFIED_AT = '2025-03-02T00:00:00.000Z';
const EXTRA_CONTENT_VERIFIED_AT = '2025-03-03T00:00:00.000Z';
const COLLECTION_009_ROOT = path.resolve(
  process.cwd(),
  '../backend/storage/collections/009',
);

const collection009ImageFixtures = [
  {
    id: 'collection-009-page-1',
    type: 'letter',
    imageUrl: '/mock-assets/collection-009/19470810/L01/009-19470810-L01-01.jpg',
    pageNumber: 1,
    originalFilename: '009-19470810-L01-01.jpg',
    sourceChecksum: '1111111111111111111111111111111111111111111111111111111111111111',
    filePath: path.join(
      COLLECTION_009_ROOT,
      '19470810/L01/009-19470810-L01-01.jpg',
    ),
  },
  {
    id: 'collection-009-page-2',
    type: 'letter',
    imageUrl: '/mock-assets/collection-009/19470810/L01/009-19470810-L01-02.jpg',
    pageNumber: 2,
    originalFilename: '009-19470810-L01-02.jpg',
    sourceChecksum: '2222222222222222222222222222222222222222222222222222222222222222',
    filePath: path.join(
      COLLECTION_009_ROOT,
      '19470810/L01/009-19470810-L01-02.jpg',
    ),
  },
] as const;

const PAGE_SEPARATOR_REGEX = /\n*---\s*Page\s*\d+\s*---\n*/i;

function buildFullTranscript(pageLines: string[][]): string {
  if (pageLines.length === 1) {
    return pageLines[0].join('\n');
  }

  return pageLines
    .map((lines, index) => `--- Page ${index + 1} ---\n\n${lines.join('\n')}`)
    .join('\n\n');
}

function splitTranscriptByPage(fullText: string, pageCount: number): string[] {
  if (pageCount <= 1) return [fullText];

  const parts = fullText.split(PAGE_SEPARATOR_REGEX);
  const pages: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    pages.push(parts[i] || '');
  }
  while (pages.length < pageCount) {
    pages.push('');
  }
  return pages;
}

function clearTranscriptVerification(letter: MockLetterReviewLetter) {
  letter.transcriptStatus = 'EDITED';
  letter.transcript.verified = false;
  delete letter.transcriptVerifiedAt;
}

function clearMetadataVerification(letter: MockLetterReviewLetter) {
  letter.metadataContentStatus = 'EDITED';
  letter.metadata.verified = false;
  delete letter.metadataVerifiedAt;
}

function createLineSegment(
  line: number,
  bbox: [number, number, number, number],
) {
  return {
    line,
    bbox,
    baseline: [
      [bbox[0], bbox[3] - 6],
      [bbox[2], bbox[3] - 6],
    ],
    ocrText: '',
  };
}

const defaultDetectLinesByPageId = {
  'collection-009-page-1': {
    lineSegments: [
      createLineSegment(1, [170, 210, 1480, 280]),
      createLineSegment(2, [185, 320, 1495, 390]),
    ],
  },
  'collection-009-page-2': {
    lineSegments: [
      createLineSegment(1, [175, 205, 1490, 275]),
      createLineSegment(2, [190, 315, 1505, 385]),
    ],
  },
} as const;

export function createMockDetectLinesByPageId() {
  return clone(defaultDetectLinesByPageId) as Record<
    string,
    {
      lineSegments: Array<ReturnType<typeof createLineSegment>>;
    }
  >;
}

const baseLetter: MockLetterReviewLetter = {
  id: 'letter-review-1',
  title: 'Review Letter One',
  collectionCode: '009',
  primarySourceRevision: 4,
  images: collection009ImageFixtures.map(({ filePath: _filePath, ...image }) => image),
  transcript: {
    pages: [
      {
        pageNumber: 1,
        text: 'My dear mother,\nI arrived safely in Boston.',
      },
      {
        pageNumber: 2,
        text: 'The weather has been kind.\nLove, Alice',
      },
    ],
    fullText: buildFullTranscript([
      ['My dear mother,', 'I arrived safely in Boston.'],
      ['The weather has been kind.', 'Love, Alice'],
    ]),
    verified: false,
  },
  metadata: {
    sender: 'Alice Smith',
    recipient: 'Bob Smith',
    date: '1932-07-06',
    dateRaw: '19320706',
    location: 'Boston',
    description: 'Alice wrote to Bob after arriving safely in Boston.',
    hook: 'Family update from Alice.',
    notes: 'Reviewed by archive team.',
    primaryTopics: ['family-news'],
    verified: false,
  },
  status: 'needs_review',
  workflowState: 'TRANSCRIBED',
  visibility: 'HIDDEN',
  transcriptStatus: 'EDITED',
  metadataContentStatus: 'EDITED',
  extraContentStatus: 'EMPTY',
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-02T00:00:00.000Z',
  flagged: false,
  linkedPersons: [],
  linkedPlaces: [],
  entityExtractionStatus: 'SUCCESS',
  entityExtractionJson: { people: [], places: [] },
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function createMockSvgBody(label: string): string {
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="800" height="1200" viewBox="0 0 800 1200">
      <rect width="800" height="1200" fill="#f5f0e8" />
      <rect x="40" y="40" width="720" height="1120" fill="#fffdfa" stroke="#d9cfc1" stroke-width="2" />
      <text x="80" y="120" font-size="36" font-family="Georgia, serif" fill="#5a4636">${label}</text>
    </svg>
  `.trim();
}

export function createMockLetterReviewLetter(
  overrides: MockLetterReviewOverrides = {},
): MockLetterReviewLetter {
  const letter = clone(baseLetter);

  return {
    ...letter,
    ...overrides,
    transcript: {
      ...letter.transcript,
      ...(overrides.transcript ?? {}),
    },
    metadata: {
      ...letter.metadata,
      ...(overrides.metadata ?? {}),
    },
    images: overrides.images ? clone(overrides.images) : letter.images,
    linkedPersons: overrides.linkedPersons ? clone(overrides.linkedPersons) : letter.linkedPersons,
    linkedPlaces: overrides.linkedPlaces ? clone(overrides.linkedPlaces) : letter.linkedPlaces,
  };
}

export interface MockLetterReviewContext {
  verifyTranscriptRequests: string[];
  unverifyTranscriptRequests: string[];
  verifyMetadataRequests: string[];
  unverifyMetadataRequests: string[];
  updateExtraContentRequests: MockExtraContentRequest[];
  updateAiNotesRequests: MockAiNotesRequest[];
  verifyExtraContentRequests: string[];
  unverifyExtraContentRequests: string[];
  flagRequests: Array<{ url: string; body: unknown }>;
  detectLineRequests: string[];
  saveLineSegmentRequests: MockPageLineSegmentsRequest[];
  pageSegmentTrustRequests: MockPageSegmentTrustRequest[];
  letterSegmentTrustRequests: MockLetterSegmentTrustRequest[];
  updateLetterRequests: MockUpdateLetterRequest[];
  versionRequests: MockVersionRequest[];
  transcribeLetterRequests: Array<{
    url: string;
    body: { primarySourceRevision?: number };
  }>;
}

export async function installMockLetterReviewApi(
  page: Page,
  options: {
    initialLetter?: MockLetterReviewLetter;
    detectLinesByPageId?: Record<
      string,
      {
        lineSegments: unknown[];
      }
    >;
    detectLinesFailuresByPageId?: Record<
      string,
      { status?: number; error: string; requestId?: string }
    >;
    routeFailures?: Partial<
      Record<
        | 'loadLetter'
        | 'updateLetter'
        | 'verifyTranscript'
        | 'transcribeLetter'
        | 'verifyMetadata'
        | 'extraContent'
        | 'aiNotes'
        | 'verifyExtraContent'
        | 'unverifyExtraContent'
        | 'flag',
        MockApiFailure
      >
    >;
  } = {},
): Promise<MockLetterReviewContext> {
  await installMockImageSessionApi(page);

  const letter = clone(options.initialLetter ?? baseLetter);
  const verifyTranscriptRequests: string[] = [];
  const unverifyTranscriptRequests: string[] = [];
  const verifyMetadataRequests: string[] = [];
  const unverifyMetadataRequests: string[] = [];
  const updateExtraContentRequests: MockExtraContentRequest[] = [];
  const updateAiNotesRequests: MockAiNotesRequest[] = [];
  const verifyExtraContentRequests: string[] = [];
  const unverifyExtraContentRequests: string[] = [];
  const flagRequests: Array<{ url: string; body: unknown }> = [];
  const detectLineRequests: string[] = [];
  const saveLineSegmentRequests: MockPageLineSegmentsRequest[] = [];
  const pageSegmentTrustRequests: MockPageSegmentTrustRequest[] = [];
  const letterSegmentTrustRequests: MockLetterSegmentTrustRequest[] = [];
  const updateLetterRequests: MockUpdateLetterRequest[] = [];
  const versionRequests: MockVersionRequest[] = [];
  const transcribeLetterRequests: MockLetterReviewContext['transcribeLetterRequests'] = [];
  const letterPath = `${API_BASE_URL}/admin/letters/${letter.id}`;
  const detectLinesByPageId = options.detectLinesByPageId
    ? clone(options.detectLinesByPageId)
    : createMockDetectLinesByPageId();
  const detectLinesFailuresByPageId = clone(options.detectLinesFailuresByPageId ?? {});
  const routeFailures = clone(options.routeFailures ?? {});

  const fulfillFailure = async (route: Route, failure: MockApiFailure) => {
    await route.fulfill({
      status: failure.status ?? 500,
      contentType: 'application/json',
      headers: failure.requestId ? { 'x-request-id': failure.requestId } : undefined,
      body: JSON.stringify({
        error: failure.error,
        code: failure.code,
        requestId: failure.requestId,
      }),
    });
  };

  await page.addInitScript(() => {
    localStorage.setItem('adminToken', 'mock-token');
    localStorage.removeItem('letterViewerState');
  });

  await page.route(new RegExp(`${escapeRegex(API_BASE_URL)}/mock-assets/collection-009/.*$`), async (route) => {
    const requestUrl = new URL(route.request().url());
    const requestPath = requestUrl.origin + requestUrl.pathname;
    const asset = collection009ImageFixtures.find(
      (candidate) => `${API_BASE_URL}${candidate.imageUrl}` === requestPath,
    );

    if (!asset) {
      await route.fulfill({
        status: 404,
        contentType: 'text/plain',
        body: 'Unknown collection 009 asset',
      });
      return;
    }

    try {
      await access(asset.filePath);
      await route.fulfill({
        status: 200,
        contentType: 'image/jpeg',
        path: asset.filePath,
      });
    } catch {
      await route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: createMockSvgBody('Missing collection 009 asset'),
      });
    }
  });

  await page.route(new RegExp(`${escapeRegex(letterPath)}$`), async (route) => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON() as MockUpdateLetterRequest['body'];
      updateLetterRequests.push({ url: route.request().url(), body });
      if (routeFailures.updateLetter) {
        await fulfillFailure(route, routeFailures.updateLetter);
        return;
      }
      if (body.primarySourceRevision !== letter.primarySourceRevision) {
        await fulfillFailure(route, {
          status: 409,
          error: 'Letter source changed; reload before saving',
        });
        return;
      }

      const transcriptPageCount = Math.max(letter.transcript.pages.length, 1);

      if (typeof body.transcriptionText === 'string') {
        const transcriptChanged = body.transcriptionText !== letter.transcript.fullText;
        letter.transcript.fullText = body.transcriptionText;
        const pageTexts = splitTranscriptByPage(body.transcriptionText, transcriptPageCount);
        letter.transcript.pages = pageTexts.map((text, index) => ({
          pageNumber: index + 1,
          text,
        }));

        if (transcriptChanged && letter.transcriptStatus === 'VERIFIED') {
          clearTranscriptVerification(letter);
        } else if (transcriptChanged && letter.transcriptStatus !== 'EDITED') {
          letter.transcriptStatus = 'EDITED';
        }
      }

      let metadataChanged = false;
      if (body.sender !== undefined) {
        const nextSender = body.sender ?? undefined;
        metadataChanged = metadataChanged || nextSender !== letter.metadata.sender;
        letter.metadata.sender = nextSender;
      }
      if (body.recipient !== undefined) {
        const nextRecipient = body.recipient ?? undefined;
        metadataChanged = metadataChanged || nextRecipient !== letter.metadata.recipient;
        letter.metadata.recipient = nextRecipient;
      }
      if (body.locationWritten !== undefined) {
        const nextLocation = body.locationWritten ?? undefined;
        metadataChanged = metadataChanged || nextLocation !== letter.metadata.location;
        letter.metadata.location = nextLocation;
      }
      if (body.hook !== undefined) {
        const nextHook = body.hook ?? undefined;
        metadataChanged = metadataChanged || nextHook !== letter.metadata.hook;
        letter.metadata.hook = nextHook;
      }
      if (body.summary !== undefined) {
        const nextDescription = body.summary ?? undefined;
        metadataChanged = metadataChanged || nextDescription !== letter.metadata.description;
        letter.metadata.description = nextDescription;
      }
      if (body.notes !== undefined) {
        const nextNotes = body.notes ?? undefined;
        metadataChanged = metadataChanged || nextNotes !== letter.metadata.notes;
        letter.metadata.notes = nextNotes;
      }

      if (metadataChanged && letter.metadataContentStatus === 'VERIFIED') {
        clearMetadataVerification(letter);
      } else if (metadataChanged && letter.metadataContentStatus !== 'EDITED') {
        letter.metadataContentStatus = 'EDITED';
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(letter),
      });
      return;
    }

    if (routeFailures.loadLetter) {
      await fulfillFailure(route, routeFailures.loadLetter);
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(letter),
    });
  });

  await page.route(new RegExp(`${escapeRegex(letterPath)}/versions$`), async (route) => {
    const body = route.request().postDataJSON() as MockVersionRequest['body'];
    versionRequests.push({ url: route.request().url(), body });

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        versionNumber: versionRequests.length,
        createdAt: '2025-03-03T00:00:00.000Z',
      }),
    });
  });

  await page.route(new RegExp(`${escapeRegex(letterPath)}/transcribe-letter$`), async (route) => {
    const body = route.request().postDataJSON() as { primarySourceRevision?: number };
    transcribeLetterRequests.push({ url: route.request().url(), body });
    if (routeFailures.transcribeLetter) {
      await fulfillFailure(route, routeFailures.transcribeLetter);
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        letter,
        transcribed: {
          pageCount: letter.transcript.pages.length,
          textLength: letter.transcript.fullText.length,
        },
      }),
    });
  });

  await page.route(new RegExp(`${escapeRegex(letterPath)}/verify-transcript$`), async (route) => {
    verifyTranscriptRequests.push(route.request().url());
    if (routeFailures.verifyTranscript) {
      await fulfillFailure(route, routeFailures.verifyTranscript);
      return;
    }
    letter.transcriptStatus = 'VERIFIED';
    letter.transcript.verified = true;
    letter.transcriptVerifiedAt = TRANSCRIPT_VERIFIED_AT;

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(letter),
    });
  });

  await page.route(new RegExp(`${escapeRegex(letterPath)}/unverify-transcript$`), async (route) => {
    unverifyTranscriptRequests.push(route.request().url());
    letter.transcriptStatus = 'EDITED';
    letter.transcript.verified = false;
    delete letter.transcriptVerifiedAt;

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(letter),
    });
  });

  await page.route(new RegExp(`${escapeRegex(letterPath)}/verify-metadata$`), async (route) => {
    verifyMetadataRequests.push(route.request().url());
    if (routeFailures.verifyMetadata) {
      await fulfillFailure(route, routeFailures.verifyMetadata);
      return;
    }
    letter.metadataContentStatus = 'VERIFIED';
    letter.metadata.verified = true;
    letter.metadataVerifiedAt = METADATA_VERIFIED_AT;

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(letter),
    });
  });

  await page.route(new RegExp(`${escapeRegex(letterPath)}/unverify-metadata$`), async (route) => {
    unverifyMetadataRequests.push(route.request().url());
    letter.metadataContentStatus = 'EDITED';
    letter.metadata.verified = false;
    delete letter.metadataVerifiedAt;

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(letter),
    });
  });

  await page.route(new RegExp(`${escapeRegex(letterPath)}/extra-content$`), async (route) => {
    const body = route.request().postDataJSON() as MockExtraContentRequest['body'];
    updateExtraContentRequests.push({ url: route.request().url(), body });
    if (routeFailures.extraContent) {
      await fulfillFailure(route, routeFailures.extraContent);
      return;
    }

    const nextExtraContent =
      body.extraContent !== undefined
        ? body.extraContent
        : (body.extraContentTranscript ?? '');

    if (!nextExtraContent?.trim()) {
      delete letter.extraContentTranscript;
      letter.extraContentStatus = 'EMPTY';
      delete letter.extraContentVerifiedAt;
    } else {
      letter.extraContentTranscript = nextExtraContent;
      if (
        letter.extraContentStatus === 'EMPTY' ||
        letter.extraContentStatus === 'AI_DRAFT' ||
        letter.extraContentStatus === 'VERIFIED'
      ) {
        letter.extraContentStatus = 'EDITED';
        delete letter.extraContentVerifiedAt;
      }
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(letter),
    });
  });

  await page.route(new RegExp(`${escapeRegex(letterPath)}/ai-notes$`), async (route) => {
    const body = route.request().postDataJSON() as MockAiNotesRequest['body'];
    updateAiNotesRequests.push({ url: route.request().url(), body });
    if (routeFailures.aiNotes) {
      await fulfillFailure(route, routeFailures.aiNotes);
      return;
    }

    letter.aiNotes = body.aiNotes ?? '';

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(letter),
    });
  });

  await page.route(new RegExp(`${escapeRegex(letterPath)}/verify-extra-content$`), async (route) => {
    verifyExtraContentRequests.push(route.request().url());
    if (routeFailures.verifyExtraContent) {
      await fulfillFailure(route, routeFailures.verifyExtraContent);
      return;
    }
    letter.extraContentStatus = 'VERIFIED';
    letter.extraContentVerifiedAt = EXTRA_CONTENT_VERIFIED_AT;

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(letter),
    });
  });

  await page.route(new RegExp(`${escapeRegex(letterPath)}/unverify-extra-content$`), async (route) => {
    unverifyExtraContentRequests.push(route.request().url());
    if (routeFailures.unverifyExtraContent) {
      await fulfillFailure(route, routeFailures.unverifyExtraContent);
      return;
    }
    letter.extraContentStatus = 'EDITED';
    delete letter.extraContentVerifiedAt;

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(letter),
    });
  });

  await page.route(new RegExp(`${escapeRegex(letterPath)}/flag$`), async (route) => {
    const body = route.request().postDataJSON() as { flagged?: boolean };
    flagRequests.push({ url: route.request().url(), body });
    if (routeFailures.flag) {
      await fulfillFailure(route, routeFailures.flag);
      return;
    }

    if (typeof body?.flagged === 'boolean') {
      letter.flagged = body.flagged;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(letter),
    });
  });

  await page.route(new RegExp(`${escapeRegex(API_BASE_URL)}/admin/letters/pages/[^/]+/line-segments$`), async (route) => {
    const pageId = route.request().url().split('/').slice(-2)[0];
    const image = letter.images.find((candidate) => candidate.id === pageId);

    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON() as MockPageLineSegmentsRequest['body'];
      saveLineSegmentRequests.push({
        url: route.request().url(),
        pageId,
        body,
      });
      if (
        !image ||
        body.primarySourceRevision !== letter.primarySourceRevision ||
        body.sourceChecksum !== (image.sourceChecksum ?? null)
      ) {
        await fulfillFailure(route, {
          status: 409,
          error: 'Page source changed; reload before saving segments',
        });
        return;
      }
      if (!Array.isArray(body.lineSegments)) {
        await fulfillFailure(route, {
          status: 400,
          error: 'lineSegments must be an array',
        });
        return;
      }

      image.lineSegments = clone(body.lineSegments);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ lineSegments: image.lineSegments }),
      });
      return;
    }

    detectLineRequests.push(route.request().url());

    const failure = detectLinesFailuresByPageId[pageId];
    if (failure) {
      await route.fulfill({
        status: failure.status ?? 500,
        contentType: 'application/json',
        headers: failure.requestId ? { 'x-request-id': failure.requestId } : undefined,
        body: JSON.stringify({
          error: failure.error,
          requestId: failure.requestId,
        }),
      });
      return;
    }

    const result = detectLinesByPageId[pageId];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        result ?? {
          lineSegments: [],
        },
      ),
    });
  });

  await page.route(new RegExp(`${escapeRegex(API_BASE_URL)}/admin/letters/pages/[^/]+/segment-trust$`), async (route) => {
    const pageId = route.request().url().split('/').slice(-2)[0];
    const image = letter.images.find((candidate) => candidate.id === pageId);
    const body = route.request().postDataJSON() as MockPageSegmentTrustRequest['body'];
    pageSegmentTrustRequests.push({
      url: route.request().url(),
      pageId,
      body,
    });

    if (
      !image ||
      body.primarySourceRevision !== letter.primarySourceRevision ||
      body.sourceChecksum !== (image.sourceChecksum ?? null)
    ) {
      await fulfillFailure(route, {
        status: 409,
        error: 'Page source changed; reload before changing segment trust',
      });
      return;
    }
    if (body.trustState !== 'trusted' && body.trustState !== 'unverified') {
      await fulfillFailure(route, {
        status: 400,
        error: 'Invalid segment trust state',
      });
      return;
    }

    image.segmentTrustState = body.trustState;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true }),
    });
  });

  await page.route(new RegExp(`${escapeRegex(letterPath)}/segment-trust$`), async (route) => {
    const body = route.request().postDataJSON() as MockLetterSegmentTrustRequest['body'];
    letterSegmentTrustRequests.push({
      url: route.request().url(),
      body,
    });
    const letterPages = letter.images.filter((image) => image.type === 'letter');
    const expectedPages = body.pages ?? [];
    const hasExactPageSources =
      expectedPages.length === letterPages.length &&
      letterPages.every((image) => expectedPages.some(
        (pageExpectation) =>
          pageExpectation.pageId === image.id &&
          pageExpectation.sourceChecksum === (image.sourceChecksum ?? null),
      ));

    if (
      body.primarySourceRevision !== letter.primarySourceRevision ||
      !hasExactPageSources
    ) {
      await fulfillFailure(route, {
        status: 409,
        error: 'Letter source changed; reload before changing segment trust',
      });
      return;
    }
    if (body.trustState !== 'trusted' && body.trustState !== 'unverified') {
      await fulfillFailure(route, {
        status: 400,
        error: 'Invalid segment trust state',
      });
      return;
    }

    for (const image of letterPages) {
      image.segmentTrustState = body.trustState;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true }),
    });
  });

  return {
    verifyTranscriptRequests,
    unverifyTranscriptRequests,
    verifyMetadataRequests,
    unverifyMetadataRequests,
    updateExtraContentRequests,
    updateAiNotesRequests,
    verifyExtraContentRequests,
    unverifyExtraContentRequests,
    flagRequests,
    detectLineRequests,
    saveLineSegmentRequests,
    pageSegmentTrustRequests,
    letterSegmentTrustRequests,
    updateLetterRequests,
    versionRequests,
    transcribeLetterRequests,
  };
}
