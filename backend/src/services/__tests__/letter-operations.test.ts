import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  findFirstMock,
  findManyMock,
  dbUpdateMock,
  updateSetMock,
  updateWhereMock,
  dbDeleteMock,
  deleteWhereMock,
  runTranscriptionMock,
} = vi.hoisted(() => ({
  findFirstMock: vi.fn(),
  findManyMock: vi.fn(),
  dbUpdateMock: vi.fn(),
  updateSetMock: vi.fn(),
  updateWhereMock: vi.fn(),
  dbDeleteMock: vi.fn(),
  deleteWhereMock: vi.fn(),
  runTranscriptionMock: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((field: unknown, value: unknown) => ({ kind: 'eq', field, value })),
  and: vi.fn((...clauses: unknown[]) => ({ kind: 'and', clauses })),
  inArray: vi.fn((field: unknown, values: unknown[]) => ({ kind: 'inArray', field, values })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    kind: 'sql',
    strings: Array.from(strings),
    values,
  })),
}));

vi.mock('../../db/index.js', () => {
  dbUpdateMock.mockImplementation(() => ({
    set: updateSetMock,
  }));
  updateSetMock.mockImplementation(() => ({
    where: updateWhereMock,
  }));
  dbDeleteMock.mockImplementation(() => ({
    where: deleteWhereMock,
  }));

  return {
    db: {
      query: {
        letters: {
          findFirst: findFirstMock,
          findMany: findManyMock,
        },
      },
      update: dbUpdateMock,
      delete: dbDeleteMock,
    },
    letters: {
      id: 'letters.id',
      collectionId: 'letters.collectionId',
      dateRaw: 'letters.dateRaw',
      typeSequence: 'letters.typeSequence',
      type: 'letters.type',
    },
    letterVersions: {
      letterId: 'letterVersions.letterId',
    },
    letterPersons: {
      letterId: 'letterPersons.letterId',
    },
    letterPlaces: {
      letterId: 'letterPlaces.letterId',
    },
    canonicalPersons: {
      id: 'canonicalPersons.id',
    },
    canonicalPlaces: {
      id: 'canonicalPlaces.id',
    },
    personRelationships: {
      discoveredInLetterId: 'personRelationships.discoveredInLetterId',
    },
  };
});

vi.mock('../letters.js', () => ({
  getLetterById: vi.fn(),
}));

vi.mock('../../pipeline/processor.js', () => ({
  runTranscription: runTranscriptionMock,
}));

vi.mock('../../pipeline/metadataV2.js', () => ({
  runMetadataExtractionV2: vi.fn(),
  runEntityExtractionOnly: vi.fn(),
}));

vi.mock('../../ai/resync.js', () => ({
  resyncMetadata: vi.fn(),
  auditMetadata: vi.fn(),
}));

vi.mock('../../ai/openai.js', () => ({
  checkExtraContentForText: vi.fn(),
  transcribeExtraContent: vi.fn(),
  transcribeImage: vi.fn(),
}));

vi.mock('../storage.js', () => ({
  getAbsoluteStoragePath: vi.fn((value: string) => value),
}));

vi.mock('../line-finder.js', () => ({
  detectAndStoreLinesForPages: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('../processing-queue.js', () => ({
  getProcessingStatus: vi.fn(),
  resetProcessingState: vi.fn(),
  processLettersAsync: vi.fn(),
}));

vi.mock('../entities/participant-sync.js', () => ({
  syncLetterParticipantsFromMetadata: vi.fn(),
}));

import {
  bulkClearMetadata,
  normalizeRelationshipType,
  regenerateTranscription,
  transcribeLetterOnly,
} from '../letter-operations.js';

describe('letter operations service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateWhereMock.mockResolvedValue(undefined);
    deleteWhereMock.mockResolvedValue(undefined);
    findManyMock.mockResolvedValue([]);
  });

  it('normalizes common AI relationship variants', () => {
    expect(normalizeRelationshipType('fiance')).toBe('fiancé/fiancée');
    expect(normalizeRelationshipType('coworker')).toBe('business-associate');
    expect(normalizeRelationshipType('something unexpected')).toBe('unknown');
  });

  it('clears stored metadata JSON when metadata is bulk-cleared', async () => {
    const result = await bulkClearMetadata(['letter-1', 'letter-2']);

    expect(result).toEqual({
      message: 'Metadata cleared',
      updated: 2,
    });
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sender: null,
        recipient: null,
        metadataStatus: 'PENDING',
        metadataError: null,
        metadataJson: null,
        metadataV2Json: null,
        entityExtractionJson: null,
        entityExtractionStatus: 'PENDING',
        entityExtractionError: null,
        workflow: 'TRANSCRIBED',
        updatedAt: expect.any(Date),
      }),
    );
  });

  it('does not reset transcription state when letter-only transcription is rejected for missing pages', async () => {
    findFirstMock.mockResolvedValue({
      id: 'letter-3',
      type: 'L',
      collection: { collectionCode: '009' },
      dateRaw: '19470810',
      pages: [],
    });

    await expect(transcribeLetterOnly('letter-3')).rejects.toMatchObject({
      message: 'Letter has no pages to transcribe',
      status: 400,
    });
    expect(dbUpdateMock).not.toHaveBeenCalled();
    expect(runTranscriptionMock).not.toHaveBeenCalled();
  });

  it('does not reset transcription state when regeneration is rejected for missing pages', async () => {
    findFirstMock.mockResolvedValue({
      id: 'letter-4',
      type: 'L',
      collection: { collectionCode: '009' },
      dateRaw: '19470810',
      pages: [],
    });

    await expect(regenerateTranscription('letter-4', false)).rejects.toMatchObject({
      message: 'Letter has no pages to transcribe',
      status: 400,
    });
    expect(dbUpdateMock).not.toHaveBeenCalled();
    expect(runTranscriptionMock).not.toHaveBeenCalled();
  });
});
