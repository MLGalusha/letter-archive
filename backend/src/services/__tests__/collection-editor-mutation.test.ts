import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  collectionsTable,
  lettersTable,
  defaultPropagateMock,
  defaultDirectCommitMock,
  defaultFingerprintMock,
  defaultParticipantSyncMock,
  warnMock,
} = vi.hoisted(() => ({
  collectionsTable: {
    id: 'collections.id',
    collectionCode: 'collections.collectionCode',
    profileRevision: 'collections.profileRevision',
  },
  lettersTable: {
    id: 'letters.id',
    collectionId: 'letters.collectionId',
  },
  defaultPropagateMock: vi.fn(),
  defaultDirectCommitMock: vi.fn(),
  defaultFingerprintMock: vi.fn(),
  defaultParticipantSyncMock: vi.fn(),
  warnMock: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ kind: 'and', conditions })),
  asc: vi.fn((field: unknown) => ({ kind: 'asc', field })),
  eq: vi.fn((field: unknown, value: unknown) => ({ kind: 'eq', field, value })),
}));

vi.mock('../../db/index.js', () => ({
  db: {},
  collections: collectionsTable,
  letters: lettersTable,
}));

vi.mock('../name-propagation.js', () => ({
  commitDirectIdentityField: defaultDirectCommitMock,
  propagateName: defaultPropagateMock,
  isIdentityRevisionConflict: (error: unknown) => {
    if (!error || typeof error !== 'object') return false;
    return (
      ('status' in error && error.status === 409)
      || ('statusCode' in error && error.statusCode === 409)
    );
  },
  observeIdentityField: (
    source: {
      sender: string | null;
      recipient: string | null;
      metadataRevision: number;
      updatedAt: Date;
    },
    field: 'sender' | 'recipient',
  ) => ({
    value: source[field],
    metadataRevision: source.metadataRevision,
    updatedAt: source.updatedAt,
  }),
}));

vi.mock('../collection-profile-source.js', () => ({
  computeCollectionProfileSourceFingerprint: defaultFingerprintMock,
}));

vi.mock('../entities/participant-sync.js', () => ({
  syncLetterParticipantsFromMetadata: defaultParticipantSyncMock,
}));

vi.mock('../../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    warn: warnMock,
  })),
}));

import type { Database, Letter } from '../../db/index.js';
import {
  applyCollectionEditorMutation,
  collectionIdentityFingerprint,
  type CollectionEditorMutationInput,
} from '../collection-editor-mutation.js';
import type {
  IdentityMutationDatabase,
  PropagateNameParams,
  PropagateNameResult,
} from '../name-propagation.js';

interface HarnessState {
  collection: Record<string, unknown>;
  letters: Array<Record<string, unknown>>;
  participantSenders: Record<string, string>;
}

interface HarnessOptions {
  failPropagationAt?: number;
  failParticipantSyncAt?: number;
}

function makeLetter(id: string): Record<string, unknown> {
  return {
    id,
    collectionId: 'collection-1',
    dateRaw: `1947010${id.endsWith('1') ? '1' : '2'}`,
    typeSequence: 1,
    type: 'L',
    visibility: 'PUBLISHED',
    sender: 'Alice Adams',
    recipient: 'Bob Brown',
    metadataRevision: 3,
    updatedAt: new Date('2026-07-24T12:00:00.000Z'),
    metadataV2Json: null,
    metadataJson: null,
  };
}

function makeState(): HarnessState {
  return {
    collection: {
      id: 'collection-1',
      collectionCode: '009',
      title: 'Test Collection',
      description: 'Old notes',
      hook: 'Old hook',
      profileNarrative: 'Old narrative',
      profileStartHereLetterId: null,
      profileCorrespondents: [],
      profileStatus: 'EDITED',
      profileRevision: 5,
      profileSourceFingerprint: 'a'.repeat(32),
    },
    letters: [makeLetter('letter-1'), makeLetter('letter-2')],
    participantSenders: {
      'letter-1': 'Alice Adams',
      'letter-2': 'Alice Adams',
    },
  };
}

function createHarness(options: HarnessOptions = {}) {
  let state = makeState();
  let working: HarnessState | null = null;
  let propagationCount = 0;
  let participantSyncCount = 0;
  const events: string[] = [];
  const synchronizeParticipants = vi.fn(async (syncInput: {
    letterId: string;
    sender?: string | null;
    database?: unknown;
  }) => {
    participantSyncCount += 1;
    events.push(`participant-sync:${syncInput.letterId}`);
    expect(syncInput.database).toBe(transactionDatabase);
    if (participantSyncCount === options.failParticipantSyncAt) {
      throw new Error('Injected participant sync failure');
    }
    if (!working) throw new Error('Participant sync outside transaction');
    if (syncInput.sender !== undefined && syncInput.sender !== null) {
      working.participantSenders[syncInput.letterId] = syncInput.sender;
    }
    return {
      sender: { action: 'unchanged' as const },
      recipient: { action: 'unchanged' as const },
    };
  });

  function selectBuilder() {
    let table: unknown;
    const builder = {
      from(selectedTable: unknown) {
        table = selectedTable;
        return builder;
      },
      where() {
        return builder;
      },
      orderBy() {
        return builder;
      },
      async for() {
        if (!working) throw new Error('Select outside transaction');
        return table === collectionsTable
          ? [working.collection]
          : working.letters;
      },
    };
    return builder;
  }

  function updateBuilder(table: unknown) {
    return {
      set(patch: Record<string, unknown>) {
        let applied = false;
        const apply = () => {
          if (applied) return;
          applied = true;
          if (!working) throw new Error('Update outside transaction');
          if (table === collectionsTable) {
            Object.assign(working.collection, patch);
          }
        };
        return {
          where() {
            const whereResult = {
              async returning() {
                apply();
                return table === collectionsTable
                  ? [{
                      profileRevision:
                        working?.collection.profileRevision as number,
                    }]
                  : [];
              },
              then<TResult1 = unknown, TResult2 = never>(
                onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
                onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
              ) {
                return Promise.resolve().then(() => {
                  apply();
                  return undefined;
                }).then(onfulfilled, onrejected);
              },
            };
            return whereResult;
          },
        };
      },
    };
  }

  const transactionDatabase = {
    select: vi.fn(selectBuilder),
    update: vi.fn(updateBuilder),
  };
  const database = {
    transaction: vi.fn(async (
      operation: (tx: typeof transactionDatabase) => Promise<unknown>,
    ) => {
      events.push('transaction-begin');
      working = structuredClone(state);
      try {
        const result = await operation(transactionDatabase);
        state = working;
        events.push('transaction-commit');
        return result;
      } catch (error) {
        events.push('transaction-rollback');
        throw error;
      } finally {
        working = null;
      }
    }),
  } as unknown as Database;

  const propagateIdentity = vi.fn(async (
    params: PropagateNameParams,
    mutationDatabase?: IdentityMutationDatabase,
  ): Promise<PropagateNameResult> => {
    propagationCount += 1;
    events.push(`propagate:${params.letterId}`);
    expect(mutationDatabase).toBe(transactionDatabase);
    if (propagationCount === options.failPropagationAt) {
      throw Object.assign(new Error('Injected identity conflict'), {
        status: 409,
      });
    }
    if (!working) throw new Error('Propagation outside transaction');
    const letter = working.letters.find(({ id }) => id === params.letterId);
    if (!letter) throw new Error('Missing test letter');
    letter[params.field] = params.newName;
    letter.metadataRevision = Number(letter.metadataRevision) + 1;
    letter.updatedAt = new Date('2026-07-24T12:01:00.000Z');
    return {
      letter: letter as unknown as Letter,
      fieldsUpdated: [params.field],
    };
  });

  const input: CollectionEditorMutationInput = {
    code: '009',
    expectedProfileRevision: 5,
    expectedIdentityFingerprint: collectionIdentityFingerprint(
      state.letters as unknown as Letter[],
    ),
    description: 'New notes',
    hook: 'New hook',
    profileNarrative: 'New narrative',
    profileStartHereLetterId: null,
    correspondentRenames: [{
      oldName: 'Alice Adams',
      newName: 'Alicia Adams',
      roles: ['sender'],
    }],
  };

  return {
    database,
    events,
    input,
    propagateIdentity,
    snapshot: () => structuredClone(state),
    setSender: (letterId: string, sender: string) => {
      const letter = state.letters.find(({ id }) => id === letterId);
      if (!letter) throw new Error('Missing test letter');
      letter.sender = sender;
    },
    synchronizeParticipants,
  };
}

describe('atomic collection editor mutation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('commits profile, description, and every matching rename in one revision', async () => {
    const harness = createHarness();

    const result = await applyCollectionEditorMutation(harness.input, {
      database: harness.database,
      propagateIdentity: harness.propagateIdentity,
      commitDirectIdentity: defaultDirectCommitMock,
      computeSourceFingerprint: defaultFingerprintMock,
      synchronizeParticipants: harness.synchronizeParticipants,
    });

    expect(result).toEqual({
      profileRevision: 6,
      identityFingerprint: collectionIdentityFingerprint(
        harness.snapshot().letters as unknown as Letter[],
      ),
      updatedLetterCount: 2,
      changed: true,
    });
    expect(harness.snapshot()).toMatchObject({
      collection: {
        description: 'New notes',
        hook: 'New hook',
        profileNarrative: 'New narrative',
        profileRevision: 6,
      },
      letters: [
        { sender: 'Alicia Adams' },
        { sender: 'Alicia Adams' },
      ],
      participantSenders: {
        'letter-1': 'Alicia Adams',
        'letter-2': 'Alicia Adams',
      },
    });
    expect(harness.events).toEqual([
      'transaction-begin',
      'propagate:letter-1',
      'propagate:letter-2',
      'participant-sync:letter-1',
      'participant-sync:letter-2',
      'transaction-commit',
    ]);
  });

  it('rolls back earlier letters and collection fields after a mid-batch conflict', async () => {
    const harness = createHarness({ failPropagationAt: 2 });

    await expect(applyCollectionEditorMutation(harness.input, {
      database: harness.database,
      propagateIdentity: harness.propagateIdentity,
      commitDirectIdentity: defaultDirectCommitMock,
      computeSourceFingerprint: defaultFingerprintMock,
      synchronizeParticipants: harness.synchronizeParticipants,
    })).rejects.toMatchObject({
      message: 'Injected identity conflict',
      status: 409,
    });

    expect(harness.snapshot()).toEqual(makeState());
    expect(harness.events).toEqual([
      'transaction-begin',
      'propagate:letter-1',
      'propagate:letter-2',
      'transaction-rollback',
    ]);
    expect(harness.synchronizeParticipants).not.toHaveBeenCalled();
  });

  it('rolls back identity, profile, and earlier participant projections when sync fails', async () => {
    const harness = createHarness({ failParticipantSyncAt: 2 });

    await expect(applyCollectionEditorMutation(harness.input, {
      database: harness.database,
      propagateIdentity: harness.propagateIdentity,
      commitDirectIdentity: defaultDirectCommitMock,
      computeSourceFingerprint: defaultFingerprintMock,
      synchronizeParticipants: harness.synchronizeParticipants,
    })).rejects.toThrow('Injected participant sync failure');

    expect(harness.snapshot()).toEqual(makeState());
    expect(harness.events).toEqual([
      'transaction-begin',
      'propagate:letter-1',
      'propagate:letter-2',
      'participant-sync:letter-1',
      'participant-sync:letter-2',
      'transaction-rollback',
    ]);
  });

  it('rejects a stale identity snapshot before partially renaming its remaining matches', async () => {
    const harness = createHarness();
    harness.setSender('letter-1', 'Alicia Adams');

    await expect(applyCollectionEditorMutation(harness.input, {
      database: harness.database,
      propagateIdentity: harness.propagateIdentity,
      commitDirectIdentity: defaultDirectCommitMock,
      computeSourceFingerprint: defaultFingerprintMock,
      synchronizeParticipants: harness.synchronizeParticipants,
    })).rejects.toMatchObject({
      message: 'Collection correspondents changed; reload before saving',
      statusCode: 409,
    });

    expect(harness.snapshot()).toMatchObject({
      collection: {
        profileRevision: 5,
        hook: 'Old hook',
      },
      letters: [
        { id: 'letter-1', sender: 'Alicia Adams' },
        { id: 'letter-2', sender: 'Alice Adams' },
      ],
    });
    expect(harness.propagateIdentity).not.toHaveBeenCalled();
    expect(harness.synchronizeParticipants).not.toHaveBeenCalled();
    expect(harness.events).toEqual([
      'transaction-begin',
      'transaction-rollback',
    ]);
  });

  it('rejects rename chains before sequential propagation can rewrite new names', async () => {
    const harness = createHarness();
    harness.input.correspondentRenames = [
      {
        oldName: 'Alice Adams',
        newName: 'Bob Brown',
        roles: ['sender'],
      },
      {
        oldName: 'Bob Brown',
        newName: 'Carol Clark',
        roles: ['recipient'],
      },
    ];

    await expect(applyCollectionEditorMutation(harness.input, {
      database: harness.database,
      propagateIdentity: harness.propagateIdentity,
      commitDirectIdentity: defaultDirectCommitMock,
      computeSourceFingerprint: defaultFingerprintMock,
      synchronizeParticipants: harness.synchronizeParticipants,
    })).rejects.toMatchObject({
      message: expect.stringContaining('Overlapping correspondent renames'),
      statusCode: 400,
    });

    expect(harness.snapshot()).toEqual(makeState());
    expect(harness.propagateIdentity).not.toHaveBeenCalled();
    expect(harness.events).toEqual([
      'transaction-begin',
      'transaction-rollback',
    ]);
  });
});
