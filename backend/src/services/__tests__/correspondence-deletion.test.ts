import { beforeEach, describe, expect, it, vi } from 'vitest';

const { warnMock } = vi.hoisted(() => ({
  warnMock: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ kind: 'and', conditions })),
  asc: vi.fn((field: unknown) => ({ kind: 'asc', field })),
  eq: vi.fn((field: unknown, value: unknown) => ({ kind: 'eq', field, value })),
  inArray: vi.fn((field: unknown, values: unknown[]) => ({
    kind: 'inArray',
    field,
    values,
  })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    kind: 'sql',
    strings: Array.from(strings),
    values,
  })),
}));

vi.mock('../../db/index.js', () => ({
  db: {},
  collections: {
    id: 'collections.id',
    highlightImageId: 'collections.highlightImageId',
    profileRevision: 'collections.profileRevision',
    profileStatus: 'collections.profileStatus',
  },
  letterPages: {
    id: 'letterPages.id',
    letterId: 'letterPages.letterId',
    storagePath: 'letterPages.storagePath',
  },
  letters: {
    id: 'letters.id',
    collectionId: 'letters.collectionId',
    dateRaw: 'letters.dateRaw',
    typeSequence: 'letters.typeSequence',
    type: 'letters.type',
    primarySourceRevision: 'letters.primarySourceRevision',
    visibility: 'letters.visibility',
    transcriptPublished: 'letters.transcriptPublished',
    metadataPublished: 'letters.metadataPublished',
    transcriptStatus: 'letters.transcriptStatus',
    metadataContentStatus: 'letters.metadataContentStatus',
  },
}));

vi.mock('../../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    warn: warnMock,
  })),
}));

import type { Database } from '../../db/index.js';
import { deleteCorrespondenceGroup } from '../letter/correspondence-deletion.js';

interface SelectPlan {
  event: string;
  rows: unknown[];
}

interface HarnessOptions {
  missing?: boolean;
  collection?: {
    id: string;
    highlightImageId: string | null;
  };
  members?: Array<Record<string, unknown>>;
  pages?: Array<{ id: string; storagePath: string }>;
  failDelete?: Error;
}

function selectBuilder(
  plan: SelectPlan,
  events: string[],
) {
  let executed = false;
  const execute = () => {
    if (!executed) {
      executed = true;
      events.push(plan.event);
    }
    return plan.rows;
  };

  const builder: Record<string, unknown> & PromiseLike<unknown[]> = {
    from: vi.fn(() => builder),
    where: vi.fn(() => builder),
    orderBy: vi.fn(() => builder),
    for: vi.fn(async () => execute()),
    then: (onfulfilled, onrejected) =>
      Promise.resolve()
        .then(execute)
        .then(onfulfilled, onrejected),
  };
  return builder;
}

function createHarness(options: HarnessOptions = {}) {
  const events: string[] = [];
  const members = options.members ?? [
    {
      id: 'letter-l',
      collectionId: 'collection-1',
      dateRaw: '19470101',
      typeSequence: 1,
      type: 'L',
      primarySourceRevision: 4,
      visibility: 'PUBLISHED',
      transcriptPublished: true,
      metadataPublished: true,
      transcriptStatus: 'VERIFIED',
      metadataContentStatus: 'VERIFIED',
    },
    {
      id: 'letter-p',
      collectionId: 'collection-1',
      dateRaw: '19470101',
      typeSequence: 1,
      type: 'P',
      primarySourceRevision: 4,
      visibility: 'PUBLISHED',
      transcriptPublished: false,
      metadataPublished: false,
      transcriptStatus: 'EMPTY',
      metadataContentStatus: 'EMPTY',
    },
  ];
  const pages = options.pages ?? [
    { id: 'page-l', storagePath: 'storage/object-l.jpg' },
    { id: 'page-p', storagePath: 'storage/object-p.jpg' },
  ];
  const plans: SelectPlan[] = [
    {
      event: 'identity-read',
      rows: options.missing ? [] : [{
        id: 'letter-l',
        collectionId: 'collection-1',
        dateRaw: '19470101',
        typeSequence: 1,
      }],
    },
    {
      event: 'collection-lock',
      rows: [options.collection ?? {
        id: 'collection-1',
        highlightImageId: null,
      }],
    },
    { event: 'group-lock', rows: members },
    { event: 'page-snapshot', rows: pages },
  ];
  const profilePatches: Array<Record<string, unknown>> = [];
  let deleteCondition: unknown;

  const transactionDatabase = {
    select: vi.fn(() => {
      const plan = plans.shift();
      if (!plan) throw new Error('Unexpected select');
      return selectBuilder(plan, events);
    }),
    update: vi.fn(() => ({
      set: vi.fn((patch: Record<string, unknown>) => {
        profilePatches.push(patch);
        return {
          where: vi.fn(async () => {
            events.push('profile-revision');
          }),
        };
      }),
    })),
    delete: vi.fn(() => ({
      where: vi.fn((condition: unknown) => {
        deleteCondition = condition;
        return {
          returning: vi.fn(async () => {
            events.push('group-delete');
            if (options.failDelete) throw options.failDelete;
            return members.map((member) => ({ id: member.id }));
          }),
        };
      }),
    })),
  };

  const database = {
    transaction: vi.fn(async (
      operation: (tx: typeof transactionDatabase) => Promise<unknown>,
    ) => {
      events.push('transaction-begin');
      try {
        const result = await operation(transactionDatabase);
        events.push('transaction-commit');
        return result;
      } catch (error) {
        events.push('transaction-rollback');
        throw error;
      }
    }),
  } as unknown as Database;

  return {
    database,
    deleteCondition: () => deleteCondition,
    events,
    profilePatches,
    transactionDatabase,
  };
}

describe('deleteCorrespondenceGroup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes every locked group member before reclaiming unique immutable objects', async () => {
    const harness = createHarness();
    const reclaimStoragePath = vi.fn(async (storagePath: string) => {
      harness.events.push(`reclaim:${storagePath}`);
      return 'removed' as const;
    });

    const result = await deleteCorrespondenceGroup('letter-l', 4, {
      database: harness.database,
      reclaimStoragePath,
    });

    expect(harness.database.transaction).toHaveBeenCalledTimes(1);
    expect(harness.transactionDatabase.delete).toHaveBeenCalledTimes(1);
    expect(harness.deleteCondition()).toEqual({
      kind: 'inArray',
      field: 'letters.id',
      values: ['letter-l', 'letter-p'],
    });
    expect(harness.events).toEqual([
      'transaction-begin',
      'identity-read',
      'collection-lock',
      'group-lock',
      'page-snapshot',
      'profile-revision',
      'group-delete',
      'transaction-commit',
      'reclaim:storage/object-l.jpg',
      'reclaim:storage/object-p.jpg',
    ]);
    expect(result).toEqual({
      letterId: 'letter-l',
      deletedCount: 2,
      storageObjectCount: 2,
      removedStorageObjectCount: 2,
      alreadyMissingStoragePaths: [],
      retainedStoragePaths: [],
      cleanupFailedStoragePaths: [],
      collectionProfileInvalidated: true,
    });
    expect(harness.profilePatches).toHaveLength(1);
  });

  it('does not touch storage when the database transaction fails', async () => {
    const harness = createHarness({
      failDelete: new Error('constraint failure'),
    });
    const reclaimStoragePath = vi.fn();

    await expect(deleteCorrespondenceGroup('letter-l', 4, {
      database: harness.database,
      reclaimStoragePath,
    })).rejects.toThrow('constraint failure');

    expect(harness.events.at(-1)).toBe('transaction-rollback');
    expect(reclaimStoragePath).not.toHaveBeenCalled();
  });

  it('returns null without mutating the database or storage when the target is absent', async () => {
    const harness = createHarness({ missing: true });
    const reclaimStoragePath = vi.fn();

    await expect(deleteCorrespondenceGroup('missing-letter', 4, {
      database: harness.database,
      reclaimStoragePath,
    })).resolves.toBeNull();

    expect(harness.transactionDatabase.update).not.toHaveBeenCalled();
    expect(harness.transactionDatabase.delete).not.toHaveBeenCalled();
    expect(reclaimStoragePath).not.toHaveBeenCalled();
    expect(harness.events).toEqual([
      'transaction-begin',
      'identity-read',
      'transaction-commit',
    ]);
  });

  it.each([
    ['still-referenced', 'storage/collections/009/objects/page/shared-id.jpg'],
    ['legacy-path-retained', 'storage/collections/009/19470101/L01/page-1.jpg'],
  ] as const)(
    'accounts for a %s path as retained rather than removed or orphaned',
    async (outcome, storagePath) => {
      const harness = createHarness({
        pages: [{ id: 'page-l', storagePath }],
      });
      const reclaimStoragePath = vi.fn(async (observedPath: string) => {
        harness.events.push(`reclaim:${observedPath}`);
        return outcome;
      });

      const result = await deleteCorrespondenceGroup('letter-l', 4, {
        database: harness.database,
        reclaimStoragePath,
      });

      expect(reclaimStoragePath).toHaveBeenCalledOnce();
      expect(reclaimStoragePath).toHaveBeenCalledWith(storagePath);
      expect(harness.events.indexOf('transaction-commit')).toBeLessThan(
        harness.events.indexOf(`reclaim:${storagePath}`),
      );
      expect(result).toMatchObject({
        storageObjectCount: 1,
        removedStorageObjectCount: 0,
        alreadyMissingStoragePaths: [],
        retainedStoragePaths: [storagePath],
        cleanupFailedStoragePaths: [],
      });
      expect(warnMock).not.toHaveBeenCalled();
    },
  );

  it('keeps a committed deletion successful when reference-safe reclamation fails', async () => {
    const harness = createHarness({
      collection: {
        id: 'collection-1',
        highlightImageId: 'page-l',
      },
      members: [{
        id: 'letter-l',
        collectionId: 'collection-1',
        dateRaw: '19470101',
        typeSequence: 1,
        type: 'L',
        primarySourceRevision: 4,
        visibility: 'HIDDEN',
        transcriptPublished: false,
        metadataPublished: false,
        transcriptStatus: 'EDITED',
        metadataContentStatus: 'EDITED',
      }],
    });
    const reclaimStoragePath = vi.fn(async (storagePath: string) => {
      harness.events.push(`reclaim:${storagePath}`);
      if (storagePath === 'storage/object-l.jpg') {
        throw new Error('reference lookup unavailable');
      }
      return 'removed' as const;
    });

    const result = await deleteCorrespondenceGroup('letter-l', 4, {
      database: harness.database,
      reclaimStoragePath,
    });

    expect(harness.events.indexOf('transaction-commit')).toBeLessThan(
      harness.events.indexOf('reclaim:storage/object-l.jpg'),
    );
    expect(result).toMatchObject({
      deletedCount: 1,
      removedStorageObjectCount: 1,
      alreadyMissingStoragePaths: [],
      retainedStoragePaths: [],
      cleanupFailedStoragePaths: ['storage/object-l.jpg'],
      collectionProfileInvalidated: true,
    });
    expect(harness.profilePatches[0]).toMatchObject({
      highlightImageId: null,
    });
    expect(warnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        letterId: 'letter-l',
        storagePath: 'storage/object-l.jpg',
      }),
      'Deleted correspondence storage cleanup failed',
    );
  });

  it('treats an already-missing immutable object as benign completed cleanup', async () => {
    const harness = createHarness({
      pages: [{
        id: 'page-l',
        storagePath: 'storage/collections/009/objects/page/missing-id.jpg',
      }],
    });
    const reclaimStoragePath = vi.fn(async () => 'already-missing' as const);

    const result = await deleteCorrespondenceGroup('letter-l', 4, {
      database: harness.database,
      reclaimStoragePath,
    });

    expect(result).toMatchObject({
      storageObjectCount: 1,
      removedStorageObjectCount: 0,
      alreadyMissingStoragePaths: [
        'storage/collections/009/objects/page/missing-id.jpg',
      ],
      retainedStoragePaths: [],
      cleanupFailedStoragePaths: [],
    });
    expect(warnMock).not.toHaveBeenCalled();
  });

  it('rejects a stale confirmation after locking a newly changed group member', async () => {
    const harness = createHarness({
      members: [
        {
          id: 'letter-l',
          collectionId: 'collection-1',
          dateRaw: '19470101',
          typeSequence: 1,
          type: 'L',
          primarySourceRevision: 4,
          visibility: 'PUBLISHED',
          transcriptPublished: true,
          metadataPublished: true,
          transcriptStatus: 'VERIFIED',
          metadataContentStatus: 'VERIFIED',
        },
        {
          id: 'letter-new',
          collectionId: 'collection-1',
          dateRaw: '19470101',
          typeSequence: 1,
          type: 'P',
          primarySourceRevision: 5,
          visibility: 'HIDDEN',
          transcriptPublished: false,
          metadataPublished: false,
          transcriptStatus: 'EMPTY',
          metadataContentStatus: 'EMPTY',
        },
      ],
    });
    const reclaimStoragePath = vi.fn();

    await expect(deleteCorrespondenceGroup('letter-l', 4, {
      database: harness.database,
      reclaimStoragePath,
    })).rejects.toMatchObject({
      statusCode: 409,
      code: 'SOURCE_REVISION_CHANGED',
    });

    expect(harness.events).toEqual([
      'transaction-begin',
      'identity-read',
      'collection-lock',
      'group-lock',
      'transaction-rollback',
    ]);
    expect(harness.transactionDatabase.update).not.toHaveBeenCalled();
    expect(harness.transactionDatabase.delete).not.toHaveBeenCalled();
    expect(reclaimStoragePath).not.toHaveBeenCalled();
  });
});
