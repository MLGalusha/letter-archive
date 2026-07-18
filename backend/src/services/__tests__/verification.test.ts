import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  dbUpdateMock,
  getLetterByIdMock,
  updateSetMock,
  updateWhereMock,
  updateReturningMock,
  generateAndSaveReadingViewMock,
} = vi.hoisted(() => ({
  dbUpdateMock: vi.fn(),
  getLetterByIdMock: vi.fn(),
  updateSetMock: vi.fn(),
  updateWhereMock: vi.fn(),
  updateReturningMock: vi.fn(),
  generateAndSaveReadingViewMock: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...clauses: unknown[]) => ({ kind: 'and', clauses })),
  eq: vi.fn((field: unknown, value: unknown) => ({ kind: 'eq', field, value })),
  isNull: vi.fn((field: unknown) => ({ kind: 'isNull', field })),
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
    db: { update: dbUpdateMock },
    letters: {
      id: 'letters.id',
      updatedAt: 'letters.updatedAt',
      transcriptionStatus: 'letters.transcriptionStatus',
      transcriptionText: 'letters.transcriptionText',
      transcriptStatus: 'letters.transcriptStatus',
      metadataStatus: 'letters.metadataStatus',
      metadataRevision: 'letters.metadataRevision',
      metadataContentStatus: 'letters.metadataContentStatus',
      extraContentStatus: 'letters.extraContentStatus',
    },
  };
});

vi.mock('../letters.js', () => ({ getLetterById: getLetterByIdMock }));

vi.mock('../letter/readingView.js', () => ({
  generateAndSaveReadingView: generateAndSaveReadingViewMock,
}));

vi.mock('../../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

import {
  unverifyExtraContent,
  unverifyMetadata,
  unverifyTranscript,
  verifyExtraContent,
  verifyMetadata,
  verifyTranscript,
} from '../letter/verification.js';

describe('transcript verification ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateReturningMock.mockResolvedValue([{ id: 'updated-letter' }]);
  });

  it('verifies only the exact idle transcript revision the reviewer loaded', async () => {
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-1',
      type: 'T',
      transcriptionStatus: 'SUCCESS',
      transcriptionText: 'Reviewed text',
      transcriptStatus: 'EDITED',
      readingText: null,
    });

    await expect(verifyTranscript('letter-1', 'reviewer-1')).resolves.toEqual({
      previousStatus: 'EDITED',
    });

    expect(updateSetMock).toHaveBeenCalledWith({
      transcriptStatus: 'VERIFIED',
      transcriptVerifiedAt: expect.any(Date),
      transcriptVerifiedBy: 'reviewer-1',
      updatedAt: expect.any(Date),
    });
    expect(updateWhereMock).toHaveBeenCalledWith({
      kind: 'and',
      clauses: [
        { kind: 'eq', field: 'letters.id', value: 'letter-1' },
        { kind: 'eq', field: 'letters.transcriptionStatus', value: 'SUCCESS' },
        { kind: 'eq', field: 'letters.transcriptStatus', value: 'EDITED' },
        { kind: 'eq', field: 'letters.transcriptionText', value: 'Reviewed text' },
      ],
    });
  });

  it('refuses to verify while an AI producer owns the transcript', async () => {
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-2',
      type: 'L',
      transcriptionStatus: 'RUNNING',
      transcriptionText: 'Previously reviewed text',
      transcriptStatus: 'EDITED',
      readingText: null,
    });
    await expect(verifyTranscript('letter-2', 'reviewer-1')).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('must be complete'),
    });
    expect(dbUpdateMock).not.toHaveBeenCalled();
    expect(generateAndSaveReadingViewMock).not.toHaveBeenCalled();
  });

  it('refuses verification when a nullable transcript revision changed after it was loaded', async () => {
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-3',
      type: 'T',
      transcriptionStatus: 'SUCCESS',
      transcriptionText: null,
      transcriptStatus: 'EMPTY',
      readingText: null,
    });
    updateReturningMock.mockResolvedValue([]);

    await expect(verifyTranscript('letter-3', 'reviewer-1')).rejects.toMatchObject({ status: 409 });
    expect(updateWhereMock).toHaveBeenCalledWith(expect.objectContaining({
      clauses: expect.arrayContaining([
        { kind: 'isNull', field: 'letters.transcriptionText' },
      ]),
    }));
  });

  it('unverifies only the exact idle transcript revision the reviewer loaded', async () => {
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-4',
      transcriptionStatus: 'SUCCESS',
      transcriptionText: 'Verified text',
      transcriptStatus: 'VERIFIED',
    });

    await expect(unverifyTranscript('letter-4')).resolves.toBe(true);

    expect(updateSetMock).toHaveBeenCalledWith({
      transcriptStatus: 'EDITED',
      transcriptVerifiedAt: null,
      transcriptVerifiedBy: null,
      transcriptPublished: false,
      updatedAt: expect.any(Date),
    });
    expect(updateWhereMock).toHaveBeenCalledWith({
      kind: 'and',
      clauses: [
        { kind: 'eq', field: 'letters.id', value: 'letter-4' },
        { kind: 'eq', field: 'letters.transcriptionStatus', value: 'SUCCESS' },
        { kind: 'ne', field: 'letters.transcriptionStatus', value: 'RUNNING' },
        { kind: 'eq', field: 'letters.transcriptStatus', value: 'VERIFIED' },
        { kind: 'eq', field: 'letters.transcriptionText', value: 'Verified text' },
      ],
    });
  });

  it('refuses to remove verification while an AI producer owns the transcript', async () => {
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-5',
      transcriptionStatus: 'RUNNING',
      transcriptionText: 'Verified text',
      transcriptStatus: 'VERIFIED',
    });
    updateReturningMock.mockResolvedValue([]);

    await expect(unverifyTranscript('letter-5')).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('changed before verification could be removed'),
    });
  });
});

describe('metadata verification ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateReturningMock.mockResolvedValue([{ id: 'updated-letter' }]);
  });

  it('verifies only the exact idle metadata revision the reviewer loaded', async () => {
    const updatedAt = new Date('2026-07-17T12:00:00.000Z');
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-1',
      metadataStatus: 'SUCCESS',
      metadataRevision: 4,
      metadataContentStatus: 'EDITED',
      updatedAt,
    });

    await expect(verifyMetadata('letter-1', 'reviewer-1')).resolves.toEqual({
      previousStatus: 'EDITED',
    });

    expect(updateSetMock).toHaveBeenCalledWith({
      metadataContentStatus: 'VERIFIED',
      metadataVerifiedAt: expect.any(Date),
      metadataVerifiedBy: 'reviewer-1',
      reviewedAt: expect.any(Date),
      reviewedBy: 'reviewer-1',
      metadataRevision: {
        kind: 'sql',
        strings: ['', ' + 1'],
        values: ['letters.metadataRevision'],
      },
      updatedAt: expect.any(Date),
    });
    expect(updateWhereMock).toHaveBeenCalledWith({
      kind: 'and',
      clauses: [
        { kind: 'eq', field: 'letters.id', value: 'letter-1' },
        { kind: 'eq', field: 'letters.metadataRevision', value: 4 },
        { kind: 'eq', field: 'letters.metadataStatus', value: 'SUCCESS' },
        { kind: 'eq', field: 'letters.metadataContentStatus', value: 'EDITED' },
      ],
    });
  });

  it('refuses to verify metadata before extraction has completed', async () => {
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-2',
      metadataStatus: 'RUNNING',
      metadataRevision: 0,
      metadataContentStatus: 'EDITED',
      updatedAt: new Date('2026-07-17T12:00:00.000Z'),
    });
    await expect(verifyMetadata('letter-2', 'reviewer-1')).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('must be complete'),
    });
    expect(dbUpdateMock).not.toHaveBeenCalled();
  });

  it('refuses to verify successful metadata with no content', async () => {
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-empty',
      metadataStatus: 'SUCCESS',
      metadataRevision: 0,
      metadataContentStatus: 'EMPTY',
      updatedAt: new Date('2026-07-17T12:00:00.000Z'),
    });

    await expect(verifyMetadata('letter-empty', 'reviewer-1')).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('contain content'),
    });
    expect(dbUpdateMock).not.toHaveBeenCalled();
  });

  it('unverifies only an exact idle metadata revision', async () => {
    const updatedAt = new Date('2026-07-17T12:00:00.000Z');
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-3',
      metadataStatus: 'SUCCESS',
      metadataRevision: 9,
      metadataContentStatus: 'VERIFIED',
      updatedAt,
    });

    await expect(unverifyMetadata('letter-3')).resolves.toBe(true);
    expect(updateSetMock).toHaveBeenCalledWith({
      metadataContentStatus: 'EDITED',
      metadataVerifiedAt: null,
      metadataVerifiedBy: null,
      metadataPublished: false,
      metadataRevision: {
        kind: 'sql',
        strings: ['', ' + 1'],
        values: ['letters.metadataRevision'],
      },
      updatedAt: expect.any(Date),
    });
    expect(updateWhereMock).toHaveBeenCalledWith(expect.objectContaining({
      clauses: expect.arrayContaining([
        { kind: 'ne', field: 'letters.metadataStatus', value: 'RUNNING' },
        { kind: 'eq', field: 'letters.metadataRevision', value: 9 },
      ]),
    }));
  });
});

describe('extra-content verification ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateReturningMock.mockResolvedValue([{ id: 'updated-letter' }]);
  });

  it('atomically verifies content and revokes any active AI attempt', async () => {
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-1',
      extraContentStatus: 'EDITED',
      extraContentJobStatus: 'RUNNING',
      extraContentJobRunId: 'old-run',
      extraContentJobDirty: true,
      updatedAt: new Date('2026-07-17T12:00:00.000Z'),
    });

    await expect(verifyExtraContent('letter-1', 'reviewer-1')).resolves.toEqual({
      previousStatus: 'EDITED',
    });

    expect(updateSetMock).toHaveBeenCalledTimes(1);
    expect(updateSetMock).toHaveBeenCalledWith({
      extraContentStatus: 'VERIFIED',
      extraContentVerifiedAt: expect.any(Date),
      extraContentVerifiedBy: 'reviewer-1',
      extraContentJobStatus: 'SUCCESS',
      extraContentJobError: null,
      extraContentJobRunId: null,
      extraContentJobLeaseExpiresAt: null,
      extraContentJobLeaseRunId: null,
      extraContentJobClaimKind: null,
      extraContentJobDirty: false,
      updatedAt: expect.any(Date),
    });
    expect(updateWhereMock).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'and',
    }));
  });

  it('atomically removes verification and revokes any active AI attempt', async () => {
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-2',
      extraContentStatus: 'VERIFIED',
      extraContentJobStatus: 'RUNNING',
      extraContentJobRunId: 'old-run',
      extraContentJobDirty: false,
      updatedAt: new Date('2026-07-17T12:00:00.000Z'),
    });

    await expect(unverifyExtraContent('letter-2')).resolves.toBe(true);

    expect(updateSetMock).toHaveBeenCalledTimes(1);
    expect(updateSetMock).toHaveBeenCalledWith({
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
      updatedAt: expect.any(Date),
    });
    expect(updateWhereMock).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'and',
    }));
  });

  it('refuses to verify a revision that changed after the reviewer loaded it', async () => {
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-3',
      extraContentStatus: 'EDITED',
      updatedAt: new Date('2026-07-17T12:00:00.000Z'),
    });
    updateReturningMock.mockResolvedValue([]);

    await expect(verifyExtraContent('letter-3', 'reviewer-1')).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('changed before it could be verified'),
    });
  });
});
