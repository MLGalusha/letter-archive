import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  deleteReplaceableEntityProjectionMock,
  selectPagesMock,
  updateReturningMock,
  updateSetMock,
} = vi.hoisted(() => ({
  deleteReplaceableEntityProjectionMock: vi.fn(),
  selectPagesMock: vi.fn(),
  updateReturningMock: vi.fn(),
  updateSetMock: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...clauses: unknown[]) => ({ kind: 'and', clauses })),
  asc: vi.fn((field: unknown) => ({ kind: 'asc', field })),
  eq: vi.fn((field: unknown, value: unknown) => ({ kind: 'eq', field, value })),
  ne: vi.fn((field: unknown, value: unknown) => ({ kind: 'ne', field, value })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    kind: 'sql',
    strings,
    values,
  })),
}));

vi.mock('../../db/index.js', () => ({
  collections: {
    id: 'collections.id',
    profileStatus: 'collections.profileStatus',
    profileRevision: 'collections.profileRevision',
  },
  letters: new Proxy({}, {
    get: (_target, property) => `letters.${String(property)}`,
  }),
  letterPages: new Proxy({}, {
    get: (_target, property) => `letterPages.${String(property)}`,
  }),
}));

vi.mock('../entities/extraction.js', () => ({
  deleteReplaceableEntityProjection: deleteReplaceableEntityProjectionMock,
}));

vi.mock('../letter/extra-content-job.js', () => ({
  buildExtraContentSourceInvalidationPatch: () => ({
    extraContentLifecycle: 'invalidated',
  }),
}));

vi.mock('../letter/metadata-job.js', () => ({
  buildMetadataSourceInvalidationPatch: () => ({
    metadataLifecycle: 'invalidated',
    metadataPublished: false,
    transcriptPublished: false,
  }),
  clearedTranscriptConfirmationIntent: () => ({
    transcriptConfirmationId: null,
    transcriptConfirmationIntentHash: null,
    transcriptConfirmationSourceRevision: null,
    transcriptConfirmationTranscriptDigest: null,
    metadataConfirmationGuidance: null,
    metadataGuidanceRunId: null,
  }),
}));

vi.mock('../letter/transcription-job.js', () => ({
  clearedTranscriptionOwnership: () => ({
    transcriptionRunId: null,
    transcriptionLeaseExpiresAt: null,
    transcriptionLeaseRunId: null,
    transcriptionClaimKind: null,
  }),
}));

import {
  invalidateExtraContentSource,
  invalidatePrimaryLetterSource,
  invalidateRelatedPageSource,
} from '../letter/page-source-invalidation.js';

function lockedGroup(
  ownerType: 'L' | 'P' | 'E' | 'V' | 'A' | 'D' | 'C' | 'N' | 'T' = 'L',
) {
  const primary = {
    id: 'letter-1',
    type: 'L' as const,
    collectionId: 'collection-1',
    dateRaw: '19470810',
    typeSequence: 1,
    primarySourceRevision: 7,
    visibility: 'HIDDEN' as const,
    transcriptPublished: false,
    metadataPublished: false,
    transcriptStatus: 'EDITED' as const,
    metadataContentStatus: 'EDITED' as const,
  };
  const owner = ownerType === 'L'
    ? primary
    : {
        id: 'companion-1',
        type: ownerType,
        collectionId: 'collection-1',
        dateRaw: '19470810',
        typeSequence: 1,
        primarySourceRevision: 0,
        visibility: 'HIDDEN' as const,
        transcriptPublished: false,
        metadataPublished: false,
        transcriptStatus: 'EDITED' as const,
        metadataContentStatus: 'EDITED' as const,
      };

  return {
    identity: {
      collectionId: 'collection-1',
      dateRaw: '19470810',
      typeSequence: 1,
    },
    collection: {
      id: 'collection-1',
      highlightImageId: null,
    },
    owner,
    members: ownerType === 'L'
      ? [{
          id: 'companion-1',
          type: 'P' as const,
          collectionId: 'collection-1',
          dateRaw: '19470810',
          typeSequence: 1,
          primarySourceRevision: 0,
          visibility: 'HIDDEN' as const,
          transcriptPublished: false,
          metadataPublished: false,
          transcriptStatus: 'EDITED' as const,
          metadataContentStatus: 'EDITED' as const,
        }, primary]
      : [owner, primary],
    currentSourceRevision: 7,
    nextSourceRevision: 8,
  };
}

function database() {
  const returning = vi.fn(() => updateReturningMock());
  const where = vi.fn(() => ({ returning }));
  const set = vi.fn((patch: unknown) => {
    updateSetMock(patch);
    return { where };
  });
  const update = vi.fn(() => ({ set }));
  const select = vi.fn((selection: Record<string, unknown>) => ({
    from: vi.fn(() => ({
      where: vi.fn(() => {
        if (Object.hasOwn(selection, 'lineSegments')) {
          return selectPagesMock();
        }
        throw new Error('Unexpected select in source invalidation test');
      }),
    })),
  }));
  const deleteRow = vi.fn();

  return {
    select,
    update,
    delete: deleteRow,
  };
}

describe('page source invalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateReturningMock.mockResolvedValue([{ id: 'letter-1' }]);
    selectPagesMock.mockResolvedValue([{
      id: 'page-2',
      segmentTrustState: 'trusted',
      lineSegments: [{
        line: 1,
        bbox: [0, 0, 1, 1],
        isMapped: true,
        mappedText: 'stale transcript line',
      }],
    }, {
      id: 'page-3',
      segmentTrustState: 'trusted',
      lineSegments: [{ line: 2, bbox: [0, 1, 1, 2] }],
    }]);
  });

  it('revokes the complete primary-source authority and private projections', async () => {
    const executor = database();

    await invalidatePrimaryLetterSource(lockedGroup(), executor as never);

    expect(updateSetMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        workflow: 'UPLOADED',
        visibility: 'HIDDEN',
        reviewedAt: null,
        reviewedBy: null,
        transcriptionStatus: 'PENDING',
        transcriptionRunId: null,
        transcriptionLeaseExpiresAt: null,
        transcriptionLeaseRunId: null,
        transcriptionClaimKind: null,
        transcriptionError: null,
        transcriptionAttemptCount: 0,
        transcriptionJson: null,
        readingText: null,
        transcriptConfirmedAt: null,
        transcriptConfirmedBy: null,
        transcriptVerifiedAt: null,
        transcriptVerifiedBy: null,
        transcriptPublished: false,
        metadataPublished: false,
        deadLetter: false,
        metadataLifecycle: 'invalidated',
        primarySourceRevision: 8,
      }),
    );
    expect(updateSetMock.mock.calls[0]?.[0]).not.toHaveProperty(
      'extraContentLifecycle',
    );
    expect(deleteReplaceableEntityProjectionMock).toHaveBeenCalledWith(
      executor,
      'letter-1',
    );
    expect(updateSetMock).toHaveBeenNthCalledWith(
      2,
      {
        lineSegments: [{
          line: 1,
          bbox: [0, 0, 1, 1],
        }],
        updatedAt: expect.any(Date),
      },
    );
    expect(updateSetMock.mock.calls[1]?.[0]).not.toHaveProperty(
      'segmentTrustState',
    );
    expect(updateSetMock.mock.calls[1]?.[0]).not.toHaveProperty(
      'approvedGeometryRevision',
    );
    expect(updateSetMock).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        visibility: 'HIDDEN',
        reviewedAt: null,
        reviewedBy: null,
        primarySourceRevision: 8,
      }),
    );
    expect(updateSetMock).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        profileRevision: expect.objectContaining({ kind: 'sql' }),
        profileStatus: expect.objectContaining({ kind: 'sql' }),
      }),
    );
  });

  it('refuses to invalidate a missing or non-L primary owner', async () => {
    const executor = database();

    await expect(
      invalidatePrimaryLetterSource(lockedGroup('P'), executor as never),
    ).rejects.toThrow('is not an L letter');

    expect(executor.update).not.toHaveBeenCalled();
    expect(deleteReplaceableEntityProjectionMock).not.toHaveBeenCalled();
  });

  it('preserves the live extra-content lifecycle while revoking downstream authority', async () => {
    const executor = database();

    await invalidateExtraContentSource(lockedGroup('T'), executor as never);

    expect(updateSetMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        extraContentLifecycle: 'invalidated',
        metadataLifecycle: 'invalidated',
        visibility: 'HIDDEN',
        reviewedAt: null,
        reviewedBy: null,
        extraContentVerifiedAt: null,
        extraContentVerifiedBy: null,
      }),
    );
    expect(updateSetMock.mock.calls[0]?.[0]).not.toHaveProperty(
      'primarySourceRevision',
    );
    expect(updateSetMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        visibility: 'HIDDEN',
        reviewedAt: null,
        reviewedBy: null,
        primarySourceRevision: 8,
      }),
    );
  });

  it('hides related page groups, advances their epoch, and demotes P authority', async () => {
    const executor = database();

    await invalidateRelatedPageSource(lockedGroup('V'), executor as never);

    expect(updateSetMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        visibility: 'HIDDEN',
        reviewedAt: null,
        reviewedBy: null,
        primarySourceRevision: 8,
      }),
    );
    expect(updateSetMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        photoDescriptionStatus: expect.objectContaining({ kind: 'sql' }),
        photoDescriptionVerifiedAt: null,
        photoDescriptionVerifiedBy: null,
      }),
    );
    expect(updateSetMock).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        profileRevision: expect.objectContaining({ kind: 'sql' }),
        profileStatus: expect.objectContaining({ kind: 'sql' }),
      }),
    );
  });
});
