import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  transactionMock,
  updateMock,
  updateSetMock,
  updateWhereMock,
  updateReturningMock,
  lockCorrespondenceGroupMock,
  advanceCollectionProfileRevisionMock,
} = vi.hoisted(() => ({
  transactionMock: vi.fn(),
  updateMock: vi.fn(),
  updateSetMock: vi.fn(),
  updateWhereMock: vi.fn(),
  updateReturningMock: vi.fn(),
  lockCorrespondenceGroupMock: vi.fn(),
  advanceCollectionProfileRevisionMock: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...clauses: unknown[]) => ({ kind: 'and', clauses })),
  eq: vi.fn((field: unknown, value: unknown) => ({ kind: 'eq', field, value })),
  inArray: vi.fn((field: unknown, values: unknown[]) => ({
    kind: 'inArray',
    field,
    values,
  })),
  ne: vi.fn((field: unknown, value: unknown) => ({ kind: 'ne', field, value })),
}));

vi.mock('../../db/index.js', () => {
  updateMock.mockImplementation(() => ({ set: updateSetMock }));
  updateSetMock.mockImplementation(() => ({ where: updateWhereMock }));
  updateWhereMock.mockImplementation(() => ({ returning: updateReturningMock }));
  const tx = {
    select: vi.fn(),
    update: updateMock,
  };
  transactionMock.mockImplementation(
    async (callback: (database: typeof tx) => Promise<unknown>) => callback(tx),
  );

  return {
    db: {
      transaction: transactionMock,
      select: vi.fn(),
    },
    letters: {
      id: 'letters.id',
      collectionId: 'letters.collectionId',
      dateRaw: 'letters.dateRaw',
      typeSequence: 'letters.typeSequence',
      primarySourceRevision: 'letters.primarySourceRevision',
      visibility: 'letters.visibility',
    },
  };
});

vi.mock('../letter/correspondence-group.js', () => ({
  lockCorrespondenceGroupByLetterId: lockCorrespondenceGroupMock,
}));

vi.mock('../collection-profile-mutations.js', () => ({
  advanceCollectionProfileRevision: advanceCollectionProfileRevisionMock,
}));

import {
  applyBulkPublicationAction,
  applyPublicationMutation,
} from '../letter/publication-mutations.js';

function group(overrides: {
  ownerVisibility?: 'PUBLISHED' | 'HIDDEN';
  companionVisibility?: 'PUBLISHED' | 'HIDDEN';
  sourceRevision?: number;
  transcriptStatus?: string;
  metadataStatus?: string;
  transcriptPublished?: boolean;
  metadataPublished?: boolean;
} = {}) {
  const owner = {
    id: 'letter-a',
    collectionId: 'collection-1',
    dateRaw: '19470810',
    typeSequence: 1,
    type: 'L' as const,
    primarySourceRevision: overrides.sourceRevision ?? 4,
    visibility: overrides.ownerVisibility ?? 'HIDDEN',
    transcriptPublished: overrides.transcriptPublished ?? false,
    metadataPublished: overrides.metadataPublished ?? false,
    transcriptStatus: overrides.transcriptStatus ?? 'VERIFIED',
    metadataContentStatus: overrides.metadataStatus ?? 'VERIFIED',
  };
  return {
    identity: {
      collectionId: owner.collectionId,
      dateRaw: owner.dateRaw,
      typeSequence: owner.typeSequence,
    },
    collection: {
      id: owner.collectionId,
      highlightImageId: null,
    },
    owner,
    members: [
      owner,
      {
        ...owner,
        id: 'letter-b',
        type: 'C' as const,
        visibility: overrides.companionVisibility ?? owner.visibility,
      },
    ],
  };
}

function singleMemberGroup(letterId: string, sourceRevision = 4) {
  const correspondence = group({ sourceRevision });
  const owner = {
    ...correspondence.owner,
    id: letterId,
  };
  return {
    ...correspondence,
    owner,
    members: [owner],
  };
}

function companionTargetGroup(options: {
  companionSourceRevision?: number;
  published?: boolean;
} = {}) {
  const correspondence = group({ sourceRevision: 9 });
  const root = {
    ...correspondence.owner,
    id: 'letter-z',
    type: 'L' as const,
    primarySourceRevision: 9,
    visibility: options.published ? 'PUBLISHED' as const : 'HIDDEN' as const,
    transcriptPublished: options.published ?? false,
    metadataPublished: options.published ?? false,
  };
  const companion = {
    ...correspondence.owner,
    id: 'letter-a',
    type: 'P' as const,
    primarySourceRevision: options.companionSourceRevision ?? 3,
    visibility: options.published ? 'PUBLISHED' as const : 'HIDDEN' as const,
    metadataPublished: options.published ?? false,
  };
  return {
    ...correspondence,
    owner: companion,
    members: [companion, root],
  };
}

describe('canonical publication mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateReturningMock.mockResolvedValue([{ id: 'letter-a' }]);
  });

  it('publishes root flags, companion visibility, and profile invalidation in one transaction', async () => {
    lockCorrespondenceGroupMock.mockResolvedValueOnce(group({
      metadataStatus: 'EDITED',
    }));

    await expect(applyBulkPublicationAction(
      [{ letterId: 'letter-a', primarySourceRevision: 4 }],
      'PUBLISH_LETTER',
      'reviewer-1',
    )).resolves.toEqual({
      requested: 1,
      applied: 1,
      skipped: 0,
      skipReasons: [],
    });

    expect(transactionMock).toHaveBeenCalledOnce();
    expect(updateSetMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
      visibility: 'PUBLISHED',
      transcriptPublished: true,
      metadataPublished: false,
      reviewedBy: 'reviewer-1',
      updatedAt: expect.any(Date),
    }));
    expect(updateSetMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
      visibility: 'PUBLISHED',
      reviewedBy: 'reviewer-1',
      updatedAt: expect.any(Date),
    }));
    expect(advanceCollectionProfileRevisionMock).toHaveBeenCalledWith(
      'collection-1',
      expect.anything(),
    );
  });

  it('repairs a hidden companion when a publish retry finds the root already public', async () => {
    lockCorrespondenceGroupMock.mockResolvedValueOnce(group({
      ownerVisibility: 'PUBLISHED',
      companionVisibility: 'HIDDEN',
      transcriptPublished: true,
      metadataPublished: true,
    }));

    const result = await applyBulkPublicationAction(
      [{ letterId: 'letter-a', primarySourceRevision: 4 }],
      'PUBLISH_LETTER',
      'reviewer-1',
    );

    expect(result.applied).toBe(1);
    expect(updateSetMock).toHaveBeenCalledOnce();
    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
      visibility: 'PUBLISHED',
    }));
    expect(updateSetMock.mock.calls[0]?.[0]).not.toHaveProperty(
      'transcriptPublished',
    );
    expect(advanceCollectionProfileRevisionMock).toHaveBeenCalledOnce();
  });

  it('rejects stale grants but lets a stale revocation withdraw the group', async () => {
    lockCorrespondenceGroupMock
      .mockResolvedValueOnce(group({ sourceRevision: 8 }))
      .mockResolvedValueOnce(group({
        sourceRevision: 8,
        ownerVisibility: 'PUBLISHED',
        companionVisibility: 'PUBLISHED',
      }));

    const publish = await applyBulkPublicationAction(
      [{ letterId: 'letter-a', primarySourceRevision: 7 }],
      'PUBLISH_METADATA',
      'reviewer-1',
    );
    const hide = await applyBulkPublicationAction(
      [{ letterId: 'letter-a', primarySourceRevision: 7 }],
      'HIDE_LETTER',
      'reviewer-1',
    );

    expect(publish).toMatchObject({
      applied: 0,
      skipReasons: [{
        letterId: 'letter-a',
        code: 'SOURCE_CHANGED_OR_INELIGIBLE',
      }],
    });
    expect(hide).toMatchObject({ applied: 1, skipReasons: [] });
    expect(updateSetMock).toHaveBeenCalledTimes(2);
    expect(updateSetMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
      visibility: 'HIDDEN',
    }));
    expect(updateSetMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
      visibility: 'HIDDEN',
    }));
  });

  it('does not grant metadata publication after verification is withdrawn', async () => {
    lockCorrespondenceGroupMock.mockResolvedValueOnce(group({
      metadataStatus: 'EDITED',
    }));

    const result = await applyBulkPublicationAction(
      [{ letterId: 'letter-a', primarySourceRevision: 4 }],
      'PUBLISH_METADATA',
      'reviewer-1',
    );

    expect(result).toMatchObject({
      applied: 0,
      skipReasons: [{
        code: 'SOURCE_CHANGED_OR_INELIGIBLE',
      }],
    });
    expect(updateMock).not.toHaveBeenCalled();
    expect(advanceCollectionProfileRevisionMock).not.toHaveBeenCalled();
  });

  it('commits an implicit metadata withdrawal and profile demotion atomically', async () => {
    lockCorrespondenceGroupMock.mockResolvedValueOnce(group({
      ownerVisibility: 'PUBLISHED',
      companionVisibility: 'PUBLISHED',
      metadataPublished: true,
    }));

    const outcome = await applyPublicationMutation({
      source: { letterId: 'letter-a', primarySourceRevision: 4 },
      intent: {},
      userId: 'reviewer-1',
      requireCurrentSourceRevision: true,
      rootPatch: {
        sender: 'Corrected sender',
        metadataPublished: false,
      },
      rootConditions: [{ kind: 'metadata-cas' } as never],
    });

    expect(outcome).toEqual({
      kind: 'applied',
      publicCorpusChanged: true,
    });
    expect(updateSetMock).toHaveBeenCalledOnce();
    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
      sender: 'Corrected sender',
      metadataPublished: false,
    }));
    expect(advanceCollectionProfileRevisionMock).toHaveBeenCalledOnce();
  });

  it('keeps companion content and CAS on the observed member while mutating publication on the catalogue root', async () => {
    lockCorrespondenceGroupMock.mockResolvedValueOnce(companionTargetGroup({
      companionSourceRevision: 9,
      published: true,
    }));
    const requestedMemberCondition = {
      kind: 'eq',
      field: 'letters.id',
      value: 'letter-a',
    } as never;
    const afterRootMutation = vi.fn();

    await expect(applyPublicationMutation({
      source: { letterId: 'letter-a', primarySourceRevision: 9 },
      intent: { transcriptPublished: false },
      userId: 'reviewer-1',
      requireCurrentSourceRevision: true,
      rootPatch: {
        sender: 'Corrected sender',
        metadataPublished: false,
      },
      rootConditions: [requestedMemberCondition],
      afterRootMutation,
    })).resolves.toEqual({
      kind: 'applied',
      publicCorpusChanged: true,
    });

    expect(lockCorrespondenceGroupMock).toHaveBeenCalledWith(
      'letter-a',
      expect.anything(),
    );
    expect(updateWhereMock).toHaveBeenNthCalledWith(1, {
      kind: 'and',
      clauses: [
        { kind: 'eq', field: 'letters.id', value: 'letter-a' },
        requestedMemberCondition,
      ],
    });
    expect(updateSetMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
      sender: 'Corrected sender',
      metadataPublished: false,
    }));
    expect(updateWhereMock).toHaveBeenNthCalledWith(2, {
      kind: 'eq',
      field: 'letters.id',
      value: 'letter-z',
    });
    expect(updateSetMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
      transcriptPublished: false,
    }));
    expect(afterRootMutation).toHaveBeenCalledWith(expect.anything());
    expect(advanceCollectionProfileRevisionMock).toHaveBeenCalledOnce();
  });

  it('processes a selected root and companion once using the canonical root epoch', async () => {
    lockCorrespondenceGroupMock.mockResolvedValueOnce(companionTargetGroup());

    await expect(applyBulkPublicationAction(
      [
        { letterId: 'letter-z', primarySourceRevision: 9 },
        { letterId: 'letter-a', primarySourceRevision: 3 },
      ],
      'PUBLISH_LETTER',
      'reviewer-1',
    )).resolves.toEqual({
      requested: 2,
      applied: 2,
      skipped: 0,
      skipReasons: [],
    });

    expect(transactionMock).toHaveBeenCalledOnce();
    expect(lockCorrespondenceGroupMock).toHaveBeenCalledOnce();
    expect(lockCorrespondenceGroupMock).toHaveBeenCalledWith(
      'letter-a',
      expect.anything(),
    );
    expect(updateWhereMock).toHaveBeenNthCalledWith(1, {
      kind: 'eq',
      field: 'letters.id',
      value: 'letter-z',
    });
  });

  it('rejects a companion-only grant based on the companion rather than root epoch', async () => {
    lockCorrespondenceGroupMock.mockResolvedValueOnce(companionTargetGroup());

    await expect(applyBulkPublicationAction(
      [{ letterId: 'letter-a', primarySourceRevision: 3 }],
      'PUBLISH_LETTER',
      'reviewer-1',
    )).resolves.toEqual({
      requested: 1,
      applied: 0,
      skipped: 1,
      skipReasons: [{
        letterId: 'letter-a',
        code: 'SOURCE_CHANGED_OR_INELIGIBLE',
      }],
    });

    expect(updateMock).not.toHaveBeenCalled();
    expect(advanceCollectionProfileRevisionMock).not.toHaveBeenCalled();
  });

  it('does not demote a profile when the root compare-and-set loses', async () => {
    lockCorrespondenceGroupMock.mockResolvedValueOnce(group({
      metadataPublished: true,
    }));
    updateReturningMock.mockResolvedValueOnce([]);

    await expect(applyPublicationMutation({
      source: { letterId: 'letter-a', primarySourceRevision: 4 },
      intent: { metadataPublished: false },
      userId: 'reviewer-1',
      requireCurrentSourceRevision: true,
      rootConditions: [{ kind: 'metadata-cas' } as never],
    })).resolves.toEqual({ kind: 'root_conflict' });

    expect(advanceCollectionProfileRevisionMock).not.toHaveBeenCalled();
  });

  it('rolls back before companion/profile work when a root projection fails', async () => {
    lockCorrespondenceGroupMock.mockResolvedValueOnce(group({
      ownerVisibility: 'HIDDEN',
      companionVisibility: 'HIDDEN',
    }));
    const projectionError = new Error('participant projection failed');
    const afterRootMutation = vi.fn().mockRejectedValueOnce(projectionError);

    await expect(applyPublicationMutation({
      source: { letterId: 'letter-a', primarySourceRevision: 4 },
      intent: { visibility: 'PUBLISHED' },
      userId: 'reviewer-1',
      requireCurrentSourceRevision: true,
      rootPatch: { sender: 'Corrected sender' },
      afterRootMutation,
    })).rejects.toBe(projectionError);

    expect(afterRootMutation).toHaveBeenCalledOnce();
    expect(updateSetMock).toHaveBeenCalledOnce();
    expect(advanceCollectionProfileRevisionMock).not.toHaveBeenCalled();
  });

  it('distinguishes missing rows from stale or ineligible rows in bulk results', async () => {
    lockCorrespondenceGroupMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(singleMemberGroup('letter-z', 6));

    const result = await applyBulkPublicationAction(
      [
        { letterId: 'letter-a', primarySourceRevision: 5 },
        { letterId: 'letter-z', primarySourceRevision: 5 },
      ],
      'PUBLISH_METADATA',
      'reviewer-1',
    );

    expect(result).toEqual({
      requested: 2,
      applied: 0,
      skipped: 2,
      skipReasons: [
        {
          letterId: 'letter-a',
          code: 'NOT_FOUND',
        },
        {
          letterId: 'letter-z',
          code: 'SOURCE_CHANGED_OR_INELIGIBLE',
        },
      ],
    });
  });

  it('reports an unexpected item failure and continues later correspondence units', async () => {
    lockCorrespondenceGroupMock
      .mockResolvedValueOnce(singleMemberGroup('letter-a'))
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce(singleMemberGroup('letter-c'));

    const result = await applyBulkPublicationAction(
      [
        { letterId: 'letter-a', primarySourceRevision: 4 },
        { letterId: 'letter-b', primarySourceRevision: 4 },
        { letterId: 'letter-c', primarySourceRevision: 4 },
      ],
      'PUBLISH_LETTER',
      'reviewer-1',
    );

    expect(result).toEqual({
      requested: 3,
      applied: 2,
      skipped: 1,
      skipReasons: [{
        letterId: 'letter-b',
        code: 'MUTATION_FAILED',
      }],
    });
    expect(transactionMock).toHaveBeenCalledTimes(3);
  });

});
