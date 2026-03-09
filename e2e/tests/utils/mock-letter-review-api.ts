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
  createdAt: string;
  updatedAt?: string;
  transcriptVerifiedAt?: string;
  metadataVerifiedAt?: string;
  flagged: boolean;
  linkedPersons?: unknown[];
  linkedPlaces?: unknown[];
  entityExtractionStatus?: string;
  entityExtractionJson?: unknown;
}

type MockLetterReviewOverrides = Partial<MockLetterReviewLetter> & {
  transcript?: Partial<MockLetterReviewLetter['transcript']>;
  metadata?: Partial<MockLetterReviewLetter['metadata']>;
};

const TRANSCRIPT_VERIFIED_AT = '2025-03-01T00:00:00.000Z';
const METADATA_VERIFIED_AT = '2025-03-02T00:00:00.000Z';
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

const baseLetter: MockLetterReviewLetter = {
  id: 'letter-review-1',
  title: 'Review Letter One',
  collectionCode: '009',
  images: collection009ImageFixtures.map(({ filePath: _filePath, ...image }) => image),
  transcript: {
    pages: [
      {
        pageNumber: 1,
        text: 'My dear mother,\nI arrived safely in Boston.\nLove, Alice',
      },
    ],
    fullText: 'My dear mother,\nI arrived safely in Boston.\nLove, Alice',
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
  flagRequests: Array<{ url: string; body: unknown }>;
}

export async function installMockLetterReviewApi(
  page: Page,
  options: { initialLetter?: MockLetterReviewLetter } = {},
): Promise<MockLetterReviewContext> {
  const letter = clone(options.initialLetter ?? baseLetter);
  const verifyTranscriptRequests: string[] = [];
  const unverifyTranscriptRequests: string[] = [];
  const verifyMetadataRequests: string[] = [];
  const unverifyMetadataRequests: string[] = [];
  const flagRequests: Array<{ url: string; body: unknown }> = [];
  const letterPath = `${API_BASE_URL}/admin/letters/${letter.id}`;

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
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(letter),
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

  return {
    verifyTranscriptRequests,
    unverifyTranscriptRequests,
    verifyMetadataRequests,
    unverifyMetadataRequests,
    flagRequests,
  };
}
