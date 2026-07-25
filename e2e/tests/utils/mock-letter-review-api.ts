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

interface MockStructuredNote {
  id: string;
  content: string;
  category: 'identity' | 'date' | 'transcription' | 'relationship' | 'context' | 'cross-reference' | 'location' | 'condition';
  priority: 'high' | 'medium' | 'low';
  status: 'open' | 'resolved' | 'dismissed';
  resolves_when: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  source: 'ai' | 'admin';
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
    extractedDate?: string;
    dateRaw?: string;
    location?: string;
    description?: string;
    hook?: string;
    notes?: string;
    emotionalTone?: string;
    senderRecipientRelationship?: string;
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
  readingText?: string;
  photoDescriptionStatus?: 'EMPTY' | 'AI_DRAFT' | 'EDITED' | 'VERIFIED';
  photoDescription?: string;
  photoDescriptionContext?: string;
  createdAt: string;
  updatedAt?: string;
  transcriptConfirmedAt?: string;
  transcriptVerifiedAt?: string;
  metadataVerifiedAt?: string;
  extraContentVerifiedAt?: string;
  photoDescriptionVerifiedAt?: string;
  flagged: boolean;
  linkedPersons?: unknown[];
  linkedPlaces?: unknown[];
  entityExtractionStatus?: string;
  entityExtractionJson?: unknown;
  aiNotes?: MockStructuredNote[] | string | null;
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
    extractedDate?: string | null;
    emotionalTone?: string | null;
    senderRecipientRelationship?: string | null;
    primaryTopics?: string[] | null;
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
    primarySourceRevision?: number;
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
    primarySourceRevision?: number;
  };
}

interface MockPhotoDescriptionRequest {
  url: string;
  body: {
    photoDescription?: string;
    photoDescriptionContext?: string;
    primarySourceRevision?: number;
  };
}

type MockReExtractMode = 'full' | 'metadata_only' | 'entities_only';

interface MockAnalysisRegenerationRequest {
  url: string;
  body: {
    primarySourceRevision?: number;
    confirmedSender?: string;
    confirmedRecipient?: string;
    mode?: MockReExtractMode;
  };
}

interface MockTranscriptConfirmationRequest {
  url: string;
  body: {
    primarySourceRevision?: number;
    confirmedSender?: string;
    confirmedRecipient?: string;
  };
}

interface MockAiNotesRequest {
  url: string;
  body: {
    aiNotes?: string | null;
  };
}

interface MockNoteStatusRequest {
  url: string;
  noteId: string;
  body: {
    primarySourceRevision?: number;
    status?: 'resolved' | 'dismissed';
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
const PHOTO_DESCRIPTION_VERIFIED_AT = '2025-03-04T00:00:00.000Z';
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

function createRegeneratedEntity(name: string) {
  return {
    name,
    aliases: [],
    role: 'mentioned' as const,
    relationship_to_sender: null,
    details: [],
    emotional_significance: null,
    quotes: [],
    confidence: 0.96,
  };
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
  photoDescriptionStatus: 'EMPTY',
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
  describePhotoRequests: MockPhotoDescriptionRequest[];
  updatePhotoDescriptionRequests: MockPhotoDescriptionRequest[];
  verifyPhotoDescriptionRequests: string[];
  unverifyPhotoDescriptionRequests: string[];
  updateAiNotesRequests: MockAiNotesRequest[];
  noteStatusRequests: MockNoteStatusRequest[];
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
  transcribeExtrasRequests: Array<{
    url: string;
    body: { primarySourceRevision?: number };
  }>;
  generateReadingViewRequests: Array<{
    url: string;
    body: { primarySourceRevision?: number };
  }>;
  confirmTranscriptRequests: MockTranscriptConfirmationRequest[];
  regenerateMetadataRequests: MockAnalysisRegenerationRequest[];
  reExtractRequests: MockAnalysisRegenerationRequest[];
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
        | 'transcribeExtras'
        | 'generateReadingView'
        | 'confirmTranscript'
        | 'regenerateMetadata'
        | 'reExtract'
        | 'verifyMetadata'
        | 'extraContent'
        | 'describePhoto'
        | 'photoDescription'
        | 'verifyPhotoDescription'
        | 'unverifyPhotoDescription'
        | 'aiNotes'
        | 'noteStatus'
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
  const describePhotoRequests: MockPhotoDescriptionRequest[] = [];
  const updatePhotoDescriptionRequests: MockPhotoDescriptionRequest[] = [];
  const verifyPhotoDescriptionRequests: string[] = [];
  const unverifyPhotoDescriptionRequests: string[] = [];
  const updateAiNotesRequests: MockAiNotesRequest[] = [];
  const noteStatusRequests: MockNoteStatusRequest[] = [];
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
  const transcribeExtrasRequests: MockLetterReviewContext['transcribeExtrasRequests'] = [];
  const generateReadingViewRequests: MockLetterReviewContext['generateReadingViewRequests'] = [];
  const confirmTranscriptRequests: MockLetterReviewContext['confirmTranscriptRequests'] = [];
  const regenerateMetadataRequests: MockLetterReviewContext['regenerateMetadataRequests'] = [];
  const reExtractRequests: MockLetterReviewContext['reExtractRequests'] = [];
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
      if (body.extractedDate !== undefined) {
        const nextDate = body.extractedDate ?? undefined;
        metadataChanged = metadataChanged
          || nextDate !== letter.metadata.extractedDate;
        letter.metadata.extractedDate = nextDate;
      }
      if (body.emotionalTone !== undefined) {
        const nextTone = body.emotionalTone ?? undefined;
        metadataChanged = metadataChanged
          || nextTone !== letter.metadata.emotionalTone;
        letter.metadata.emotionalTone = nextTone;
      }
      if (body.senderRecipientRelationship !== undefined) {
        const nextRelationship = (
          body.senderRecipientRelationship ?? undefined
        );
        metadataChanged = metadataChanged
          || nextRelationship
            !== letter.metadata.senderRecipientRelationship;
        letter.metadata.senderRecipientRelationship = nextRelationship;
      }
      if (body.primaryTopics !== undefined) {
        const nextTopics = body.primaryTopics ?? undefined;
        metadataChanged = metadataChanged
          || JSON.stringify(nextTopics)
            !== JSON.stringify(letter.metadata.primaryTopics);
        letter.metadata.primaryTopics = nextTopics;
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

  await page.route(new RegExp(`${escapeRegex(letterPath)}/transcribe-extras$`), async (route) => {
    const body = route.request().postDataJSON() as {
      primarySourceRevision?: number;
    };
    transcribeExtrasRequests.push({ url: route.request().url(), body });
    if (routeFailures.transcribeExtras) {
      await fulfillFailure(route, routeFailures.transcribeExtras);
      return;
    }
    if (body.primarySourceRevision !== letter.primarySourceRevision) {
      await fulfillFailure(route, {
        status: 409,
        error: 'Letter source changed; reload before transcribing extras',
        code: 'SOURCE_REVISION_CHANGED',
      });
      return;
    }

    letter.extraContentTranscript = 'AI-transcribed extra content.';
    letter.extraContentStatus = 'AI_DRAFT';
    delete letter.extraContentVerifiedAt;

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        letter,
        transcribedCount: 1,
        extraContentStatus: 'AI_DRAFT',
      }),
    });
  });

  await page.route(new RegExp(`${escapeRegex(letterPath)}/generate-reading-view$`), async (route) => {
    const body = route.request().postDataJSON() as {
      primarySourceRevision?: number;
    };
    generateReadingViewRequests.push({
      url: route.request().url(),
      body,
    });
    if (routeFailures.generateReadingView) {
      await fulfillFailure(route, routeFailures.generateReadingView);
      return;
    }
    if (body.primarySourceRevision !== letter.primarySourceRevision) {
      await fulfillFailure(route, {
        status: 409,
        error: 'Letter source changed; reload before generating a reading view',
        code: 'SOURCE_REVISION_CHANGED',
      });
      return;
    }

    letter.readingText = [
      'My dear mother,',
      'I arrived safely in Boston. The weather has been kind.',
      'Love, Alice',
    ].join('\n\n');

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(letter),
    });
  });

  await page.route(new RegExp(`${escapeRegex(letterPath)}/confirm-transcript$`), async (route) => {
    const body = route.request().postDataJSON() as MockTranscriptConfirmationRequest['body'];
    confirmTranscriptRequests.push({
      url: route.request().url(),
      body,
    });
    if (routeFailures.confirmTranscript) {
      await fulfillFailure(route, routeFailures.confirmTranscript);
      return;
    }
    if (body.primarySourceRevision !== letter.primarySourceRevision) {
      await fulfillFailure(route, {
        status: 409,
        error: 'Letter source changed; reload before confirming its transcript',
        code: 'SOURCE_REVISION_CHANGED',
      });
      return;
    }

    letter.transcriptConfirmedAt = '2025-03-05T00:00:00.000Z';
    if (body.confirmedSender !== undefined) {
      letter.metadata.sender = body.confirmedSender;
    }
    if (body.confirmedRecipient !== undefined) {
      letter.metadata.recipient = body.confirmedRecipient;
    }
    letter.metadata.location = 'Confirmed Response Location';
    letter.metadata.hook = 'Confirmation response hydrated.';
    letter.metadataContentStatus = 'AI_DRAFT';
    letter.metadata.verified = false;
    delete letter.metadataVerifiedAt;
    letter.workflowState = 'METADATA_DRAFTED';
    letter.entityExtractionStatus = 'SUCCESS';
    letter.entityExtractionJson = {
      people: [createRegeneratedEntity('Confirmation Result Entity')],
      places: [],
      relationships: [],
      person_place_connections: [],
    };

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(letter),
    });
  });

  await page.route(new RegExp(`${escapeRegex(letterPath)}/regenerate-metadata$`), async (route) => {
    const body = route.request().postDataJSON() as MockAnalysisRegenerationRequest['body'];
    regenerateMetadataRequests.push({
      url: route.request().url(),
      body,
    });
    if (routeFailures.regenerateMetadata) {
      await fulfillFailure(route, routeFailures.regenerateMetadata);
      return;
    }
    if (body.primarySourceRevision !== letter.primarySourceRevision) {
      await fulfillFailure(route, {
        status: 409,
        error: 'Letter source changed; reload before regenerating metadata',
        code: 'SOURCE_REVISION_CHANGED',
      });
      return;
    }
    if (!letter.transcriptConfirmedAt) {
      await fulfillFailure(route, {
        status: 400,
        error: 'Transcript must be confirmed before regenerating metadata',
      });
      return;
    }

    if (body.confirmedSender !== undefined) {
      letter.metadata.sender = body.confirmedSender;
    }
    if (body.confirmedRecipient !== undefined) {
      letter.metadata.recipient = body.confirmedRecipient;
    }
    letter.metadata.location = 'Regenerated Location';
    letter.metadata.hook = 'Metadata analysis regenerated.';
    letter.metadataContentStatus = 'AI_DRAFT';
    letter.metadata.verified = false;
    delete letter.metadataVerifiedAt;
    letter.entityExtractionStatus = 'SUCCESS';
    letter.entityExtractionJson = {
      people: [createRegeneratedEntity('Metadata Phase Entity')],
      places: [],
      relationships: [],
      person_place_connections: [],
    };

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(letter),
    });
  });

  await page.route(new RegExp(`${escapeRegex(letterPath)}/re-extract$`), async (route) => {
    const body = route.request().postDataJSON() as MockAnalysisRegenerationRequest['body'];
    reExtractRequests.push({
      url: route.request().url(),
      body,
    });
    if (routeFailures.reExtract) {
      await fulfillFailure(route, routeFailures.reExtract);
      return;
    }
    if (body.primarySourceRevision !== letter.primarySourceRevision) {
      await fulfillFailure(route, {
        status: 409,
        error: 'Letter source changed; reload before re-extracting content',
        code: 'SOURCE_REVISION_CHANGED',
      });
      return;
    }
    if (
      body.mode !== 'full'
      && body.mode !== 'metadata_only'
      && body.mode !== 'entities_only'
    ) {
      await fulfillFailure(route, {
        status: 400,
        error: 'Invalid re-extraction mode',
      });
      return;
    }
    if (body.mode !== 'entities_only' && !letter.transcriptConfirmedAt) {
      await fulfillFailure(route, {
        status: 400,
        error: 'Transcript must be confirmed before re-extracting metadata',
      });
      return;
    }

    if (body.mode !== 'entities_only') {
      if (body.confirmedSender !== undefined) {
        letter.metadata.sender = body.confirmedSender;
      }
      if (body.confirmedRecipient !== undefined) {
        letter.metadata.recipient = body.confirmedRecipient;
      }
      letter.metadata.hook = body.mode === 'full'
        ? 'Full analysis regenerated.'
        : 'Metadata re-extraction completed.';
      letter.metadataContentStatus = 'AI_DRAFT';
      letter.metadata.verified = false;
      delete letter.metadataVerifiedAt;
    }
    const entityName = body.mode === 'entities_only'
      ? 'Entities Only Result'
      : body.mode === 'full'
        ? 'Full Analysis Result'
        : 'Metadata Re-extraction Result';
    letter.entityExtractionStatus = 'SUCCESS';
    letter.entityExtractionJson = {
      people: [createRegeneratedEntity(entityName)],
      places: [],
      relationships: [],
      person_place_connections: [],
    };

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(letter),
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

  await page.route(new RegExp(`${escapeRegex(letterPath)}/describe-photo$`), async (route) => {
    const body = route.request().postDataJSON() as MockPhotoDescriptionRequest['body'];
    describePhotoRequests.push({ url: route.request().url(), body });
    if (routeFailures.describePhoto) {
      await fulfillFailure(route, routeFailures.describePhoto);
      return;
    }
    if (body.primarySourceRevision !== letter.primarySourceRevision) {
      await fulfillFailure(route, {
        status: 409,
        error: 'Letter source changed; reload before describing this photo',
        code: 'SOURCE_REVISION_CHANGED',
      });
      return;
    }

    letter.photoDescription =
      'A black-and-white family photograph taken on a front porch.';
    letter.photoDescriptionContext = body.photoDescriptionContext ?? '';
    letter.photoDescriptionStatus = 'AI_DRAFT';
    delete letter.photoDescriptionVerifiedAt;

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        letter,
        describedCount: 1,
        photoDescriptionStatus: 'AI_DRAFT',
      }),
    });
  });

  await page.route(new RegExp(`${escapeRegex(letterPath)}/photo-description$`), async (route) => {
    const body = route.request().postDataJSON() as MockPhotoDescriptionRequest['body'];
    updatePhotoDescriptionRequests.push({ url: route.request().url(), body });
    if (routeFailures.photoDescription) {
      await fulfillFailure(route, routeFailures.photoDescription);
      return;
    }
    if (body.primarySourceRevision !== letter.primarySourceRevision) {
      await fulfillFailure(route, {
        status: 409,
        error: 'Letter source changed; reload before saving this description',
        code: 'SOURCE_REVISION_CHANGED',
      });
      return;
    }

    letter.photoDescription = body.photoDescription ?? '';
    letter.photoDescriptionStatus = letter.photoDescription.trim()
      ? 'EDITED'
      : 'EMPTY';
    delete letter.photoDescriptionVerifiedAt;

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(letter),
    });
  });

  await page.route(new RegExp(`${escapeRegex(letterPath)}/verify-photo-description$`), async (route) => {
    verifyPhotoDescriptionRequests.push(route.request().url());
    if (routeFailures.verifyPhotoDescription) {
      await fulfillFailure(route, routeFailures.verifyPhotoDescription);
      return;
    }
    letter.photoDescriptionStatus = 'VERIFIED';
    letter.photoDescriptionVerifiedAt = PHOTO_DESCRIPTION_VERIFIED_AT;

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(letter),
    });
  });

  await page.route(new RegExp(`${escapeRegex(letterPath)}/unverify-photo-description$`), async (route) => {
    unverifyPhotoDescriptionRequests.push(route.request().url());
    if (routeFailures.unverifyPhotoDescription) {
      await fulfillFailure(route, routeFailures.unverifyPhotoDescription);
      return;
    }
    letter.photoDescriptionStatus = 'EDITED';
    delete letter.photoDescriptionVerifiedAt;

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

  await page.route(
    new RegExp(`${escapeRegex(letterPath)}/notes/[^/]+$`),
    async (route) => {
      const body =
        route.request().postDataJSON() as MockNoteStatusRequest['body'];
      const noteId = decodeURIComponent(
        new URL(route.request().url()).pathname.split('/').pop() ?? '',
      );
      noteStatusRequests.push({
        url: route.request().url(),
        noteId,
        body,
      });
      if (routeFailures.noteStatus) {
        await fulfillFailure(route, routeFailures.noteStatus);
        return;
      }
      if (body.primarySourceRevision !== letter.primarySourceRevision) {
        await fulfillFailure(route, {
          status: 409,
          error: 'Letter source changed; reload before updating the note',
        });
        return;
      }

      const notes = Array.isArray(letter.aiNotes) ? letter.aiNotes : [];
      const note = notes.find((candidate) => candidate.id === noteId);
      if (!note || !body.status) {
        await fulfillFailure(route, {
          status: 404,
          error: 'Note not found',
        });
        return;
      }
      note.status = body.status;
      note.resolved_at = '2026-07-24T12:00:00.000Z';
      note.resolved_by = 'mock-admin';

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(letter),
      });
    },
  );

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
    describePhotoRequests,
    updatePhotoDescriptionRequests,
    verifyPhotoDescriptionRequests,
    unverifyPhotoDescriptionRequests,
    updateAiNotesRequests,
    noteStatusRequests,
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
    transcribeExtrasRequests,
    generateReadingViewRequests,
    confirmTranscriptRequests,
    regenerateMetadataRequests,
    reExtractRequests,
  };
}
