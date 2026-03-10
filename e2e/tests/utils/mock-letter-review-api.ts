import { access } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { API_BASE_URL } from './test-helpers';

interface MockLetterImage {
  id: string;
  type: string;
  imageUrl: string;
  pageNumber?: number;
  originalFilename?: string;
}

interface MockLetterReviewLetter {
  id: string;
  title: string;
  collectionCode?: string;
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
    dateConfidence?: 'exact' | 'unknown' | 'inferred';
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

interface MockLineCorrectionRequest {
  url: string;
  body: {
    correctionType?: string;
    correctedBbox?: [number, number, number, number];
    sourceSegmentIds?: number[];
  };
}

interface MockUpdateLetterRequest {
  url: string;
  body: {
    transcriptionText?: string;
    sender?: string | null;
    recipient?: string | null;
    locationWritten?: string | null;
    hook?: string | null;
    summary?: string | null;
    notes?: string | null;
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

interface MockResyncRequest {
  url: string;
  body: {
    oldSender?: string | null;
    newSender?: string | null;
    oldRecipient?: string | null;
    newRecipient?: string | null;
  };
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

function createReconciledLine(
  line: number,
  bbox: [number, number, number, number],
  sourceSegmentId: number,
) {
  return {
    line,
    bbox,
    baseline: [
      [bbox[0], bbox[3] - 6],
      [bbox[2], bbox[3] - 6],
    ],
    sourceSegmentIds: [sourceSegmentId],
    wasMerged: false,
    wasExtended: false,
    confidence: 0.94,
    isPhantom: false,
    isPrintedText: false,
    isDeleted: false,
    hppOverlap: 0.78,
    visionWordCount: 0,
  };
}

const defaultDetectLinesByPageId = {
  'collection-009-page-1': {
    lineSegments: [],
    ocrWordBoxes: [],
    reconciledLines: [
      createReconciledLine(1, [170, 210, 1480, 280], 101),
      createReconciledLine(2, [185, 320, 1495, 390], 102),
    ],
  },
  'collection-009-page-2': {
    lineSegments: [],
    ocrWordBoxes: [],
    reconciledLines: [
      createReconciledLine(1, [175, 205, 1490, 275], 201),
      createReconciledLine(2, [190, 315, 1505, 385], 202),
    ],
  },
} as const;

export function createMockDetectLinesByPageId() {
  return clone(defaultDetectLinesByPageId) as Record<
    string,
    {
      lineSegments: unknown[];
      ocrWordBoxes: unknown[];
      reconciledLines: Array<ReturnType<typeof createReconciledLine>>;
    }
  >;
}

const baseLetter: MockLetterReviewLetter = {
  id: 'letter-review-1',
  title: 'Review Letter One',
  collectionCode: '009',
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
    dateConfidence: 'exact',
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
  verifyExtraContentRequests: string[];
  unverifyExtraContentRequests: string[];
  resyncCheckRequests: MockResyncRequest[];
  resyncRequests: MockResyncRequest[];
  flagRequests: Array<{ url: string; body: unknown }>;
  detectLineRequests: string[];
  lineCorrectionRequests: MockLineCorrectionRequest[];
  updateLetterRequests: MockUpdateLetterRequest[];
  versionRequests: MockVersionRequest[];
}

export async function installMockLetterReviewApi(
  page: Page,
  options: {
    initialLetter?: MockLetterReviewLetter;
    detectLinesByPageId?: Record<
      string,
      {
        lineSegments: unknown[];
        ocrWordBoxes: unknown[];
        reconciledLines: Array<ReturnType<typeof createReconciledLine>>;
      }
    >;
  } = {},
): Promise<MockLetterReviewContext> {
  const letter = clone(options.initialLetter ?? baseLetter);
  const verifyTranscriptRequests: string[] = [];
  const unverifyTranscriptRequests: string[] = [];
  const verifyMetadataRequests: string[] = [];
  const unverifyMetadataRequests: string[] = [];
  const updateExtraContentRequests: MockExtraContentRequest[] = [];
  const verifyExtraContentRequests: string[] = [];
  const unverifyExtraContentRequests: string[] = [];
  const resyncCheckRequests: MockResyncRequest[] = [];
  const resyncRequests: MockResyncRequest[] = [];
  const flagRequests: Array<{ url: string; body: unknown }> = [];
  const detectLineRequests: string[] = [];
  const lineCorrectionRequests: MockLineCorrectionRequest[] = [];
  const updateLetterRequests: MockUpdateLetterRequest[] = [];
  const versionRequests: MockVersionRequest[] = [];
  const letterPath = `${API_BASE_URL}/admin/letters/${letter.id}`;
  const detectLinesByPageId = options.detectLinesByPageId
    ? clone(options.detectLinesByPageId)
    : createMockDetectLinesByPageId();

  await page.addInitScript(() => {
    sessionStorage.setItem('adminAuth', 'true');
    localStorage.removeItem('letterViewerState');
  });

  await page.route(new RegExp(`${escapeRegex(API_BASE_URL)}/mock-assets/collection-009/.*$`), async (route) => {
    const asset = collection009ImageFixtures.find(
      (candidate) => `${API_BASE_URL}${candidate.imageUrl}` === route.request().url(),
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

      if (typeof body.transcriptionText === 'string') {
        letter.transcript.fullText = body.transcriptionText;
        const pageTexts = splitTranscriptByPage(body.transcriptionText, letter.images.length);
        letter.transcript.pages = pageTexts.map((text, index) => ({
          pageNumber: index + 1,
          text,
        }));
      }

      if (body.sender !== undefined) letter.metadata.sender = body.sender ?? undefined;
      if (body.recipient !== undefined) letter.metadata.recipient = body.recipient ?? undefined;
      if (body.locationWritten !== undefined) letter.metadata.location = body.locationWritten ?? undefined;
      if (body.hook !== undefined) letter.metadata.hook = body.hook ?? undefined;
      if (body.summary !== undefined) letter.metadata.description = body.summary ?? undefined;
      if (body.notes !== undefined) letter.metadata.notes = body.notes ?? undefined;

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(letter),
      });
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

  await page.route(new RegExp(`${escapeRegex(letterPath)}/verify-transcript$`), async (route) => {
    verifyTranscriptRequests.push(route.request().url());
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

  await page.route(new RegExp(`${escapeRegex(letterPath)}/verify-extra-content$`), async (route) => {
    verifyExtraContentRequests.push(route.request().url());
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
    letter.extraContentStatus = 'EDITED';
    delete letter.extraContentVerifiedAt;

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(letter),
    });
  });

  await page.route(new RegExp(`${escapeRegex(letterPath)}/resync-check$`), async (route) => {
    const body = route.request().postDataJSON() as MockResyncRequest['body'];
    resyncCheckRequests.push({ url: route.request().url(), body });

    const needsResync =
      body.oldSender !== body.newSender || body.oldRecipient !== body.newRecipient;

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        needsResync,
        decision: {
          shouldUpdateSummary: needsResync,
          shouldUpdateHook: needsResync,
          shouldCreateSenderPerson: Boolean(needsResync && body.newSender && body.oldSender !== body.newSender),
          shouldCreateRecipientPerson: Boolean(
            needsResync && body.newRecipient && body.oldRecipient !== body.newRecipient,
          ),
          shouldUpdateRelationship: false,
          shouldUpdateQuoteContexts: false,
          issues: needsResync ? ['Identity fields changed'] : [],
          reason: needsResync ? 'Identity changed' : 'Already in sync',
        },
      }),
    });
  });

  await page.route(new RegExp(`${escapeRegex(letterPath)}/resync$`), async (route) => {
    const body = route.request().postDataJSON() as MockResyncRequest['body'];
    resyncRequests.push({ url: route.request().url(), body });

    letter.metadata.sender = body.newSender ?? undefined;
    letter.metadata.recipient = body.newRecipient ?? undefined;
    letter.metadata.description = body.newRecipient
      ? `${body.newSender ?? 'Unknown sender'} metadata synced for ${body.newRecipient}.`
      : `${body.newSender ?? 'Unknown sender'} metadata synced for the review record.`;
    letter.metadata.hook = body.newSender
      ? `Synced metadata for ${body.newSender}.`
      : 'Synced metadata.';

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        letter,
        resync: {
          wasUpdated: true,
          updatedFields: {
            summary: true,
            hook: true,
            senderPerson: Boolean(body.newSender && body.oldSender !== body.newSender),
            recipientPerson: Boolean(body.newRecipient && body.oldRecipient !== body.newRecipient),
            relationshipType: false,
            quoteContexts: false,
          },
          decision: {
            shouldUpdateSummary: true,
            shouldUpdateHook: true,
            shouldCreateSenderPerson: Boolean(body.newSender && body.oldSender !== body.newSender),
            shouldCreateRecipientPerson: Boolean(body.newRecipient && body.oldRecipient !== body.newRecipient),
            shouldUpdateRelationship: false,
            shouldUpdateQuoteContexts: false,
            issues: ['Identity fields changed'],
            reason: 'Identity changed',
          },
        },
      }),
    });
  });

  await page.route(new RegExp(`${escapeRegex(letterPath)}/flag$`), async (route) => {
    const body = route.request().postDataJSON() as { flagged?: boolean };
    flagRequests.push({ url: route.request().url(), body });

    if (typeof body?.flagged === 'boolean') {
      letter.flagged = body.flagged;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(letter),
    });
  });

  await page.route(new RegExp(`${escapeRegex(API_BASE_URL)}/admin/letters/pages/[^/]+/detect-lines$`), async (route) => {
    const pageId = route.request().url().split('/').slice(-2)[0];
    detectLineRequests.push(route.request().url());

    const result = detectLinesByPageId[pageId];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        result ?? {
          lineSegments: [],
          ocrWordBoxes: [],
          reconciledLines: [],
        },
      ),
    });
  });

  await page.route(new RegExp(`${escapeRegex(API_BASE_URL)}/admin/letters/pages/[^/]+/line-corrections$`), async (route) => {
    const pageId = route.request().url().split('/').slice(-2)[0];
    const body = route.request().postDataJSON() as MockLineCorrectionRequest['body'];
    lineCorrectionRequests.push({ url: route.request().url(), body });

    const current = detectLinesByPageId[pageId] ?? {
      lineSegments: [],
      ocrWordBoxes: [],
      reconciledLines: [],
    };

    const targetIndex = current.reconciledLines.findIndex((line) => {
      if (!Array.isArray(body.sourceSegmentIds) || body.sourceSegmentIds.length === 0) {
        return false;
      }

      return line.sourceSegmentIds.join(',') === body.sourceSegmentIds.join(',');
    });

    if (targetIndex >= 0) {
      const target = current.reconciledLines[targetIndex];
      if (body.correctionType === 'delete' || body.correctionType === 'confirm_phantom') {
        target.isDeleted = true;
      }
      if (body.correctionType === 'undelete' || body.correctionType === 'reject_phantom') {
        target.isDeleted = false;
      }
      if (body.correctionType === 'resize' && body.correctedBbox) {
        target.bbox = body.correctedBbox;
        target.baseline = [
          [body.correctedBbox[0], body.correctedBbox[3] - 6],
          [body.correctedBbox[2], body.correctedBbox[3] - 6],
        ];
      }
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        correction: { ok: true },
        reconciledLines: current.reconciledLines,
      }),
    });
  });

  return {
    verifyTranscriptRequests,
    unverifyTranscriptRequests,
    verifyMetadataRequests,
    unverifyMetadataRequests,
    updateExtraContentRequests,
    verifyExtraContentRequests,
    unverifyExtraContentRequests,
    resyncCheckRequests,
    resyncRequests,
    flagRequests,
    detectLineRequests,
    lineCorrectionRequests,
    updateLetterRequests,
    versionRequests,
  };
}
