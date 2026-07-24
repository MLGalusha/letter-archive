import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  findFirstMock,
  findManyMock,
  dbUpdateMock,
  updateSetMock,
  updateWhereMock,
  updateReturningMock,
  checkExtraContentForTextMock,
  transcribeExtraContentMock,
  getAbsoluteStoragePathMock,
  runExtraContentJobMock,
} = vi.hoisted(() => ({
  findFirstMock: vi.fn(),
  findManyMock: vi.fn(),
  dbUpdateMock: vi.fn(),
  updateSetMock: vi.fn(),
  updateWhereMock: vi.fn(),
  updateReturningMock: vi.fn(),
  checkExtraContentForTextMock: vi.fn(),
  transcribeExtraContentMock: vi.fn(),
  getAbsoluteStoragePathMock: vi.fn((path: string) => path),
  runExtraContentJobMock: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...clauses: unknown[]) => ({ kind: 'and', clauses })),
  eq: vi.fn((field: unknown, value: unknown) => ({ kind: 'eq', field, value })),
  inArray: vi.fn((field: unknown, values: unknown[]) => ({ kind: 'inArray', field, values })),
  ne: vi.fn((field: unknown, value: unknown) => ({ kind: 'ne', field, value })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    kind: 'sql',
    strings: Array.from(strings),
    values,
  })),
}));

vi.mock('../../db/index.js', () => {
  dbUpdateMock.mockImplementation(() => ({ set: updateSetMock }));
  updateSetMock.mockImplementation(() => ({ where: updateWhereMock }));
  updateWhereMock.mockImplementation(() => ({ returning: updateReturningMock }));
  return {
    db: {
      query: {
        letters: {
          findFirst: findFirstMock,
          findMany: findManyMock,
        },
      },
      update: dbUpdateMock,
    },
    letters: {
      id: 'letters.id',
      primarySourceRevision: 'letters.primarySourceRevision',
      collectionId: 'letters.collectionId',
      dateRaw: 'letters.dateRaw',
      typeSequence: 'letters.typeSequence',
      type: 'letters.type',
      extraContentJobStatus: 'letters.extraContentJobStatus',
      metadataStatus: 'letters.metadataStatus',
      metadataRunId: 'letters.metadataRunId',
      metadataRevision: 'letters.metadataRevision',
      metadataContentStatus: 'letters.metadataContentStatus',
      metadataError: 'letters.metadataError',
      transcriptionText: 'letters.transcriptionText',
      workflow: 'letters.workflow',
      entityExtractionStatus: 'letters.entityExtractionStatus',
      entityExtractionError: 'letters.entityExtractionError',
      updatedAt: 'letters.updatedAt',
    },
  };
});

vi.mock('../../ai/openai.js', () => ({
  checkExtraContentForText: checkExtraContentForTextMock,
  transcribeExtraContent: transcribeExtraContentMock,
}));

vi.mock('../storage.js', () => ({
  getAbsoluteStoragePath: getAbsoluteStoragePathMock,
}));

vi.mock('../letter/extra-content-job.js', () => ({
  runExtraContentJob: runExtraContentJobMock,
}));

vi.mock('../../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

import {
  runAutomaticExtraContent,
  runRegeneratedExtraContent,
  transcribeExtras,
  tryTranscribeExtras,
} from '../letter/extra-content.js';

const parent = {
  id: 'letter-1',
  primarySourceRevision: 4,
  collectionId: 'collection-1',
  dateRaw: '19470810',
  typeSequence: 1,
  extraContentJobStatus: 'PENDING' as const,
  updatedAt: new Date('2026-07-17T12:00:00.000Z'),
  collection: { collectionCode: '009' },
};

const cover = {
  id: 'cover-1',
  type: 'C',
  pages: [{ id: 'cover-page', storagePath: 'cover.jpg' }],
};

const telegram = {
  id: 'telegram-1',
  type: 'T',
  pages: [{ id: 'telegram-page', storagePath: 'telegram.jpg' }],
};

describe('extra-content producers', () => {
  let producedPatch: Record<string, unknown> | null;
  let ownsLease: boolean;

  beforeEach(() => {
    vi.clearAllMocks();
    producedPatch = null;
    ownsLease = true;
    findFirstMock.mockResolvedValue(parent);
    findManyMock.mockResolvedValue([]);
    updateReturningMock.mockResolvedValue([{ id: parent.id }]);
    checkExtraContentForTextMock.mockResolvedValue({
      hasTranscribableText: true,
      reason: null,
    });
    runExtraContentJobMock.mockImplementation(async ({ produce }) => {
      const produced = await produce({ hasOwnership: () => ownsLease });
      producedPatch = produced.patch;
      return { kind: 'completed', value: produced.value };
    });
  });

  it('does not claim automatic extra work when there are no related items', async () => {
    const result = await runAutomaticExtraContent(parent.id);

    expect(result).toEqual({ kind: 'ineligible', value: 0 });
    expect(runExtraContentJobMock).not.toHaveBeenCalled();
    expect(dbUpdateMock).not.toHaveBeenCalled();
  });

  it('preserves automatic ordering, no-precheck behavior, and numbered headers', async () => {
    findManyMock.mockResolvedValue([cover, telegram]);
    transcribeExtraContentMock
      .mockResolvedValueOnce({ text: '\nTelegram note\n' })
      .mockResolvedValueOnce({ text: 'Envelope note' });

    const result = await runAutomaticExtraContent(parent.id);

    expect(result).toEqual({ kind: 'completed', value: 2 });
    expect(checkExtraContentForTextMock).not.toHaveBeenCalled();
    expect(transcribeExtraContentMock.mock.calls.map(call => call[0].documentType)).toEqual([
      'telegram',
      'cover',
    ]);
    expect(producedPatch).toEqual({
      extraContentTranscript:
        '--- Telegram 1 ---\n\nTelegram note\n\n--- Cover 1 ---\n\nEnvelope note',
      extraContentStatus: 'AI_DRAFT',
      extraContentVerifiedAt: null,
      extraContentVerifiedBy: null,
    });
  });

  it('reloads the source after claiming instead of producing from the preflight snapshot', async () => {
    findManyMock
      .mockResolvedValueOnce([cover])
      .mockResolvedValueOnce([telegram]);
    transcribeExtraContentMock.mockResolvedValue({ text: 'Current telegram' });

    const result = await runAutomaticExtraContent(parent.id);

    expect(result).toEqual({ kind: 'completed', value: 1 });
    expect(findManyMock).toHaveBeenCalledTimes(2);
    expect(getAbsoluteStoragePathMock).toHaveBeenCalledOnce();
    expect(getAbsoluteStoragePathMock).toHaveBeenCalledWith('telegram.jpg');
    expect(producedPatch).toEqual(expect.objectContaining({
      extraContentTranscript: '--- Telegram 1 ---\n\nCurrent telegram',
    }));
  });

  it('only lets automatic work claim a PENDING job', async () => {
    findFirstMock.mockResolvedValue({
      ...parent,
      extraContentJobStatus: 'SUCCESS',
    });
    findManyMock.mockResolvedValue([cover]);
    transcribeExtraContentMock.mockResolvedValue({ text: 'Envelope note' });

    await runAutomaticExtraContent(parent.id);

    expect(runExtraContentJobMock).toHaveBeenCalledWith(expect.objectContaining({
      expectedStatus: 'PENDING',
      expectedUpdatedAt: parent.updatedAt,
      claimKind: 'QUEUED',
    }));
  });

  it('preserves regeneration text checks and always-numbered headers', async () => {
    findManyMock.mockResolvedValue([cover]);
    transcribeExtraContentMock.mockResolvedValue({ text: ' Envelope note ' });

    const result = await runRegeneratedExtraContent(
      parent.id,
      parent.primarySourceRevision,
    );

    expect(result).toEqual({ kind: 'completed', value: 1 });
    expect(checkExtraContentForTextMock).toHaveBeenCalledOnce();
    expect(runExtraContentJobMock).toHaveBeenCalledWith(expect.objectContaining({
      claimKind: 'REQUESTED',
    }));
    expect(producedPatch).toEqual({
      extraContentTranscript: '--- Cover 1 ---\n\nEnvelope note',
      extraContentStatus: 'AI_DRAFT',
      extraContentVerifiedAt: null,
      extraContentVerifiedBy: null,
    });
  });

  it('preserves standalone conditional header numbering', async () => {
    findManyMock.mockResolvedValue([cover]);
    transcribeExtraContentMock.mockResolvedValue({ text: 'Envelope note' });

    const result = await transcribeExtras(parent.id, parent.primarySourceRevision);

    expect(result).toEqual({
      transcribedCount: 1,
      extraContentStatus: 'AI_DRAFT',
    });
    expect(producedPatch).toEqual({
      extraContentTranscript: '--- Cover ---\n\nEnvelope note',
      extraContentStatus: 'AI_DRAFT',
      extraContentVerifiedAt: null,
      extraContentVerifiedBy: null,
    });
    expect(runExtraContentJobMock).toHaveBeenCalledWith(expect.objectContaining({
      claimKind: 'REQUESTED',
    }));
  });

  it('clears empty standalone content without claiming a nonexistent job', async () => {
    const result = await transcribeExtras(parent.id, parent.primarySourceRevision);

    expect(result).toEqual({
      transcribedCount: 0,
      extraContentStatus: 'EMPTY',
      message: 'No extra content found to transcribe',
    });
    expect(runExtraContentJobMock).not.toHaveBeenCalled();
    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
      extraContentStatus: 'EMPTY',
      extraContentTranscript: null,
      extraContentVerifiedAt: null,
      extraContentVerifiedBy: null,
      metadataRunId: null,
      metadataRunRevision: null,
      metadataLeaseExpiresAt: null,
      metadataLeaseRunId: null,
      metadataClaimKind: null,
      metadataPublished: false,
      transcriptPublished: false,
      updatedAt: expect.any(Date),
    }));
  });

  it('does not clear empty content when the preflight revision lost ownership', async () => {
    updateReturningMock.mockResolvedValue([]);

    await expect(
      transcribeExtras(parent.id, parent.primarySourceRevision),
    ).rejects.toMatchObject({
      status: 409,
      message: 'Extra content transcription conflicted with another job update',
    });
  });

  it('maps direct claim loss to a 409 contract', async () => {
    findManyMock.mockResolvedValue([cover]);
    runExtraContentJobMock.mockResolvedValue({ kind: 'claim_lost' });

    await expect(
      transcribeExtras(parent.id, parent.primarySourceRevision),
    ).rejects.toMatchObject({
      status: 409,
      message: 'Extra content transcription conflicted with another job update',
    });
  });

  it('rejects stale direct extra-content requests before claiming or calling AI', async () => {
    findFirstMock.mockResolvedValue({
      ...parent,
      primarySourceRevision: 5,
    });
    findManyMock.mockResolvedValue([cover]);

    await expect(transcribeExtras(parent.id, 4)).rejects.toMatchObject({
      statusCode: 409,
      code: 'SOURCE_REVISION_CHANGED',
    });

    expect(runExtraContentJobMock).not.toHaveBeenCalled();
    expect(transcribeExtraContentMock).not.toHaveBeenCalled();
  });

  it('lets dashboard work require the PENDING status explicitly', async () => {
    findManyMock.mockResolvedValue([cover]);
    transcribeExtraContentMock.mockResolvedValue({ text: 'Envelope note' });

    await tryTranscribeExtras(parent.id, {
      expectedStatus: 'PENDING',
      claimKind: 'QUEUED',
      workerExecutionToken: 'execution-a',
    });

    expect(runExtraContentJobMock).toHaveBeenCalledWith(expect.objectContaining({
      letterId: parent.id,
      expectedStatus: 'PENDING',
      claimKind: 'QUEUED',
      workerExecutionToken: 'execution-a',
    }));
  });

  it('stops between AI calls after the heartbeat reports ownership loss', async () => {
    const secondCover = {
      ...cover,
      id: 'cover-2',
      pages: [{ id: 'cover-page-2', storagePath: 'cover-2.jpg' }],
    };
    findManyMock.mockResolvedValue([cover, secondCover]);
    transcribeExtraContentMock.mockImplementation(async () => {
      ownsLease = false;
      return { text: 'Now stale' };
    });

    await expect(runAutomaticExtraContent(parent.id)).rejects.toBeInstanceOf(Error);
    expect(transcribeExtraContentMock).toHaveBeenCalledTimes(1);
  });
});
