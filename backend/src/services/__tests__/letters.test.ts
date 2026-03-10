import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  findFirstMock,
  dbInsertMock,
  insertValuesMock,
  insertReturningMock,
  dbUpdateMock,
  updateSetMock,
  updateWhereMock,
} = vi.hoisted(() => ({
  findFirstMock: vi.fn(),
  dbInsertMock: vi.fn(),
  insertValuesMock: vi.fn(),
  insertReturningMock: vi.fn(),
  dbUpdateMock: vi.fn(),
  updateSetMock: vi.fn(),
  updateWhereMock: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((field: unknown, value: unknown) => ({ kind: 'eq', field, value })),
  and: vi.fn((...clauses: unknown[]) => ({ kind: 'and', clauses })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    kind: 'sql',
    strings: Array.from(strings),
    values,
  })),
}));

vi.mock('../../db/index.js', () => {
  dbInsertMock.mockImplementation(() => ({
    values: insertValuesMock,
  }));
  insertValuesMock.mockImplementation(() => ({
    returning: insertReturningMock,
  }));
  dbUpdateMock.mockImplementation(() => ({
    set: updateSetMock,
  }));
  updateSetMock.mockImplementation(() => ({
    where: updateWhereMock,
  }));

  return {
    db: {
      query: {
        letters: {
          findFirst: findFirstMock,
        },
      },
      insert: dbInsertMock,
      update: dbUpdateMock,
    },
    letters: {
      id: 'letters.id',
      collectionId: 'letters.collectionId',
      dateRaw: 'letters.dateRaw',
      type: 'letters.type',
      typeSequence: 'letters.typeSequence',
      transcriptionAttemptCount: 'letters.transcriptionAttemptCount',
      metadataAttemptCount: 'letters.metadataAttemptCount',
    },
  };
});

import {
  findOrCreateLetter,
  resetLetterForProcessing,
  updateMetadataStatus,
  updateTranscriptionStatus,
} from '../letters.js';

describe('letters service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findFirstMock.mockResolvedValue(undefined);
    insertReturningMock.mockResolvedValue([
      {
        id: 'letter-new',
        collectionId: 'collection-1',
        dateRaw: '19470810',
        type: 'L',
        typeSequence: 1,
      },
    ]);
    updateWhereMock.mockResolvedValue(undefined);
  });

  it('returns an existing letter instead of creating a duplicate', async () => {
    const existing = {
      id: 'letter-existing',
      collectionId: 'collection-1',
      dateRaw: '19470810',
      type: 'L',
      typeSequence: 1,
    };
    findFirstMock.mockResolvedValue(existing);

    const result = await findOrCreateLetter({
      collectionId: 'collection-1',
      dateRaw: '19470810',
      type: 'L',
      typeSequence: 1,
      letterDate: '1947-08-10',
      dateConfidence: 'exact',
    });

    expect(result).toBe(existing);
    expect(dbInsertMock).not.toHaveBeenCalled();
  });

  it('marks successful transcription results as AI drafts', async () => {
    await updateTranscriptionStatus('letter-1', 'SUCCESS', 'Dear family', null);

    expect(updateSetMock).toHaveBeenCalledWith({
      transcriptionStatus: 'SUCCESS',
      updatedAt: expect.any(Date),
      transcriptionText: 'Dear family',
      transcriptionError: null,
      transcribedAt: expect.any(Date),
      transcriptStatus: 'AI_DRAFT',
    });
    expect(updateWhereMock).toHaveBeenCalledWith({
      kind: 'eq',
      field: 'letters.id',
      value: 'letter-1',
    });
  });

  it('marks successful metadata results as AI drafts', async () => {
    await updateMetadataStatus(
      'letter-2',
      'SUCCESS',
      {
        sender: 'Alice',
        recipient: 'Bob',
        hook: 'Quick hello',
        tags: ['family'],
      },
      null,
    );

    expect(updateSetMock).toHaveBeenCalledWith({
      metadataStatus: 'SUCCESS',
      updatedAt: expect.any(Date),
      sender: 'Alice',
      recipient: 'Bob',
      hook: 'Quick hello',
      tags: ['family'],
      metadataError: null,
      metadataContentStatus: 'AI_DRAFT',
    });
  });

  it('resets entity extraction state when re-enqueuing a letter for processing', async () => {
    await resetLetterForProcessing('letter-3');

    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow: 'UPLOADED',
        transcriptionStatus: 'PENDING',
        metadataStatus: 'PENDING',
        entityExtractionStatus: 'PENDING',
        entityExtractionError: null,
        entityExtractionJson: null,
        transcriptStatus: 'EMPTY',
        metadataContentStatus: 'EMPTY',
        updatedAt: expect.any(Date),
      }),
    );
  });
});
