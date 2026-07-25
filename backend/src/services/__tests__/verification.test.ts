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
      metadataRunId: 'letters.metadataRunId',
      metadataRunRevision: 'letters.metadataRunRevision',
      metadataLeaseExpiresAt: 'letters.metadataLeaseExpiresAt',
      metadataLeaseRunId: 'letters.metadataLeaseRunId',
      metadataClaimKind: 'letters.metadataClaimKind',
      metadataConfirmationGuidance: 'letters.metadataConfirmationGuidance',
      metadataGuidanceRunId: 'letters.metadataGuidanceRunId',
      metadataContentStatus: 'letters.metadataContentStatus',
      primarySourceRevision: 'letters.primarySourceRevision',
      workflow: 'letters.workflow',
      entityExtractionStatus: 'letters.entityExtractionStatus',
      entityExtractionError: 'letters.entityExtractionError',
      entityExtractionRunId: 'letters.entityExtractionRunId',
      entityExtractionRunRevision: 'letters.entityExtractionRunRevision',
      entityExtractionLeaseExpiresAt: 'letters.entityExtractionLeaseExpiresAt',
      entityExtractionLeaseRunId: 'letters.entityExtractionLeaseRunId',
      entityExtractionClaimKind: 'letters.entityExtractionClaimKind',
      extraContentStatus: 'letters.extraContentStatus',
      photoDescription: 'letters.photoDescription',
      photoDescriptionStatus: 'letters.photoDescriptionStatus',
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
  unverifyPhotoDescription,
  unverifyTranscript,
  verifyExtraContent,
  verifyMetadata,
  verifyPhotoDescription,
  verifyTranscript,
} from '../letter/verification.js';
import { SourceRevisionChangedError } from '../letter/source-revision.js';

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
      primarySourceRevision: 7,
    });

    await expect(verifyTranscript('letter-1', 7, 'reviewer-1')).resolves.toEqual({
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
        { kind: 'eq', field: 'letters.primarySourceRevision', value: 7 },
        { kind: 'eq', field: 'letters.transcriptionStatus', value: 'SUCCESS' },
        { kind: 'eq', field: 'letters.transcriptStatus', value: 'EDITED' },
        { kind: 'eq', field: 'letters.transcriptionText', value: 'Reviewed text' },
      ],
    });
  });

  it('binds automatic reading-view generation to the verified source epoch', async () => {
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-reading-view',
      type: 'L',
      transcriptionStatus: 'SUCCESS',
      transcriptionText: 'Reviewed text',
      transcriptStatus: 'EDITED',
      readingText: null,
      primarySourceRevision: 7,
    });
    generateAndSaveReadingViewMock.mockResolvedValueOnce('Reading view');

    await expect(
      verifyTranscript('letter-reading-view', 7, 'reviewer-1'),
    ).resolves.toEqual({ previousStatus: 'EDITED' });

    expect(generateAndSaveReadingViewMock).toHaveBeenCalledWith(
      'letter-reading-view',
      7,
    );
  });

  it('surfaces a source replacement that wins during automatic reading-view generation', async () => {
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-reading-view-raced',
      type: 'L',
      transcriptionStatus: 'SUCCESS',
      transcriptionText: 'Reviewed text',
      transcriptStatus: 'EDITED',
      readingText: null,
      primarySourceRevision: 7,
    });
    generateAndSaveReadingViewMock.mockRejectedValueOnce(
      new SourceRevisionChangedError(
        'Letter source changed before the reading view could be saved',
      ),
    );

    await expect(
      verifyTranscript('letter-reading-view-raced', 7, 'reviewer-1'),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'SOURCE_REVISION_CHANGED',
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
      primarySourceRevision: 7,
    });
    await expect(verifyTranscript('letter-2', 7, 'reviewer-1')).rejects.toMatchObject({
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
      primarySourceRevision: 7,
    });
    updateReturningMock.mockResolvedValue([]);

    await expect(verifyTranscript('letter-3', 7, 'reviewer-1')).rejects.toMatchObject({ status: 409 });
    expect(updateWhereMock).toHaveBeenCalledWith(expect.objectContaining({
      clauses: expect.arrayContaining([
        { kind: 'isNull', field: 'letters.transcriptionText' },
      ]),
    }));
  });

  it('rejects transcript verification loaded before a page-source change', async () => {
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-source-raced',
      type: 'L',
      transcriptionStatus: 'SUCCESS',
      transcriptionText: 'Newer source transcript',
      transcriptStatus: 'EDITED',
      readingText: null,
      primarySourceRevision: 8,
    });

    await expect(
      verifyTranscript('letter-source-raced', 7, 'reviewer-1'),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'SOURCE_REVISION_CHANGED',
      message: expect.stringContaining('source changed'),
    });
    expect(dbUpdateMock).not.toHaveBeenCalled();
  });

  it('unverifies only the exact idle transcript revision the reviewer loaded', async () => {
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-4',
      transcriptionStatus: 'SUCCESS',
      transcriptionText: 'Verified text',
      transcriptStatus: 'VERIFIED',
      primarySourceRevision: 7,
    });

    await expect(unverifyTranscript('letter-4', 7)).resolves.toBe(true);

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
        { kind: 'eq', field: 'letters.primarySourceRevision', value: 7 },
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
      primarySourceRevision: 7,
    });
    updateReturningMock.mockResolvedValue([]);

    await expect(unverifyTranscript('letter-5', 7)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('changed before verification could be removed'),
    });
  });

  it('does not remove transcript verification loaded before a page-source change', async () => {
    getLetterByIdMock.mockResolvedValue({
      id: 'transcript-unverify-source-raced',
      transcriptionStatus: 'SUCCESS',
      transcriptionText: 'Replacement transcript',
      transcriptStatus: 'VERIFIED',
      primarySourceRevision: 8,
    });

    await expect(
      unverifyTranscript('transcript-unverify-source-raced', 7),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'SOURCE_REVISION_CHANGED',
      message: expect.stringContaining('source changed'),
    });
    expect(dbUpdateMock).not.toHaveBeenCalled();
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
      primarySourceRevision: 7,
    });

    await expect(verifyMetadata('letter-1', 7, 'reviewer-1')).resolves.toEqual({
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
        { kind: 'eq', field: 'letters.primarySourceRevision', value: 7 },
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
      primarySourceRevision: 7,
    });
    await expect(verifyMetadata('letter-2', 7, 'reviewer-1')).rejects.toMatchObject({
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
      primarySourceRevision: 7,
    });

    await expect(verifyMetadata('letter-empty', 7, 'reviewer-1')).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('contain content'),
    });
    expect(dbUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects metadata verification loaded before a page-source change', async () => {
    getLetterByIdMock.mockResolvedValue({
      id: 'metadata-source-raced',
      metadataStatus: 'SUCCESS',
      metadataRevision: 4,
      metadataContentStatus: 'EDITED',
      updatedAt: new Date('2026-07-17T12:00:00.000Z'),
      primarySourceRevision: 8,
    });

    await expect(
      verifyMetadata('metadata-source-raced', 7, 'reviewer-1'),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'SOURCE_REVISION_CHANGED',
      message: expect.stringContaining('source changed'),
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
      primarySourceRevision: 7,
    });

    await expect(unverifyMetadata('letter-3', 7)).resolves.toBe(true);
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
        { kind: 'eq', field: 'letters.primarySourceRevision', value: 7 },
        { kind: 'ne', field: 'letters.metadataStatus', value: 'RUNNING' },
        { kind: 'eq', field: 'letters.metadataRevision', value: 9 },
      ]),
    }));
  });

  it('does not remove metadata verification loaded before a page-source change', async () => {
    getLetterByIdMock.mockResolvedValue({
      id: 'metadata-unverify-source-raced',
      metadataStatus: 'SUCCESS',
      metadataRevision: 10,
      metadataContentStatus: 'VERIFIED',
      updatedAt: new Date('2026-07-17T12:00:01.000Z'),
      primarySourceRevision: 8,
    });

    await expect(
      unverifyMetadata('metadata-unverify-source-raced', 7),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'SOURCE_REVISION_CHANGED',
      message: expect.stringContaining('source changed'),
    });
    expect(dbUpdateMock).not.toHaveBeenCalled();
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
      metadataStatus: 'RUNNING',
      metadataRunId: 'active-metadata-run',
      metadataRevision: 11,
      primarySourceRevision: 7,
      updatedAt: new Date('2026-07-17T12:00:00.000Z'),
    });

    await expect(verifyExtraContent('letter-1', 7, 'reviewer-1')).resolves.toEqual({
      previousStatus: 'EDITED',
    });

    expect(updateSetMock).toHaveBeenCalledTimes(1);
    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
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
      metadataConfirmationGuidance: null,
      metadataGuidanceRunId: null,
      metadataRunId: null,
      metadataRunRevision: null,
      metadataLeaseExpiresAt: null,
      metadataLeaseRunId: null,
      metadataClaimKind: null,
      metadataAttemptCount: 0,
      metadataStatus: expect.objectContaining({
        kind: 'sql',
        values: expect.arrayContaining(['letters.metadataStatus']),
      }),
      metadataRevision: {
        kind: 'sql',
        strings: ['', ' + 1'],
        values: ['letters.metadataRevision'],
      },
      updatedAt: expect.any(Date),
    }));
    expect(updateWhereMock).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'and',
      clauses: expect.arrayContaining([
        {
          kind: 'eq',
          field: 'letters.primarySourceRevision',
          value: 7,
        },
        expect.objectContaining({
          kind: 'sql',
          values: expect.arrayContaining(['letters.updatedAt']),
        }),
      ]),
    }));
  });

  it('atomically removes verification and revokes any active AI attempt', async () => {
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-2',
      extraContentStatus: 'VERIFIED',
      extraContentJobStatus: 'RUNNING',
      extraContentJobRunId: 'old-run',
      extraContentJobDirty: false,
      metadataStatus: 'RUNNING',
      metadataRunId: 'active-metadata-run',
      metadataRevision: 12,
      primarySourceRevision: 7,
      updatedAt: new Date('2026-07-17T12:00:00.000Z'),
    });

    await expect(unverifyExtraContent('letter-2', 7)).resolves.toBe(true);

    expect(updateSetMock).toHaveBeenCalledTimes(1);
    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
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
      metadataConfirmationGuidance: null,
      metadataGuidanceRunId: null,
      metadataRunId: null,
      metadataRunRevision: null,
      metadataLeaseExpiresAt: null,
      metadataLeaseRunId: null,
      metadataClaimKind: null,
      metadataAttemptCount: 0,
      metadataStatus: expect.objectContaining({
        kind: 'sql',
        values: expect.arrayContaining(['letters.metadataStatus']),
      }),
      metadataRevision: {
        kind: 'sql',
        strings: ['', ' + 1'],
        values: ['letters.metadataRevision'],
      },
      updatedAt: expect.any(Date),
    }));
    expect(updateWhereMock).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'and',
      clauses: expect.arrayContaining([
        {
          kind: 'eq',
          field: 'letters.primarySourceRevision',
          value: 7,
        },
        expect.objectContaining({
          kind: 'sql',
          values: expect.arrayContaining(['letters.updatedAt']),
        }),
      ]),
    }));
  });

  it('refuses to verify a revision that changed after the reviewer loaded it', async () => {
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-3',
      extraContentStatus: 'EDITED',
      primarySourceRevision: 7,
      updatedAt: new Date('2026-07-17T12:00:00.000Z'),
    });
    updateReturningMock.mockResolvedValue([]);

    await expect(verifyExtraContent('letter-3', 7, 'reviewer-1')).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('changed before it could be verified'),
    });
  });

  it('rejects an extra-content verification loaded before a page-source change', async () => {
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-source-raced',
      extraContentStatus: 'EDITED',
      primarySourceRevision: 8,
      updatedAt: new Date('2026-07-17T12:00:00.000Z'),
    });

    await expect(
      verifyExtraContent('letter-source-raced', 7, 'reviewer-1'),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'SOURCE_REVISION_CHANGED',
      message: expect.stringContaining('source changed'),
    });
    expect(dbUpdateMock).not.toHaveBeenCalled();
  });
});

describe('photo-description verification ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateReturningMock.mockResolvedValue([{ id: 'updated-letter' }]);
  });

  it('verifies the exact description revision the reviewer loaded', async () => {
    const updatedAt = new Date('2026-07-18T12:00:00.000Z');
    getLetterByIdMock.mockResolvedValue({
      id: 'photo-1',
      photoDescription: 'Two children standing beside a porch railing.',
      photoDescriptionStatus: 'EDITED',
      primarySourceRevision: 11,
      updatedAt,
    });

    await expect(
      verifyPhotoDescription('photo-1', 11, 'reviewer-1'),
    ).resolves.toEqual({
      previousStatus: 'EDITED',
    });

    expect(updateSetMock).toHaveBeenCalledWith({
      photoDescriptionStatus: 'VERIFIED',
      photoDescriptionVerifiedAt: expect.any(Date),
      photoDescriptionVerifiedBy: 'reviewer-1',
      updatedAt: expect.any(Date),
    });
    expect(updateWhereMock).toHaveBeenCalledWith({
      kind: 'and',
      clauses: [
        { kind: 'eq', field: 'letters.id', value: 'photo-1' },
        {
          kind: 'eq',
          field: 'letters.primarySourceRevision',
          value: 11,
        },
        {
          kind: 'sql',
          strings: ["date_trunc('milliseconds', ", ') = ', '::timestamptz'],
          values: ['letters.updatedAt', updatedAt.toISOString()],
        },
        { kind: 'eq', field: 'letters.photoDescriptionStatus', value: 'EDITED' },
        {
          kind: 'eq',
          field: 'letters.photoDescription',
          value: 'Two children standing beside a porch railing.',
        },
      ],
    });
  });

  it('refuses to verify when an edit or regeneration changes the observed description first', async () => {
    getLetterByIdMock.mockResolvedValue({
      id: 'photo-2',
      photoDescription: 'The description the reviewer loaded.',
      photoDescriptionStatus: 'AI_DRAFT',
      primarySourceRevision: 11,
      updatedAt: new Date('2026-07-18T12:00:00.000Z'),
    });
    updateReturningMock.mockResolvedValue([]);

    await expect(
      verifyPhotoDescription('photo-2', 11, 'reviewer-1'),
    ).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('changed before it could be verified'),
    });
  });

  it('unverifies only the exact description revision the reviewer loaded', async () => {
    const updatedAt = new Date('2026-07-18T12:00:00.000Z');
    getLetterByIdMock.mockResolvedValue({
      id: 'photo-3',
      photoDescription: 'A verified porch scene.',
      photoDescriptionStatus: 'VERIFIED',
      primarySourceRevision: 11,
      updatedAt,
    });

    await expect(unverifyPhotoDescription('photo-3', 11)).resolves.toBe(true);

    expect(updateSetMock).toHaveBeenCalledWith({
      photoDescriptionStatus: 'EDITED',
      photoDescriptionVerifiedAt: null,
      photoDescriptionVerifiedBy: null,
      updatedAt: expect.any(Date),
    });
    expect(updateWhereMock).toHaveBeenCalledWith({
      kind: 'and',
      clauses: [
        { kind: 'eq', field: 'letters.id', value: 'photo-3' },
        {
          kind: 'eq',
          field: 'letters.primarySourceRevision',
          value: 11,
        },
        {
          kind: 'sql',
          strings: ["date_trunc('milliseconds', ", ') = ', '::timestamptz'],
          values: ['letters.updatedAt', updatedAt.toISOString()],
        },
        { kind: 'eq', field: 'letters.photoDescriptionStatus', value: 'VERIFIED' },
        {
          kind: 'eq',
          field: 'letters.photoDescription',
          value: 'A verified porch scene.',
        },
      ],
    });
  });

  it('refuses to remove verification from a newer photo-description revision', async () => {
    getLetterByIdMock.mockResolvedValue({
      id: 'photo-4',
      photoDescription: 'The description the reviewer loaded.',
      photoDescriptionStatus: 'VERIFIED',
      primarySourceRevision: 11,
      updatedAt: new Date('2026-07-18T12:00:00.000Z'),
    });
    updateReturningMock.mockResolvedValue([]);

    await expect(unverifyPhotoDescription('photo-4', 11)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('changed before verification could be removed'),
    });
  });

  it('rejects photo verification loaded before a page-source change', async () => {
    getLetterByIdMock.mockResolvedValue({
      id: 'photo-source-raced',
      photoDescription: 'Stale photo description.',
      photoDescriptionStatus: 'EDITED',
      primarySourceRevision: 12,
      updatedAt: new Date('2026-07-18T12:00:00.000Z'),
    });

    await expect(
      verifyPhotoDescription('photo-source-raced', 11, 'reviewer-1'),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'SOURCE_REVISION_CHANGED',
      message: expect.stringContaining('source changed'),
    });
    expect(dbUpdateMock).not.toHaveBeenCalled();
  });
});
