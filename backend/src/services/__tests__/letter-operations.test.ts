import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  findFirstMock,
  findManyMock,
  dbTransactionMock,
  dbUpdateMock,
  updateSetMock,
  updateWhereMock,
  updateReturningMock,
  dbDeleteMock,
  deleteWhereMock,
  runTranscriptionMock,
  runRegeneratedExtraContentMock,
  transcribeExtrasMock,
  getLetterByIdMock,
  syncLetterParticipantsFromMetadataMock,
  checkExtraContentForTextMock,
  describePhotoMock,
  transcribeExtraContentMock,
  getAbsoluteStoragePathMock,
} = vi.hoisted(() => ({
  findFirstMock: vi.fn(),
  findManyMock: vi.fn(),
  dbTransactionMock: vi.fn(),
  dbUpdateMock: vi.fn(),
  updateSetMock: vi.fn(),
  updateWhereMock: vi.fn(),
  updateReturningMock: vi.fn(),
  dbDeleteMock: vi.fn(),
  deleteWhereMock: vi.fn(),
  runTranscriptionMock: vi.fn(),
  runRegeneratedExtraContentMock: vi.fn(),
  transcribeExtrasMock: vi.fn(),
  getLetterByIdMock: vi.fn(),
  syncLetterParticipantsFromMetadataMock: vi.fn(),
  checkExtraContentForTextMock: vi.fn(),
  describePhotoMock: vi.fn(),
  transcribeExtraContentMock: vi.fn(),
  getAbsoluteStoragePathMock: vi.fn((value: string) => value),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((field: unknown, value: unknown) => ({ kind: 'eq', field, value })),
  and: vi.fn((...clauses: unknown[]) => ({ kind: 'and', clauses })),
  ne: vi.fn((field: unknown, value: unknown) => ({ kind: 'ne', field, value })),
  inArray: vi.fn((field: unknown, values: unknown[]) => ({ kind: 'inArray', field, values })),
  isNull: vi.fn((field: unknown) => ({ kind: 'isNull', field })),
  isNotNull: vi.fn((field: unknown) => ({ kind: 'isNotNull', field })),
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
  dbTransactionMock.mockImplementation(async (
    callback: (tx: { update: typeof dbUpdateMock; delete: typeof dbDeleteMock }) => Promise<unknown>,
  ) => callback({ update: dbUpdateMock, delete: dbDeleteMock }));

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
      transaction: dbTransactionMock,
    },
    letters: {
      id: 'letters.id',
      collectionId: 'letters.collectionId',
      dateRaw: 'letters.dateRaw',
      typeSequence: 'letters.typeSequence',
      type: 'letters.type',
      transcriptionStatus: 'letters.transcriptionStatus',
      metadataStatus: 'letters.metadataStatus',
      entityExtractionStatus: 'letters.entityExtractionStatus',
      extraContentJobStatus: 'letters.extraContentJobStatus',
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

vi.mock('../letter/extra-content.js', () => ({
  runRegeneratedExtraContent: runRegeneratedExtraContentMock,
  transcribeExtras: transcribeExtrasMock,
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
  describePhoto: describePhotoMock,
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
  requestBackgroundWorkerRun: vi.fn(),
}));

vi.mock('../entities/participant-sync.js', () => ({
  syncLetterParticipantsFromMetadata: syncLetterParticipantsFromMetadataMock,
}));

import {
  bulkClearTranscriptions,
  bulkClearMetadata,
  buildLetterUpdates,
  describePhoto as describePhotoWorkflow,
  normalizeRelationshipType,
  regenerateTranscription,
  transcribeLetterOnly,
  updateExtraContent,
  updatePhotoDescription,
} from '../letter-operations.js';

describe('letter operations service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateWhereMock.mockImplementation(() => ({ returning: updateReturningMock }));
    updateReturningMock.mockResolvedValue([]);
    deleteWhereMock.mockResolvedValue(undefined);
    findManyMock.mockResolvedValue([]);
    runRegeneratedExtraContentMock.mockResolvedValue({ kind: 'completed', value: 0 });
    getLetterByIdMock.mockResolvedValue(undefined);
    getAbsoluteStoragePathMock.mockImplementation((value: string) => value);
  });

  it('normalizes common AI relationship variants', () => {
    expect(normalizeRelationshipType('fiance')).toBe('romantic-partner');
    expect(normalizeRelationshipType('coworker')).toBe('professional');
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

  it('bulk-clears only idle letters and clears extra-content ownership state', async () => {
    updateReturningMock.mockResolvedValue([{ id: 'letter-1' }]);

    const result = await bulkClearTranscriptions(['letter-1', 'letter-2']);

    expect(result).toEqual({
      message: 'Transcriptions cleared',
      updated: 1,
    });
    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
      transcriptionStatus: 'FAILED',
      extraContentJobStatus: 'FAILED',
      extraContentJobRunId: null,
      extraContentJobDirty: false,
    }));
    expect(updateWhereMock).toHaveBeenCalledWith({
      kind: 'and',
      clauses: [
        { kind: 'inArray', field: 'letters.id', values: ['letter-1', 'letter-2'] },
        { kind: 'ne', field: 'letters.transcriptionStatus', value: 'RUNNING' },
        { kind: 'ne', field: 'letters.metadataStatus', value: 'RUNNING' },
        { kind: 'ne', field: 'letters.entityExtractionStatus', value: 'RUNNING' },
        { kind: 'ne', field: 'letters.extraContentJobStatus', value: 'RUNNING' },
      ],
    });
    expect(deleteWhereMock).toHaveBeenCalledTimes(3);
    expect(deleteWhereMock).toHaveBeenNthCalledWith(1, {
      kind: 'inArray',
      field: 'letterPersons.letterId',
      values: ['letter-1'],
    });
  });

  it('does not delete related records when every requested letter is active', async () => {
    updateReturningMock.mockResolvedValue([]);

    await expect(bulkClearTranscriptions(['letter-running'])).resolves.toEqual({
      message: 'Transcriptions cleared',
      updated: 0,
    });

    expect(deleteWhereMock).not.toHaveBeenCalled();
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

  it('suppresses automatic extras and runs the regeneration producer exactly once', async () => {
    findFirstMock.mockResolvedValue({
      id: 'letter-4',
      type: 'L',
      collectionId: 'collection-1',
      collection: { collectionCode: '009' },
      dateRaw: '19470810',
      typeSequence: 1,
      pages: [{ id: 'page-1' }],
    });
    runRegeneratedExtraContentMock.mockResolvedValue({ kind: 'completed', value: 2 });

    const result = await regenerateTranscription('letter-4', true);

    expect(runTranscriptionMock).toHaveBeenCalledWith('letter-4', { extraContent: 'skip' });
    expect(runRegeneratedExtraContentMock).toHaveBeenCalledTimes(1);
    expect(runRegeneratedExtraContentMock).toHaveBeenCalledWith('letter-4');
    expect(result).toEqual({
      mainTranscript: true,
      extras: true,
      extrasCount: 2,
    });
  });

  it('does not run any extra-content producer when regeneration excludes extras', async () => {
    findFirstMock.mockResolvedValue({
      id: 'letter-4',
      type: 'L',
      collection: { collectionCode: '009' },
      dateRaw: '19470810',
      pages: [{ id: 'page-1' }],
    });

    const result = await regenerateTranscription('letter-4', false);

    expect(runTranscriptionMock).toHaveBeenCalledWith('letter-4', { extraContent: 'skip' });
    expect(runRegeneratedExtraContentMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      mainTranscript: true,
      extras: false,
      extrasCount: 0,
    });
  });

  it('returns a conflict when regeneration loses the extra-content claim', async () => {
    findFirstMock.mockResolvedValue({
      id: 'letter-4',
      type: 'L',
      collection: { collectionCode: '009' },
      dateRaw: '19470810',
      pages: [{ id: 'page-1' }],
    });
    runRegeneratedExtraContentMock.mockResolvedValue({ kind: 'claim_lost' });

    await expect(regenerateTranscription('letter-4', true)).rejects.toMatchObject({
      status: 409,
      message: 'Extra content transcription conflicted with another job update',
    });
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

  it('atomically applies a manual extra-content edit and revokes the active AI attempt', async () => {
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-5',
      extraContentStatus: 'EMPTY',
      extraContentJobStatus: 'RUNNING',
      extraContentJobRunId: 'old-run',
      extraContentJobDirty: true,
    });

    const result = await updateExtraContent('letter-5', 'Typed by an admin');

    expect(result).toBe(true);
    expect(updateSetMock).toHaveBeenCalledWith({
      extraContentTranscript: 'Typed by an admin',
      extraContentStatus: 'EDITED',
      extraContentVerifiedAt: null,
      extraContentVerifiedBy: null,
      extraContentJobStatus: 'SUCCESS',
      extraContentJobError: null,
      extraContentJobRunId: null,
      extraContentJobDirty: false,
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
      extraContentJobStatus: 'SUCCESS',
      extraContentJobError: null,
      extraContentJobRunId: null,
      extraContentJobDirty: false,
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
      extraContentJobStatus: 'SUCCESS',
      extraContentJobError: null,
      extraContentJobRunId: null,
      extraContentJobDirty: false,
      updatedAt: expect.any(Date),
    });
  });

  it('marks manual photo-description edits as edited when content is added from an empty state', async () => {
    getLetterByIdMock.mockResolvedValue({
      id: 'photo-1',
      type: 'P',
      photoDescriptionStatus: 'EMPTY',
    });

    const result = await updatePhotoDescription('photo-1', {
      photoDescription: 'Two children standing on a porch.',
    });

    expect(result).toBe(true);
    expect(updateSetMock).toHaveBeenCalledWith({
      photoDescription: 'Two children standing on a porch.',
      photoDescriptionStatus: 'EDITED',
      updatedAt: expect.any(Date),
    });
  });

  it('resets photo-description verification metadata when content is removed', async () => {
    getLetterByIdMock.mockResolvedValue({
      id: 'photo-2',
      type: 'P',
      photoDescriptionStatus: 'VERIFIED',
    });

    const result = await updatePhotoDescription('photo-2', {
      photoDescription: '   ',
    });

    expect(result).toBe(true);
    expect(updateSetMock).toHaveBeenCalledWith({
      photoDescription: null,
      photoDescriptionStatus: 'EMPTY',
      photoDescriptionVerifiedAt: null,
      photoDescriptionVerifiedBy: null,
      updatedAt: expect.any(Date),
    });
  });

  it('generates photo descriptions with reviewer and linked-letter context', async () => {
    findFirstMock
      .mockResolvedValueOnce({
        id: 'photo-3',
        type: 'P',
        collectionId: 'collection-1',
        dateRaw: '19470810',
        typeSequence: 1,
        collection: { collectionCode: '009' },
        pages: [
          {
            id: 'photo-page-1',
            pageNumber: 1,
            storagePath: 'collections/009/19470810/P01/009-19470810-P01-01.jpg',
          },
        ],
      })
      .mockResolvedValueOnce({
        sender: 'Alice',
        recipient: 'Bob',
        summary: 'Family snapshot',
        transcriptionText: 'Jimmy and Molly are standing by the porch.',
      });
    describePhotoMock.mockResolvedValue({
      text: 'A small outdoor snapshot showing two children posed beside a porch railing.',
      isStub: false,
    });

    const result = await describePhotoWorkflow('photo-3', 'Likely Jimmy and Molly');

    expect(getAbsoluteStoragePathMock).toHaveBeenCalledWith(
      'collections/009/19470810/P01/009-19470810-P01-01.jpg',
    );
    expect(describePhotoMock).toHaveBeenCalledWith({
      filePath: 'collections/009/19470810/P01/009-19470810-P01-01.jpg',
      letterId: 'photo-3',
      context: {
        collectionCode: '009',
        dateRaw: '19470810',
        photoNumber: 1,
        totalPhotos: 1,
        linkedLetterContext: expect.stringContaining('Sender: Alice'),
        reviewerContext: 'Likely Jimmy and Molly',
      },
    });
    expect(updateSetMock).toHaveBeenCalledWith({
      photoDescription: 'A small outdoor snapshot showing two children posed beside a porch railing.',
      photoDescriptionStatus: 'AI_DRAFT',
      photoDescriptionVerifiedAt: null,
      photoDescriptionVerifiedBy: null,
      photoDescriptionContext: 'Likely Jimmy and Molly',
      updatedAt: expect.any(Date),
    });
    expect(result).toEqual({
      describedCount: 1,
      photoDescriptionStatus: 'AI_DRAFT',
    });
  });
});
