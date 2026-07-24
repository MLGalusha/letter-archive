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
  runRequestedTranscriptionMock,
  runRegeneratedExtraContentMock,
  transcribeExtrasMock,
  getLetterByIdMock,
  syncLetterParticipantsFromMetadataMock,
  checkExtraContentForTextMock,
  describePhotoMock,
  transcribeExtraContentMock,
  getAbsoluteStoragePathMock,
  applyPublicationMutationMock,
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
  runRequestedTranscriptionMock: vi.fn(),
  runRegeneratedExtraContentMock: vi.fn(),
  transcribeExtrasMock: vi.fn(),
  getLetterByIdMock: vi.fn(),
  syncLetterParticipantsFromMetadataMock: vi.fn(),
  checkExtraContentForTextMock: vi.fn(),
  describePhotoMock: vi.fn(),
  transcribeExtraContentMock: vi.fn(),
  getAbsoluteStoragePathMock: vi.fn((value: string) => value),
  applyPublicationMutationMock: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((field: unknown, value: unknown) => ({ kind: 'eq', field, value })),
  and: vi.fn((...clauses: unknown[]) => ({ kind: 'and', clauses })),
  ne: vi.fn((field: unknown, value: unknown) => ({ kind: 'ne', field, value })),
  inArray: vi.fn((field: unknown, values: unknown[]) => ({ kind: 'inArray', field, values })),
  isNull: vi.fn((field: unknown) => ({ kind: 'isNull', field })),
  isNotNull: vi.fn((field: unknown) => ({ kind: 'isNotNull', field })),
  or: vi.fn((...clauses: unknown[]) => ({ kind: 'or', clauses })),
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
      primarySourceRevision: 'letters.primarySourceRevision',
      transcriptionText: 'letters.transcriptionText',
      transcriptionStatus: 'letters.transcriptionStatus',
      metadataRevision: 'letters.metadataRevision',
      metadataRunId: 'letters.metadataRunId',
      metadataContentStatus: 'letters.metadataContentStatus',
      metadataError: 'letters.metadataError',
      metadataStatus: 'letters.metadataStatus',
      entityExtractionStatus: 'letters.entityExtractionStatus',
      entityExtractionError: 'letters.entityExtractionError',
      extraContentJobStatus: 'letters.extraContentJobStatus',
      workflow: 'letters.workflow',
      updatedAt: 'letters.updatedAt',
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

vi.mock('../../pipeline/transcription.js', () => ({
  runRequestedTranscription: runRequestedTranscriptionMock,
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

vi.mock('../../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('../processing-queue.js', () => ({
  requestBackgroundWorkerRun: vi.fn(),
}));

vi.mock('../entities/participant-sync.js', () => ({
  syncLetterParticipantsFromMetadata: syncLetterParticipantsFromMetadataMock,
}));

vi.mock('../letter/publication-mutations.js', () => ({
  applyPublicationMutation: applyPublicationMutationMock,
}));

import {
  bulkClearTranscriptions,
  bulkClearMetadata,
  describePhoto as describePhotoWorkflow,
  normalizeRelationshipType,
  regenerateTranscription,
  transcribeLetterOnly,
  updateLetter,
  updateExtraContent,
  updatePhotoDescription,
} from '../letter-operations.js';

function renderedSql(value: unknown): string {
  const expression = value as { strings?: string[]; values?: unknown[] };
  if (!expression.strings || !expression.values) return '';
  return expression.strings.reduce(
    (text, part, index) => text + part + (index < expression.values!.length
      ? String(expression.values![index])
      : ''),
    '',
  );
}

describe('letter operations service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateWhereMock.mockImplementation(() => ({ returning: updateReturningMock }));
    updateReturningMock.mockResolvedValue([]);
    deleteWhereMock.mockResolvedValue(undefined);
    findManyMock.mockResolvedValue([]);
    runRegeneratedExtraContentMock.mockResolvedValue({ kind: 'completed', value: 0 });
    runRequestedTranscriptionMock.mockResolvedValue({
      kind: 'completed',
      pageCount: 1,
      textLength: 15,
    });
    getLetterByIdMock.mockResolvedValue(undefined);
    getAbsoluteStoragePathMock.mockImplementation((value: string) => value);
    applyPublicationMutationMock.mockImplementation(async (request: {
      intent: {
        visibility?: string;
        transcriptPublished?: boolean;
        metadataPublished?: boolean;
      };
      rootPatch?: Record<string, unknown>;
      rootConditions?: unknown[];
      afterRootMutation?: (database: unknown) => Promise<void>;
    }) => {
      const patch = {
        ...(request.rootPatch ?? {}),
        ...(request.intent.visibility !== undefined
          ? { visibility: request.intent.visibility }
          : {}),
        ...(request.intent.transcriptPublished !== undefined
          ? { transcriptPublished: request.intent.transcriptPublished }
          : {}),
        ...(request.intent.metadataPublished !== undefined
          ? { metadataPublished: request.intent.metadataPublished }
          : {}),
      };
      const updated = await dbUpdateMock()
        .set(patch)
        .where({ kind: 'and', clauses: request.rootConditions ?? [] })
        .returning();
      if (updated.length > 0) {
        await request.afterRootMutation?.({ transaction: 'test' });
      }
      return updated.length > 0
        ? { kind: 'applied', publicCorpusChanged: false }
        : { kind: 'root_conflict' };
    });
  });

  it('normalizes common AI relationship variants', () => {
    expect(normalizeRelationshipType('fiance')).toBe('romantic-partner');
    expect(normalizeRelationshipType('coworker')).toBe('professional');
    expect(normalizeRelationshipType('something unexpected')).toBe('unknown');
  });

  it('clears stored metadata JSON when metadata is bulk-cleared', async () => {
    const sources = [
      { letterId: 'letter-1', primarySourceRevision: 4 },
      { letterId: 'letter-2', primarySourceRevision: 8 },
    ];
    findManyMock.mockResolvedValue([
      {
        id: 'letter-1',
        primarySourceRevision: 4,
        transcriptionStatus: 'SUCCESS',
        metadataStatus: 'SUCCESS',
        entityExtractionStatus: 'SUCCESS',
      },
      {
        id: 'letter-2',
        primarySourceRevision: 8,
        transcriptionStatus: 'SUCCESS',
        metadataStatus: 'SUCCESS',
        entityExtractionStatus: 'SUCCESS',
      },
    ]);
    updateReturningMock.mockResolvedValueOnce([{ id: 'letter-1' }]);

    const result = await bulkClearMetadata(sources);

    expect(result).toEqual({
      requested: 2,
      applied: 1,
      skipped: 1,
      skipReasons: [{
        letterId: 'letter-2',
        code: 'SOURCE_CHANGED_OR_INELIGIBLE',
        reason: 'Letter source or processing state changed before metadata could be cleared',
      }],
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
        workflow: expect.objectContaining({ kind: 'sql' }),
        updatedAt: expect.any(Date),
      }),
    );
    expect(updateWhereMock).toHaveBeenCalledWith({
      kind: 'and',
      clauses: [
        {
          kind: 'or',
          clauses: sources.map(({ letterId, primarySourceRevision }) => ({
            kind: 'and',
            clauses: [
              { kind: 'eq', field: 'letters.id', value: letterId },
              {
                kind: 'eq',
                field: 'letters.primarySourceRevision',
                value: primarySourceRevision,
              },
            ],
          })),
        },
        { kind: 'ne', field: 'letters.transcriptionStatus', value: 'RUNNING' },
        { kind: 'ne', field: 'letters.metadataStatus', value: 'RUNNING' },
        { kind: 'ne', field: 'letters.entityExtractionStatus', value: 'RUNNING' },
      ],
    });
    expect(deleteWhereMock).toHaveBeenCalledTimes(3);
    expect(deleteWhereMock).toHaveBeenCalledWith({
      kind: 'inArray',
      field: 'letterPersons.letterId',
      values: ['letter-1'],
    });
  });

  it('does not delete entity links for metadata rows that lose the idle-state claim', async () => {
    const source = { letterId: 'letter-active', primarySourceRevision: 5 };
    findManyMock.mockResolvedValue([{
      id: source.letterId,
      primarySourceRevision: source.primarySourceRevision,
      transcriptionStatus: 'SUCCESS',
      metadataStatus: 'SUCCESS',
      entityExtractionStatus: 'SUCCESS',
    }]);
    const result = await bulkClearMetadata([source]);

    expect(result).toEqual({
      requested: 1,
      applied: 0,
      skipped: 1,
      skipReasons: [{
        letterId: source.letterId,
        code: 'SOURCE_CHANGED_OR_INELIGIBLE',
        reason: 'Letter source or processing state changed before metadata could be cleared',
      }],
    });
    expect(deleteWhereMock).not.toHaveBeenCalled();
  });

  it('bulk-clears only idle letters and clears extra-content ownership state', async () => {
    const sources = [
      { letterId: 'letter-1', primarySourceRevision: 4 },
      { letterId: 'letter-2', primarySourceRevision: 8 },
    ];
    findManyMock.mockResolvedValue(sources.map((source) => ({
      id: source.letterId,
      primarySourceRevision: source.primarySourceRevision,
      transcriptionStatus: 'SUCCESS',
      metadataStatus: 'SUCCESS',
      entityExtractionStatus: 'SUCCESS',
      extraContentJobStatus: 'SUCCESS',
    })));
    updateReturningMock.mockResolvedValue([{ id: 'letter-1' }]);

    const result = await bulkClearTranscriptions(sources);

    expect(result).toEqual({
      requested: 2,
      applied: 1,
      skipped: 1,
      skipReasons: [{
        letterId: 'letter-2',
        code: 'SOURCE_CHANGED_OR_INELIGIBLE',
        reason: 'Letter source or processing state changed before it could be cleared',
      }],
    });
    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
      transcriptionStatus: 'FAILED',
      transcriptionRunId: null,
      transcriptionLeaseExpiresAt: null,
      transcriptionLeaseRunId: null,
      transcriptionClaimKind: null,
      extraContentJobStatus: 'FAILED',
      extraContentJobRunId: null,
      extraContentJobLeaseExpiresAt: null,
      extraContentJobLeaseRunId: null,
      extraContentJobClaimKind: null,
      extraContentJobDirty: false,
    }));
    expect(updateWhereMock).toHaveBeenCalledWith({
      kind: 'and',
      clauses: [
        {
          kind: 'or',
          clauses: sources.map(({ letterId, primarySourceRevision }) => ({
            kind: 'and',
            clauses: [
              { kind: 'eq', field: 'letters.id', value: letterId },
              {
                kind: 'eq',
                field: 'letters.primarySourceRevision',
                value: primarySourceRevision,
              },
            ],
          })),
        },
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
    const source = { letterId: 'letter-running', primarySourceRevision: 6 };
    findManyMock.mockResolvedValue([{
      id: source.letterId,
      primarySourceRevision: source.primarySourceRevision,
      transcriptionStatus: 'RUNNING',
      metadataStatus: 'SUCCESS',
      entityExtractionStatus: 'SUCCESS',
      extraContentJobStatus: 'SUCCESS',
    }]);

    await expect(bulkClearTranscriptions([source])).resolves.toEqual({
      requested: 1,
      applied: 0,
      skipped: 1,
      skipReasons: [{
        letterId: source.letterId,
        code: 'INELIGIBLE',
        reason: 'Transcription is running',
      }],
    });

    expect(deleteWhereMock).not.toHaveBeenCalled();
    expect(dbTransactionMock).not.toHaveBeenCalled();
  });

  it('does not reset transcription state when letter-only transcription is rejected for missing pages', async () => {
    runRequestedTranscriptionMock.mockResolvedValue({ kind: 'no_pages' });

    await expect(transcribeLetterOnly('letter-3', 4)).rejects.toMatchObject({
      message: 'Letter has no pages to transcribe',
      status: 400,
    });
    expect(dbUpdateMock).not.toHaveBeenCalled();
    expect(runRequestedTranscriptionMock).toHaveBeenCalledWith('letter-3', 4);
  });

  it('does not reset transcription state when regeneration is rejected for missing pages', async () => {
    runRequestedTranscriptionMock.mockResolvedValue({ kind: 'no_pages' });

    await expect(regenerateTranscription('letter-4', false, 4)).rejects.toMatchObject({
      message: 'Letter has no pages to transcribe',
      status: 400,
    });
    expect(dbUpdateMock).not.toHaveBeenCalled();
    expect(runRequestedTranscriptionMock).toHaveBeenCalledWith('letter-4', 4);
  });

  it('returns canonical metrics for letter-only transcription without extras', async () => {
    runRequestedTranscriptionMock.mockResolvedValue({
      kind: 'completed',
      pageCount: 2,
      textLength: 42,
    });

    await expect(transcribeLetterOnly('letter-3', 4)).resolves.toEqual({
      pageCount: 2,
      textLength: 42,
    });
    expect(runRequestedTranscriptionMock).toHaveBeenCalledWith('letter-3', 4);
    expect(runRegeneratedExtraContentMock).not.toHaveBeenCalled();
  });

  it('returns a conflict when direct transcription loses or outlives its claim', async () => {
    runRequestedTranscriptionMock.mockResolvedValueOnce({ kind: 'claim_lost' });
    await expect(transcribeLetterOnly('letter-3', 4)).rejects.toMatchObject({
      status: 409,
      message: 'Transcription conflicted with another job update',
    });

    runRequestedTranscriptionMock.mockResolvedValueOnce({ kind: 'superseded' });
    await expect(transcribeLetterOnly('letter-3', 4)).rejects.toMatchObject({
      status: 409,
      message: 'Transcription was cancelled or superseded',
    });
  });

  it('maps a source change during requested transcription to the stable conflict code', async () => {
    runRequestedTranscriptionMock.mockResolvedValue({ kind: 'superseded' });
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-3',
      primarySourceRevision: 5,
    });

    await expect(transcribeLetterOnly('letter-3', 4)).rejects.toMatchObject({
      statusCode: 409,
      code: 'SOURCE_REVISION_CHANGED',
    });
  });

  it('suppresses automatic extras and runs the regeneration producer exactly once', async () => {
    runRegeneratedExtraContentMock.mockResolvedValue({ kind: 'completed', value: 2 });

    const result = await regenerateTranscription('letter-4', true, 4);

    expect(runRequestedTranscriptionMock).toHaveBeenCalledWith('letter-4', 4);
    expect(runRegeneratedExtraContentMock).toHaveBeenCalledTimes(1);
    expect(runRegeneratedExtraContentMock).toHaveBeenCalledWith('letter-4', 4);
    expect(result).toEqual({
      mainTranscript: true,
      extras: true,
      extrasCount: 2,
    });
  });

  it('does not run any extra-content producer when regeneration excludes extras', async () => {
    const result = await regenerateTranscription('letter-4', false, 4);

    expect(runRequestedTranscriptionMock).toHaveBeenCalledWith('letter-4', 4);
    expect(runRegeneratedExtraContentMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      mainTranscript: true,
      extras: false,
      extrasCount: 0,
    });
  });

  it('returns a conflict when regeneration loses the extra-content claim', async () => {
    runRegeneratedExtraContentMock.mockResolvedValue({ kind: 'claim_lost' });

    await expect(regenerateTranscription('letter-4', true, 4)).rejects.toMatchObject({
      status: 409,
      message: 'Extra content transcription conflicted with another job update',
    });
  });

  it('drops verified transcript edits back to edited and revokes confirmation', async () => {
    updateReturningMock.mockResolvedValueOnce([{ id: 'letter-verified-transcript' }]);
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-verified-transcript',
      workflow: 'TRANSCRIBED',
      transcriptStatus: 'VERIFIED',
      transcriptConfirmedAt: new Date('2026-07-16T12:00:00.000Z'),
      transcriptConfirmedBy: 'reviewer-1',
      metadataContentStatus: expect.objectContaining({ kind: 'sql' }),
      metadataRevision: 2,
      metadataRunId: null,
      metadataStatus: 'SUCCESS',
      entityExtractionStatus: 'SUCCESS',
      updatedAt: new Date('2026-07-17T12:00:00.000Z'),
    });

    const result = await updateLetter('letter-verified-transcript', {
      primarySourceRevision: 0,
      transcriptionText: 'Corrected transcript text',
    });

    expect(result).toBe(true);
    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
      transcriptionText: 'Corrected transcript text',
      transcriptionStatus: 'SUCCESS',
      transcriptionRunId: null,
      transcriptionLeaseExpiresAt: null,
      transcriptionLeaseRunId: null,
      transcriptionClaimKind: null,
      transcriptionError: null,
      transcriptStatus: 'EDITED',
      transcriptVerifiedAt: null,
      transcriptVerifiedBy: null,
      transcriptConfirmedAt: null,
      transcriptConfirmedBy: null,
      workflow: 'TRANSCRIBED',
      metadataStatus: expect.objectContaining({ kind: 'sql' }),
      metadataRunId: null,
      metadataRunRevision: null,
      metadataLeaseExpiresAt: null,
      metadataLeaseRunId: null,
      metadataClaimKind: null,
      metadataRevision: expect.objectContaining({ kind: 'sql' }),
      metadataVerifiedAt: null,
      metadataVerifiedBy: null,
      metadataPublished: false,
      transcriptPublished: false,
      updatedAt: expect.any(Date),
    }));
  });

  it('atomically applies a manual transcript edit and revokes the active AI attempt', async () => {
    updateReturningMock.mockResolvedValueOnce([{ id: 'letter-running-transcript' }]);
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-running-transcript',
      workflow: 'TRANSCRIBING',
      transcriptStatus: 'AI_DRAFT',
      transcriptionStatus: 'RUNNING',
      transcriptionRunId: 'old-run',
      transcriptConfirmedAt: new Date('2026-07-16T12:00:00.000Z'),
      transcriptConfirmedBy: 'reviewer-1',
      metadataContentStatus: 'EMPTY',
      metadataRevision: 0,
      metadataStatus: 'PENDING',
      metadataRunId: null,
      entityExtractionStatus: 'PENDING',
      updatedAt: new Date('2026-07-17T12:00:00.000Z'),
    });

    const result = await updateLetter('letter-running-transcript', {
      primarySourceRevision: 0,
      transcriptionText: 'Typed by an admin',
    });

    expect(result).toBe(true);
    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
      transcriptionText: 'Typed by an admin',
      transcriptionStatus: 'SUCCESS',
      transcriptionRunId: null,
      transcriptionLeaseExpiresAt: null,
      transcriptionLeaseRunId: null,
      transcriptionClaimKind: null,
      transcriptionError: null,
      transcriptStatus: 'EDITED',
      transcriptVerifiedAt: null,
      transcriptVerifiedBy: null,
      transcriptConfirmedAt: null,
      transcriptConfirmedBy: null,
      workflow: 'TRANSCRIBED',
      metadataStatus: expect.objectContaining({ kind: 'sql' }),
      metadataRunId: null,
      metadataRunRevision: null,
      metadataLeaseExpiresAt: null,
      metadataLeaseRunId: null,
      metadataClaimKind: null,
      metadataRevision: expect.objectContaining({ kind: 'sql' }),
      metadataPublished: false,
      transcriptPublished: false,
      updatedAt: expect.any(Date),
    }));
    expect(dbUpdateMock).toHaveBeenCalledTimes(1);
  });

  it('marks a cleared manual transcript empty while revoking the active AI attempt', async () => {
    updateReturningMock.mockResolvedValueOnce([{ id: 'letter-cleared-transcript' }]);
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-cleared-transcript',
      workflow: 'TRANSCRIBING',
      transcriptStatus: 'VERIFIED',
      transcriptionStatus: 'RUNNING',
      transcriptionRunId: 'old-run',
      transcriptConfirmedAt: new Date('2026-07-16T12:00:00.000Z'),
      transcriptConfirmedBy: 'reviewer-1',
      metadataContentStatus: 'EMPTY',
      metadataRevision: 0,
      metadataStatus: 'PENDING',
      metadataRunId: null,
      entityExtractionStatus: 'PENDING',
      updatedAt: new Date('2026-07-17T12:00:00.000Z'),
    });

    const result = await updateLetter('letter-cleared-transcript', {
      primarySourceRevision: 0,
      transcriptionText: '   ',
    });

    expect(result).toBe(true);
    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
      transcriptionText: '   ',
      transcriptionStatus: 'SUCCESS',
      transcriptionRunId: null,
      transcriptionLeaseExpiresAt: null,
      transcriptionLeaseRunId: null,
      transcriptionClaimKind: null,
      transcriptionError: null,
      transcriptStatus: 'EMPTY',
      transcriptVerifiedAt: null,
      transcriptVerifiedBy: null,
      transcriptConfirmedAt: null,
      transcriptConfirmedBy: null,
      workflow: 'UPLOADED',
      metadataStatus: expect.objectContaining({ kind: 'sql' }),
      metadataRunId: null,
      metadataRunRevision: null,
      metadataLeaseExpiresAt: null,
      metadataLeaseRunId: null,
      metadataClaimKind: null,
      metadataRevision: expect.objectContaining({ kind: 'sql' }),
      metadataPublished: false,
      transcriptPublished: false,
      updatedAt: expect.any(Date),
    }));
  });

  it('drops verified metadata edits back to edited in direct letter updates', async () => {
    updateReturningMock.mockResolvedValueOnce([{ id: 'letter-verified-metadata' }]);
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-verified-metadata',
      workflow: 'METADATA_DRAFTED',
      transcriptStatus: 'EDITED',
      metadataContentStatus: 'VERIFIED',
      metadataStatus: 'RUNNING',
      metadataRunId: 'metadata-run-a',
      metadataRevision: 7,
      entityExtractionStatus: 'SUCCESS',
      updatedAt: new Date('2026-07-17T12:00:00.000Z'),
    });

    const result = await updateLetter('letter-verified-metadata', {
      primarySourceRevision: 0,
      sender: 'Alicia Smith',
    });

    expect(result).toBe(true);
    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
      sender: 'Alicia Smith',
      metadataStatus: expect.objectContaining({ kind: 'sql' }),
      metadataRunId: null,
      metadataRunRevision: null,
      metadataLeaseExpiresAt: null,
      metadataLeaseRunId: null,
      metadataClaimKind: null,
      metadataRevision: expect.objectContaining({ kind: 'sql' }),
      metadataContentStatus: expect.objectContaining({ kind: 'sql' }),
      metadataVerifiedAt: null,
      metadataVerifiedBy: null,
      metadataPublished: false,
      workflow: expect.objectContaining({ kind: 'sql' }),
      updatedAt: expect.any(Date),
    }));
    const saved = updateSetMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(renderedSql(saved.metadataContentStatus)).toContain(
      "ELSE 'EDITED'::content_status",
    );
  });

  it('commits matching note auto-resolutions with the triggering field edit', async () => {
    updateReturningMock.mockResolvedValueOnce([{ id: 'letter-note-resolution' }]);
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-note-resolution',
      sender: null,
      workflow: 'METADATA_DRAFTED',
      transcriptStatus: 'EDITED',
      metadataContentStatus: 'AI_DRAFT',
      metadataStatus: 'SUCCESS',
      metadataRunId: null,
      metadataRevision: 7,
      entityExtractionStatus: 'SUCCESS',
      aiNotes: [
        {
          id: 'sender-note',
          content: 'Confirm the sender',
          category: 'identity',
          priority: 'high',
          status: 'open',
          resolves_when: 'sender_filled',
          resolved_at: null,
          resolved_by: null,
          source: 'ai',
        },
        {
          id: 'recipient-note',
          content: 'Confirm the recipient',
          category: 'identity',
          priority: 'medium',
          status: 'open',
          resolves_when: 'recipient_filled',
          resolved_at: null,
          resolved_by: null,
          source: 'ai',
        },
      ],
    });

    await expect(updateLetter('letter-note-resolution', {
      primarySourceRevision: 0,
      sender: 'Alice',
    })).resolves.toBe(true);

    expect(updateSetMock).toHaveBeenCalledTimes(1);
    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
      sender: 'Alice',
      aiNotes: [
        expect.objectContaining({
          id: 'sender-note',
          status: 'resolved',
          resolved_by: 'auto',
          resolved_at: expect.any(String),
        }),
        expect.objectContaining({
          id: 'recipient-note',
          status: 'open',
        }),
      ],
      metadataRevision: expect.objectContaining({ kind: 'sql' }),
    }));
  });

  it('preserves the queued empty lifecycle when saving metadata prefills', async () => {
    updateReturningMock.mockResolvedValueOnce([{ id: 'letter-prefill' }]);
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-prefill',
      workflow: 'UPLOADED',
      transcriptStatus: 'EMPTY',
      metadataStatus: 'PENDING',
      metadataRevision: 0,
      metadataRunId: null,
      metadataContentStatus: 'EMPTY',
      entityExtractionStatus: 'PENDING',
      updatedAt: new Date('2026-07-17T12:00:00.000Z'),
    });

    await expect(updateLetter('letter-prefill', {
      primarySourceRevision: 0,
      sender: 'Alice',
    })).resolves.toBe(true);

    const saved = updateSetMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(saved).toMatchObject({
      sender: 'Alice',
      metadataRunId: null,
      metadataRunRevision: null,
      metadataLeaseExpiresAt: null,
      metadataLeaseRunId: null,
      metadataClaimKind: null,
      metadataRevision: expect.objectContaining({ kind: 'sql' }),
      metadataContentStatus: expect.objectContaining({ kind: 'sql' }),
      workflow: expect.objectContaining({ kind: 'sql' }),
    });
    expect(renderedSql(saved.metadataStatus)).toContain('ELSE letters.metadataStatus');
    expect(renderedSql(saved.metadataContentStatus)).toContain(
      'WHEN letters.metadataContentStatus = \'EMPTY\' THEN letters.metadataContentStatus',
    );
    expect(renderedSql(saved.workflow)).toContain('ELSE letters.workflow');
  });

  it('does not revoke ownership or review state for a same-value metadata save', async () => {
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-noop',
      sender: 'Alice',
      recipient: 'Bob',
      workflow: 'METADATA_EXTRACTING',
      metadataStatus: 'RUNNING',
      metadataRunId: 'run-a',
      metadataRevision: 7,
      metadataContentStatus: 'VERIFIED',
      metadataPublished: true,
      entityExtractionStatus: 'SUCCESS',
      updatedAt: new Date('2026-07-17T12:00:00.000Z'),
    });

    await expect(updateLetter('letter-noop', {
      primarySourceRevision: 0,
      sender: 'Alice',
    })).resolves.toBe(true);

    expect(dbUpdateMock).not.toHaveBeenCalled();
    expect(syncLetterParticipantsFromMetadataMock).not.toHaveBeenCalled();
  });

  it('updates structured metadata together with flattened human fields', async () => {
    updateReturningMock.mockResolvedValueOnce([{ id: 'letter-coherent' }]);
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-coherent',
      sender: 'Alice',
      recipient: 'Bob',
      summary: 'Old summary',
      tags: ['old'],
      workflow: 'METADATA_DRAFTED',
      metadataStatus: 'SUCCESS',
      metadataRevision: 2,
      metadataRunId: null,
      metadataContentStatus: 'AI_DRAFT',
      entityExtractionStatus: 'SUCCESS',
      metadataV2Json: {
        sender: 'Alice',
        recipient: 'Bob',
        summary: 'Old summary',
        primary_topics: ['old'],
      },
      updatedAt: new Date('2026-07-17T12:00:00.000Z'),
    });

    await updateLetter('letter-coherent', {
      primarySourceRevision: 0,
      summary: 'Reviewer summary',
      tags: ['family'],
    });

    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
      summary: 'Reviewer summary',
      tags: ['family'],
      primaryTopics: ['family'],
      metadataV2Json: expect.objectContaining({
        sender: 'Alice',
        recipient: 'Bob',
        summary: 'Reviewer summary',
        primary_topics: ['family'],
      }),
      metadataJson: expect.objectContaining({
        summary: 'Reviewer summary',
        primary_topics: ['family'],
      }),
    }));
  });

  it('persists reviewer V2 metadata and synchronizes its derived relationship', async () => {
    updateReturningMock.mockResolvedValueOnce([{ id: 'letter-reviewer-v2' }]);
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-reviewer-v2',
      extractedDate: '1947-09-20',
      emotionalTone: 'hopeful',
      senderRecipientRelationship: 'friend',
      primaryTopics: ['family/marriage'],
      tags: ['family/marriage'],
      workflow: 'METADATA_DRAFTED',
      metadataStatus: 'SUCCESS',
      metadataRevision: 2,
      metadataRunId: null,
      metadataContentStatus: 'AI_DRAFT',
      entityExtractionStatus: 'SUCCESS',
      metadataV2Json: {
        extracted_date: '1947-09-20',
        emotional_tone: 'hopeful',
        sender_recipient_relationship: 'friend',
        primary_topics: ['family/marriage'],
        notable_quotes: [{ text: 'Preserved verbatim' }],
      },
      updatedAt: new Date('2026-07-17T12:00:00.000Z'),
    });

    await updateLetter('letter-reviewer-v2', {
      primarySourceRevision: 0,
      extractedDate: '1947-09-21',
      emotionalTone: 'nostalgic',
      senderRecipientRelationship: 'extended-family',
      primaryTopics: ['family/separation-reunion'],
    });

    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
      extractedDate: '1947-09-21',
      emotionalTone: 'nostalgic',
      senderRecipientRelationship: 'extended-family',
      primaryTopics: ['family/separation-reunion'],
      tags: ['family/separation-reunion'],
      metadataV2Json: {
        extracted_date: '1947-09-21',
        emotional_tone: 'nostalgic',
        sender_recipient_relationship: 'extended-family',
        primary_topics: ['family/separation-reunion'],
        notable_quotes: [{ text: 'Preserved verbatim' }],
      },
      metadataJson: {
        extracted_date: '1947-09-21',
        emotional_tone: 'nostalgic',
        sender_recipient_relationship: 'extended-family',
        primary_topics: ['family/separation-reunion'],
        notable_quotes: [{ text: 'Preserved verbatim' }],
      },
    }));
    expect(syncLetterParticipantsFromMetadataMock).toHaveBeenCalledWith({
      letterId: 'letter-reviewer-v2',
      sender: undefined,
      recipient: undefined,
      relationshipType: 'extended-family',
      actor: 'admin',
      database: { transaction: 'test' },
    });
  });

  it('updates a legacy structured metadata document when the V2 projection is absent', async () => {
    updateReturningMock.mockResolvedValueOnce([{ id: 'letter-legacy-metadata' }]);
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-legacy-metadata',
      sender: 'Alice',
      workflow: 'METADATA_DRAFTED',
      metadataStatus: 'SUCCESS',
      metadataRevision: 2,
      metadataRunId: null,
      metadataContentStatus: 'AI_DRAFT',
      entityExtractionStatus: 'SUCCESS',
      metadataV2Json: null,
      metadataJson: { sender: 'Alice', summary: 'Legacy summary' },
      updatedAt: new Date('2026-07-17T12:00:00.000Z'),
    });

    await updateLetter('letter-legacy-metadata', {
      primarySourceRevision: 0,
      sender: 'Alicia',
    });

    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
      sender: 'Alicia',
      metadataJson: { sender: 'Alicia', summary: 'Legacy summary' },
    }));
    expect(updateSetMock.mock.calls[0]![0]).not.toHaveProperty('metadataV2Json');
    expect(syncLetterParticipantsFromMetadataMock).toHaveBeenCalledWith(
      expect.objectContaining({
        letterId: 'letter-legacy-metadata',
        sender: 'Alicia',
        actor: 'admin',
        database: { transaction: 'test' },
      }),
    );
  });

  it('does not auto-publish content invalidated by the same visibility update', async () => {
    updateReturningMock.mockResolvedValueOnce([{ id: 'letter-publish-edit' }]);
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-publish-edit',
      visibility: 'HIDDEN',
      workflow: 'REVIEWED',
      transcriptionText: 'Old transcript',
      transcriptionStatus: 'SUCCESS',
      transcriptStatus: 'VERIFIED',
      metadataStatus: 'SUCCESS',
      metadataRevision: 3,
      metadataRunId: null,
      metadataContentStatus: 'VERIFIED',
      entityExtractionStatus: 'SUCCESS',
      updatedAt: new Date('2026-07-17T12:00:00.000Z'),
    });

    await updateLetter('letter-publish-edit', {
      primarySourceRevision: 0,
      visibility: 'PUBLISHED',
      transcriptionText: 'Corrected transcript',
      sender: 'Corrected sender',
    });

    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
      transcriptPublished: false,
      metadataPublished: false,
    }));
    expect(applyPublicationMutationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: {
          letterId: 'letter-publish-edit',
          primarySourceRevision: 0,
        },
        intent: expect.objectContaining({
          visibility: 'PUBLISHED',
        }),
        blocksTranscriptGrant: true,
        blocksMetadataGrant: true,
      }),
    );
    const publicationRequest =
      applyPublicationMutationMock.mock.calls[0]?.[0] as {
        rootPatch?: Record<string, unknown>;
      };
    expect(publicationRequest.rootPatch).not.toHaveProperty('visibility');
  });

  it('gives a compound transcript and metadata save source-invalidation precedence', async () => {
    updateReturningMock.mockResolvedValueOnce([{ id: 'letter-compound' }]);
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-compound',
      workflow: 'METADATA_DRAFTED',
      transcriptStatus: 'VERIFIED',
      transcriptionStatus: 'SUCCESS',
      metadataStatus: 'RUNNING',
      metadataRevision: 8,
      metadataRunId: 'metadata-run-a',
      metadataContentStatus: 'VERIFIED',
      entityExtractionStatus: 'SUCCESS',
      updatedAt: new Date('2026-07-17T12:00:00.000Z'),
    });

    await expect(updateLetter('letter-compound', {
      primarySourceRevision: 0,
      transcriptionText: 'A corrected source transcript',
      sender: 'A corrected sender',
    })).resolves.toBe(true);

    const saved = updateSetMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(saved).toMatchObject({
      transcriptionText: 'A corrected source transcript',
      sender: 'A corrected sender',
      workflow: 'TRANSCRIBED',
      metadataContentStatus: 'EDITED',
      metadataRunId: null,
      metadataRunRevision: null,
      metadataLeaseExpiresAt: null,
      metadataLeaseRunId: null,
      metadataClaimKind: null,
      metadataPublished: false,
      transcriptPublished: false,
    });
    expect(renderedSql(saved.metadataStatus)).toContain("ELSE 'PENDING'::job_status");
    expect(renderedSql(saved.metadataRevision)).toContain('letters.metadataRevision + 1');
  });

  it('returns a conflict instead of silently overwriting a newer metadata revision', async () => {
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-raced',
      workflow: 'METADATA_DRAFTED',
      metadataRevision: 3,
      metadataStatus: 'SUCCESS',
      metadataRunId: null,
      metadataContentStatus: 'EDITED',
      entityExtractionStatus: 'PENDING',
      updatedAt: new Date('2026-07-17T12:00:00.000Z'),
    });
    updateReturningMock.mockResolvedValueOnce([]);

    await expect(updateLetter('letter-raced', {
      primarySourceRevision: 0,
      sender: 'A newer value',
    }))
      .rejects.toMatchObject({
        status: 409,
        message: expect.stringContaining('changed before this update could be saved'),
      });
    expect(syncLetterParticipantsFromMetadataMock).not.toHaveBeenCalled();
  });

  it('rejects direct publication of unverified transcript content', async () => {
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-unverified-transcript',
      workflow: 'TRANSCRIBED',
      transcriptionStatus: 'SUCCESS',
      transcriptStatus: 'EDITED',
      metadataRevision: 0,
      updatedAt: new Date('2026-07-17T12:00:00.000Z'),
    });

    await expect(updateLetter('letter-unverified-transcript', {
      primarySourceRevision: 0,
      transcriptPublished: true,
    })).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('verified transcript'),
    });
    expect(dbUpdateMock).not.toHaveBeenCalled();
  });

  it('can republish verified committed content after a replacement attempt fails', async () => {
    updateReturningMock.mockResolvedValueOnce([{ id: 'letter-failed-replacement' }]);
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-failed-replacement',
      workflow: 'REVIEWED',
      transcriptionStatus: 'FAILED',
      transcriptStatus: 'VERIFIED',
      transcriptPublished: false,
      metadataStatus: 'FAILED',
      metadataContentStatus: 'VERIFIED',
      metadataPublished: false,
      metadataRevision: 4,
      updatedAt: new Date('2026-07-17T12:00:00.000Z'),
    });

    await expect(updateLetter('letter-failed-replacement', {
      primarySourceRevision: 0,
      transcriptPublished: true,
      metadataPublished: true,
    })).resolves.toBe(true);

    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
      transcriptPublished: true,
      metadataPublished: true,
    }));
    expect(applyPublicationMutationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        rootPatch: undefined,
        rootConditions: undefined,
      }),
    );
  });

  it('atomically applies a manual extra-content edit and revokes the active AI attempt', async () => {
    updateReturningMock.mockResolvedValueOnce([{ id: 'letter-5' }]);
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-5',
      extraContentStatus: 'EMPTY',
      extraContentJobStatus: 'RUNNING',
      extraContentJobRunId: 'old-run',
      extraContentJobDirty: true,
      transcriptionText: 'Dear Bob',
      metadataRevision: 0,
      metadataStatus: 'PENDING',
      metadataRunId: null,
      metadataContentStatus: 'EMPTY',
      entityExtractionStatus: 'PENDING',
      primarySourceRevision: 6,
      updatedAt: new Date('2026-07-17T12:00:00.000Z'),
    });

    const result = await updateExtraContent(
      'letter-5',
      'Typed by an admin',
      6,
    );

    expect(result).toBe(true);
    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
      extraContentTranscript: 'Typed by an admin',
      extraContentStatus: 'EDITED',
      extraContentVerifiedAt: null,
      extraContentVerifiedBy: null,
      extraContentJobStatus: 'SUCCESS',
      extraContentJobError: null,
      extraContentJobRunId: null,
      extraContentJobLeaseExpiresAt: null,
      extraContentJobLeaseRunId: null,
      extraContentJobClaimKind: null,
      extraContentJobDirty: false,
      metadataStatus: expect.objectContaining({ kind: 'sql' }),
      metadataRunId: null,
      metadataRunRevision: null,
      metadataLeaseExpiresAt: null,
      metadataLeaseRunId: null,
      metadataClaimKind: null,
      metadataRevision: expect.objectContaining({ kind: 'sql' }),
      metadataPublished: false,
      transcriptPublished: false,
      updatedAt: expect.any(Date),
    }));
    expect(updateWhereMock).toHaveBeenCalledWith(expect.objectContaining({
      clauses: expect.arrayContaining([{
        kind: 'eq',
        field: 'letters.primarySourceRevision',
        value: 6,
      }]),
    }));
  });

  it('resets extra-content to empty and clears verification metadata when content is removed', async () => {
    updateReturningMock.mockResolvedValueOnce([{ id: 'letter-6' }]);
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-6',
      extraContentStatus: 'VERIFIED',
      transcriptionText: 'Dear Bob',
      metadataRevision: 1,
      metadataStatus: 'SUCCESS',
      metadataRunId: null,
      metadataContentStatus: 'VERIFIED',
      entityExtractionStatus: 'SUCCESS',
      primarySourceRevision: 6,
      updatedAt: new Date('2026-07-17T12:00:00.000Z'),
    });

    const result = await updateExtraContent('letter-6', '   ', 6);

    expect(result).toBe(true);
    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
      extraContentTranscript: null,
      extraContentStatus: 'EMPTY',
      extraContentVerifiedAt: null,
      extraContentVerifiedBy: null,
      extraContentJobStatus: 'SUCCESS',
      extraContentJobError: null,
      extraContentJobRunId: null,
      extraContentJobLeaseExpiresAt: null,
      extraContentJobLeaseRunId: null,
      extraContentJobClaimKind: null,
      extraContentJobDirty: false,
      metadataStatus: expect.objectContaining({ kind: 'sql' }),
      metadataRunId: null,
      metadataRunRevision: null,
      metadataLeaseExpiresAt: null,
      metadataLeaseRunId: null,
      metadataClaimKind: null,
      metadataRevision: expect.objectContaining({ kind: 'sql' }),
      metadataPublished: false,
      transcriptPublished: false,
      updatedAt: expect.any(Date),
    }));
  });

  it('drops verified extra-content back to edited when content is changed directly', async () => {
    updateReturningMock.mockResolvedValueOnce([{ id: 'letter-7' }]);
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-7',
      extraContentStatus: 'VERIFIED',
      transcriptionText: 'Dear Bob',
      metadataRevision: 1,
      metadataStatus: 'SUCCESS',
      metadataRunId: null,
      metadataContentStatus: 'VERIFIED',
      entityExtractionStatus: 'SUCCESS',
      primarySourceRevision: 6,
      updatedAt: new Date('2026-07-17T12:00:00.000Z'),
    });

    const result = await updateExtraContent(
      'letter-7',
      'Corrected note text',
      6,
    );

    expect(result).toBe(true);
    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
      extraContentTranscript: 'Corrected note text',
      extraContentStatus: 'EDITED',
      extraContentVerifiedAt: null,
      extraContentVerifiedBy: null,
      extraContentJobStatus: 'SUCCESS',
      extraContentJobError: null,
      extraContentJobRunId: null,
      extraContentJobLeaseExpiresAt: null,
      extraContentJobLeaseRunId: null,
      extraContentJobClaimKind: null,
      extraContentJobDirty: false,
      metadataStatus: expect.objectContaining({ kind: 'sql' }),
      metadataRunId: null,
      metadataRunRevision: null,
      metadataLeaseExpiresAt: null,
      metadataLeaseRunId: null,
      metadataClaimKind: null,
      metadataRevision: expect.objectContaining({ kind: 'sql' }),
      metadataPublished: false,
      transcriptPublished: false,
      updatedAt: expect.any(Date),
    }));
  });

  it('does not overwrite a newer metadata revision with stale extra content', async () => {
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-extra-raced',
      extraContentStatus: 'EDITED',
      transcriptionText: 'Dear Bob',
      metadataRevision: 4,
      metadataStatus: 'SUCCESS',
      metadataRunId: null,
      metadataContentStatus: 'AI_DRAFT',
      entityExtractionStatus: 'PENDING',
      primarySourceRevision: 6,
      updatedAt: new Date('2026-07-17T12:00:00.000Z'),
    });
    updateReturningMock.mockResolvedValueOnce([]);

    await expect(updateExtraContent(
      'letter-extra-raced',
      'Stale enclosure text',
      6,
    ))
      .rejects.toMatchObject({
        status: 409,
        message: expect.stringContaining('changed before extra content could be saved'),
      });
  });

  it('does not restore extra content loaded before a page-source change', async () => {
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-extra-source-raced',
      extraContentStatus: 'EDITED',
      metadataRevision: 4,
      primarySourceRevision: 7,
    });

    await expect(updateExtraContent(
      'letter-extra-source-raced',
      'Text from the previous page source',
      6,
    )).rejects.toMatchObject({
      statusCode: 409,
      code: 'SOURCE_REVISION_CHANGED',
      message: expect.stringContaining('source changed'),
    });
    expect(dbUpdateMock).not.toHaveBeenCalled();
  });

  it('marks manual photo-description edits as edited when content is added from an empty state', async () => {
    updateReturningMock.mockResolvedValueOnce([{ id: 'photo-1' }]);
    getLetterByIdMock.mockResolvedValue({
      id: 'photo-1',
      type: 'P',
      photoDescriptionStatus: 'EMPTY',
      primarySourceRevision: 9,
    });

    const result = await updatePhotoDescription('photo-1', {
      photoDescription: 'Two children standing on a porch.',
    }, 9);

    expect(result).toBe(true);
    expect(updateSetMock).toHaveBeenCalledWith({
      photoDescription: 'Two children standing on a porch.',
      photoDescriptionStatus: 'EDITED',
      updatedAt: expect.any(Date),
    });
    expect(updateWhereMock).toHaveBeenCalledWith(expect.objectContaining({
      clauses: expect.arrayContaining([{
        kind: 'eq',
        field: 'letters.primarySourceRevision',
        value: 9,
      }]),
    }));
  });

  it('does not restore a photo description loaded before its page source changed', async () => {
    getLetterByIdMock.mockResolvedValue({
      id: 'photo-source-raced',
      type: 'P',
      photoDescriptionStatus: 'EDITED',
      primarySourceRevision: 10,
    });

    await expect(updatePhotoDescription('photo-source-raced', {
      photoDescription: 'Description of the replaced image.',
    }, 9)).rejects.toMatchObject({
      statusCode: 409,
      code: 'SOURCE_REVISION_CHANGED',
      message: expect.stringContaining('source changed'),
    });
    expect(dbUpdateMock).not.toHaveBeenCalled();
  });

  it('resets photo-description verification metadata when content is removed', async () => {
    updateReturningMock.mockResolvedValueOnce([{ id: 'photo-2' }]);
    getLetterByIdMock.mockResolvedValue({
      id: 'photo-2',
      type: 'P',
      photoDescriptionStatus: 'VERIFIED',
      primarySourceRevision: 9,
    });

    const result = await updatePhotoDescription('photo-2', {
      photoDescription: '   ',
    }, 9);

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
    updateReturningMock.mockResolvedValueOnce([{ id: 'photo-3' }]);
    findFirstMock
      .mockResolvedValueOnce({
        id: 'photo-3',
        type: 'P',
        collectionId: 'collection-1',
        dateRaw: '19470810',
        typeSequence: 1,
        primarySourceRevision: 9,
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

    const result = await describePhotoWorkflow(
      'photo-3',
      'Likely Jimmy and Molly',
      9,
    );

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

  it('does not commit a generated photo description after its page source changes', async () => {
    findFirstMock
      .mockResolvedValueOnce({
        id: 'photo-source-raced',
        type: 'P',
        collectionId: 'collection-1',
        dateRaw: '19470810',
        typeSequence: 1,
        primarySourceRevision: 9,
        collection: { collectionCode: '009' },
        pages: [{
          id: 'photo-page-1',
          pageNumber: 1,
          storagePath: 'collections/009/19470810/P01/photo.jpg',
        }],
      })
      .mockResolvedValueOnce(null);
    describePhotoMock.mockResolvedValue({
      text: 'A description generated from the old photo bytes.',
      isStub: false,
    });
    updateReturningMock.mockResolvedValueOnce([]);

    await expect(describePhotoWorkflow(
      'photo-source-raced',
      null,
      9,
    )).rejects.toMatchObject({
      statusCode: 409,
      code: 'SOURCE_REVISION_CHANGED',
      message: expect.stringContaining('source changed'),
    });
    expect(updateWhereMock).toHaveBeenCalledWith(expect.objectContaining({
      clauses: expect.arrayContaining([{
        kind: 'eq',
        field: 'letters.primarySourceRevision',
        value: 9,
      }]),
    }));
  });
});
