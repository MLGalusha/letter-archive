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
  getLetterByIdMock,
  syncLetterParticipantsFromMetadataMock,
  checkExtraContentForTextMock,
  transcribeExtraContentMock,
  getAbsoluteStoragePathMock,
} = vi.hoisted(() => ({
  findFirstMock: vi.fn(),
  findManyMock: vi.fn(),
  dbUpdateMock: vi.fn(),
  updateSetMock: vi.fn(),
  updateWhereMock: vi.fn(),
  dbDeleteMock: vi.fn(),
  deleteWhereMock: vi.fn(),
  runTranscriptionMock: vi.fn(),
  getLetterByIdMock: vi.fn(),
  syncLetterParticipantsFromMetadataMock: vi.fn(),
  checkExtraContentForTextMock: vi.fn(),
  transcribeExtraContentMock: vi.fn(),
  getAbsoluteStoragePathMock: vi.fn((value: string) => value),
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
  getLetterById: getLetterByIdMock,
}));

vi.mock('../../pipeline/processor.js', () => ({
  runTranscription: runTranscriptionMock,
}));

vi.mock('../../pipeline/metadataV2.js', () => ({
  runMetadataExtractionV2: vi.fn(),
  runEntityExtractionOnly: vi.fn(),
}));

vi.mock('../../ai/openai.js', () => ({
  checkExtraContentForText: checkExtraContentForTextMock,
  transcribeExtraContent: transcribeExtraContentMock,
  transcribeImage: vi.fn(),
}));

vi.mock('../storage.js', () => ({
  getAbsoluteStoragePath: getAbsoluteStoragePathMock,
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
  syncLetterParticipantsFromMetadata: syncLetterParticipantsFromMetadataMock,
}));

import {
  bulkClearMetadata,
  buildLetterUpdates,
  normalizeRelationshipType,
  regenerateTranscription,
  transcribeExtras,
  transcribeLetterOnly,
  updateExtraContent,
} from '../letter-operations.js';

describe('letter operations service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateWhereMock.mockResolvedValue(undefined);
    deleteWhereMock.mockResolvedValue(undefined);
    findManyMock.mockResolvedValue([]);
    getLetterByIdMock.mockResolvedValue(undefined);
    getAbsoluteStoragePathMock.mockImplementation((value: string) => value);
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
        metadataStatus: 'FAILED',
        metadataError: 'Cleared by admin',
        metadataJson: null,
        metadataV2Json: null,
        entityExtractionJson: null,
        entityExtractionStatus: 'FAILED',
        entityExtractionError: 'Cleared by admin',
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

  it('drops verified transcript edits back to edited in direct letter updates', async () => {
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-verified-transcript',
      workflow: 'TRANSCRIBED',
      transcriptStatus: 'VERIFIED',
      metadataContentStatus: 'EDITED',
    });

    const result = await buildLetterUpdates('letter-verified-transcript', {
      transcriptionText: 'Corrected transcript text',
    });

    expect(result).not.toBeNull();
    expect(result?.dbUpdates).toEqual({
      transcriptionText: 'Corrected transcript text',
      transcriptStatus: 'EDITED',
      transcriptVerifiedAt: null,
      transcriptVerifiedBy: null,
      updatedAt: expect.any(Date),
    });
  });

  it('drops verified metadata edits back to edited in direct letter updates', async () => {
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-verified-metadata',
      workflow: 'METADATA_DRAFTED',
      transcriptStatus: 'EDITED',
      metadataContentStatus: 'VERIFIED',
    });

    const result = await buildLetterUpdates('letter-verified-metadata', {
      sender: 'Alicia Smith',
    });

    expect(result).not.toBeNull();
    expect(result?.dbUpdates).toEqual({
      sender: 'Alicia Smith',
      metadataContentStatus: 'EDITED',
      metadataVerifiedAt: null,
      metadataVerifiedBy: null,
      updatedAt: expect.any(Date),
    });
  });

  it('marks manual extra-content edits as edited when content is added from an empty state', async () => {
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-5',
      extraContentStatus: 'EMPTY',
    });

    const result = await updateExtraContent('letter-5', 'Typed by an admin');

    expect(result).toBe(true);
    expect(updateSetMock).toHaveBeenCalledWith({
      extraContentTranscript: 'Typed by an admin',
      extraContentStatus: 'EDITED',
      updatedAt: expect.any(Date),
    });
  });

  it('resets extra-content to empty and clears verification metadata when content is removed', async () => {
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-6',
      extraContentStatus: 'VERIFIED',
    });

    const result = await updateExtraContent('letter-6', '   ');

    expect(result).toBe(true);
    expect(updateSetMock).toHaveBeenCalledWith({
      extraContentTranscript: null,
      extraContentStatus: 'EMPTY',
      extraContentVerifiedAt: null,
      extraContentVerifiedBy: null,
      updatedAt: expect.any(Date),
    });
  });

  it('drops verified extra-content back to edited when content is changed directly', async () => {
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-7',
      extraContentStatus: 'VERIFIED',
    });

    const result = await updateExtraContent('letter-7', 'Corrected note text');

    expect(result).toBe(true);
    expect(updateSetMock).toHaveBeenCalledWith({
      extraContentTranscript: 'Corrected note text',
      extraContentStatus: 'EDITED',
      extraContentVerifiedAt: null,
      extraContentVerifiedBy: null,
      updatedAt: expect.any(Date),
    });
  });

  it('clears extra-content verification metadata when no related items exist to transcribe', async () => {
    findFirstMock.mockResolvedValue({
      id: 'letter-10',
      collectionId: 'collection-1',
      dateRaw: '19470810',
      typeSequence: 1,
      collection: { collectionCode: '009' },
      pages: [],
    });
    findManyMock.mockResolvedValue([]);

    const result = await transcribeExtras('letter-10');

    expect(result).toEqual({
      transcribedCount: 0,
      extraContentStatus: 'EMPTY',
      message: 'No extra content found to transcribe',
    });
    expect(updateSetMock).toHaveBeenCalledWith({
      extraContentStatus: 'EMPTY',
      extraContentTranscript: null,
      extraContentVerifiedAt: null,
      extraContentVerifiedBy: null,
      updatedAt: expect.any(Date),
    });
  });

  it('resets extra-content verification when new transcriptions are generated', async () => {
    findFirstMock.mockResolvedValue({
      id: 'letter-11',
      collectionId: 'collection-1',
      dateRaw: '19470810',
      typeSequence: 1,
      collection: { collectionCode: '009' },
      pages: [{ id: 'page-main' }],
    });
    findManyMock.mockResolvedValue([
      {
        id: 'cover-1',
        type: 'C',
        pages: [
          {
            id: 'page-cover-1',
            storagePath: 'collections/009/19470810/C01/009-19470810-C01-01.jpg',
          },
        ],
      },
    ]);
    checkExtraContentForTextMock.mockResolvedValue({
      hasTranscribableText: true,
      reason: null,
    });
    transcribeExtraContentMock.mockResolvedValue({
      text: 'Envelope note',
    });

    const result = await transcribeExtras('letter-11');

    expect(getAbsoluteStoragePathMock).toHaveBeenCalledWith(
      'collections/009/19470810/C01/009-19470810-C01-01.jpg',
    );
    expect(checkExtraContentForTextMock).toHaveBeenCalledWith({
      filePath: 'collections/009/19470810/C01/009-19470810-C01-01.jpg',
      letterId: 'letter-11',
      documentType: 'cover/envelope',
    });
    expect(transcribeExtraContentMock).toHaveBeenCalledWith({
      filePath: 'collections/009/19470810/C01/009-19470810-C01-01.jpg',
      letterId: 'letter-11',
      documentType: 'cover/envelope',
      context: {
        collectionCode: '009',
        dateRaw: '19470810',
      },
    });
    expect(updateSetMock).toHaveBeenCalledWith({
      extraContentTranscript: '--- Cover/envelope ---\n\nEnvelope note',
      extraContentStatus: 'AI_DRAFT',
      extraContentVerifiedAt: null,
      extraContentVerifiedBy: null,
      updatedAt: expect.any(Date),
    });
    expect(result).toEqual({
      transcribedCount: 1,
      extraContentStatus: 'AI_DRAFT',
    });
  });
});
