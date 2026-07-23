import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  transactionMock,
  findMatchingPersonsMock,
  findMatchingPlacesMock,
  updatePatches,
  updatedRows,
  deletedRows,
  insertedRows,
  events,
  controls,
} = vi.hoisted(() => ({
  transactionMock: vi.fn(),
  findMatchingPersonsMock: vi.fn(),
  findMatchingPlacesMock: vi.fn(),
  updatePatches: [] as Array<Record<string, unknown>>,
  updatedRows: [] as Array<{
    table: string;
    patch: Record<string, unknown>;
    condition: unknown;
  }>,
  deletedRows: [] as Array<{ table: string; condition: unknown }>,
  insertedRows: [] as Array<{ table: string; data: Record<string, unknown> }>,
  events: [] as string[],
  controls: {
    claimLost: false,
    failInsertTable: null as string | null,
    updateCount: 0,
    personInsertCount: 0,
    promoteTables: new Set<string>(),
    adoptBackfillRelationship: false,
    conflictInsertTables: new Set<string>(),
    existingRows: new Map<string, Array<Record<string, unknown>>>(),
  },
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...clauses: unknown[]) => ({ kind: 'and', clauses })),
  eq: vi.fn((field: unknown, value: unknown) => ({ kind: 'eq', field, value })),
  gt: vi.fn((field: unknown, value: unknown) => ({ kind: 'gt', field, value })),
  gte: vi.fn((field: unknown, value: unknown) => ({ kind: 'gte', field, value })),
  isNotNull: vi.fn((field: unknown) => ({ kind: 'isNotNull', field })),
  isNull: vi.fn((field: unknown) => ({ kind: 'isNull', field })),
}));

vi.mock('../../../db/index.js', () => {
  const table = (name: string, fields: string[]) => ({
    tableName: name,
    ...Object.fromEntries(fields.map((field) => [field, `${name}.${field}`])),
  });
  const letters = table('letters', [
    'id',
    'entityExtractionStatus',
    'entityExtractionRevision',
    'entityExtractionRunId',
    'entityExtractionRunRevision',
    'entityExtractionJson',
  ]);
  const canonicalPersons = table('canonicalPersons', ['id']);
  const canonicalPlaces = table('canonicalPlaces', ['id']);
  const letterPersons = table('letterPersons', [
    'id',
    'letterId',
    'personId',
    'role',
    'entityExtractionRevision',
    'confirmedAt',
  ]);
  const letterPlaces = table('letterPlaces', [
    'id',
    'letterId',
    'placeId',
    'role',
    'entityExtractionRevision',
    'confirmedAt',
  ]);
  const personRelationships = table('personRelationships', [
    'id',
    'personAId',
    'personBId',
    'discoveredInLetterId',
    'entityExtractionRevision',
    'confirmedBy',
    'confirmedAt',
  ]);
  const entityReviewQueue = table('entityReviewQueue', [
    'letterId',
    'entityExtractionRevision',
    'status',
  ]);

  const tx = {
    update: vi.fn((target: { tableName: string }) => ({
      set: (patch: Record<string, unknown>) => {
        controls.updateCount += 1;
        updatePatches.push(patch);
        events.push(`update:${target.tableName}`);
        return {
          where: (condition: unknown) => {
            updatedRows.push({ table: target.tableName, patch, condition });
            return {
              returning: async () => {
                if (target.tableName === 'letters') {
                  return controls.claimLost && controls.updateCount === 1
                    ? []
                    : [{ id: 'letter-1' }];
                }
                if (
                  target.tableName === 'personRelationships'
                  && controls.adoptBackfillRelationship
                  && JSON.stringify(condition).includes('system-backfill')
                ) {
                  return [{ id: 'backfill-relationship' }];
                }
                return controls.promoteTables.has(target.tableName)
                  ? [{ id: `legacy-${target.tableName}` }]
                  : [];
              },
            };
          },
        };
      },
    })),
    delete: vi.fn((target: { tableName: string }) => ({
      where: async (condition: unknown) => {
        deletedRows.push({ table: target.tableName, condition });
        events.push(`delete:${target.tableName}`);
      },
    })),
    insert: vi.fn((target: { tableName: string }) => ({
      values: (data: Record<string, unknown>) => {
        if (controls.failInsertTable === target.tableName) {
          throw new Error(`write failed for ${target.tableName}`);
        }
        insertedRows.push({ table: target.tableName, data });
        events.push(`insert:${target.tableName}`);
        return {
          returning: async () => {
            if (target.tableName === 'canonicalPersons') {
              controls.personInsertCount += 1;
              return [{ id: `person-${controls.personInsertCount}` }];
            }
            return [{ id: 'place-1' }];
          },
          onConflictDoNothing: () => ({
            returning: async () => controls.conflictInsertTables.has(target.tableName)
              ? []
              : [{ id: `inserted-${target.tableName}` }],
          }),
        };
      },
    })),
    select: vi.fn(() => ({
      from: (target: { tableName: string }) => ({
        where: () => ({
          limit: async () => controls.existingRows.get(target.tableName) ?? [],
        }),
      }),
    })),
    execute: vi.fn(),
  };

  transactionMock.mockImplementation(async (operation) => operation(tx));

  return {
    db: { transaction: transactionMock },
    letters,
    canonicalPersons,
    canonicalPlaces,
    letterPersons,
    letterPlaces,
    personRelationships,
    entityReviewQueue,
  };
});

vi.mock('../matching.js', () => ({
  findMatchingPersons: findMatchingPersonsMock,
  findMatchingPlaces: findMatchingPlacesMock,
}));

vi.mock('../../../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({ info: vi.fn() })),
}));

import {
  EntityExtractionClaimLostError,
  EntityExtractionProjectionConflictError,
  processEntityExtraction,
} from '../extraction.js';

const extraction = {
  people: [{
    name: 'Alice',
    aliases: ['A.'],
    role: 'sender' as const,
    relationship_to_sender: null,
    narrative: null,
    details: [],
    emotional_significance: null,
    quotes: [],
    confidence: 0.98,
    isPlaceholder: false,
    source: 'letter',
  }, {
    name: 'Bob',
    aliases: [],
    role: 'recipient' as const,
    relationship_to_sender: 'friend',
    narrative: null,
    details: [],
    emotional_significance: null,
    quotes: [],
    confidence: 0.97,
    isPlaceholder: false,
    source: 'letter',
  }],
  places: [{
    name: 'Vienna',
    type: 'city' as const,
    role: 'written_from' as const,
    narrative: null,
    why_mentioned: 'Dateline',
    descriptive_details: null,
    associated_people: ['Alice'],
    confidence: 0.95,
    isPlaceholder: false,
    source: 'letter',
  }],
  relationships: [{
    person_a: 'Alice',
    person_b: 'Bob',
    relationship_type: 'friend' as const,
    evidence: 'The letter calls Bob a friend.',
    confidence: 0.9,
  }],
  person_place_connections: [],
};

describe('entity extraction commit boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updatePatches.length = 0;
    updatedRows.length = 0;
    deletedRows.length = 0;
    insertedRows.length = 0;
    events.length = 0;
    controls.claimLost = false;
    controls.failInsertTable = null;
    controls.updateCount = 0;
    controls.personInsertCount = 0;
    controls.promoteTables.clear();
    controls.adoptBackfillRelationship = false;
    controls.conflictInsertTables.clear();
    controls.existingRows.clear();
    findMatchingPersonsMock.mockResolvedValue([]);
    findMatchingPlacesMock.mockResolvedValue([]);
  });

  it('replaces all extraction-owned outputs and commits the revision in one transaction', async () => {
    await expect(processEntityExtraction(
      extraction,
      'letter-1',
      { runId: 'run-a', revision: 7 },
    )).resolves.toEqual({
      peopleProcessed: 2,
      placesProcessed: 1,
      relationshipsCreated: 1,
      errors: [],
    });

    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(deletedRows.map((row) => row.table)).toEqual([
      'letterPersons',
      'letterPlaces',
      'personRelationships',
      'entityReviewQueue',
    ]);
    expect(deletedRows.at(-1)?.condition).toEqual({
      kind: 'and',
      clauses: [
        { kind: 'eq', field: 'entityReviewQueue.letterId', value: 'letter-1' },
        {
          kind: 'gte',
          field: 'entityReviewQueue.entityExtractionRevision',
          value: 0,
        },
        { kind: 'eq', field: 'entityReviewQueue.status', value: 'pending' },
      ],
    });

    const extractionOwnedRows = insertedRows.filter(({ table }) =>
      table === 'letterPersons'
      || table === 'letterPlaces'
      || table === 'personRelationships'
    );
    expect(extractionOwnedRows).toHaveLength(4);
    expect(extractionOwnedRows.every(({ data }) =>
      data.entityExtractionRevision === 7
    )).toBe(true);

    expect(updatePatches.at(-1)).toMatchObject({
      entityExtractionJson: extraction,
      entityExtractionStatus: 'SUCCESS',
      entityExtractionRevision: 7,
      entityExtractionRunId: null,
      entityExtractionRunRevision: null,
      entityExtractionError: null,
    });
    expect(events.at(-1)).toBe('update:letters');
  });

  it('adopts matching legacy revision-0 rows without touching confirmed or ambiguous rows', async () => {
    findMatchingPersonsMock.mockImplementation(async (name: string) => [{
      entityId: name === 'Alice' ? 'person-a' : 'person-b',
      similarity: 100,
    }]);
    findMatchingPlacesMock.mockResolvedValue([{
      entityId: 'place-vienna',
      similarity: 100,
    }]);
    controls.promoteTables.add('letterPersons');
    controls.promoteTables.add('letterPlaces');
    controls.promoteTables.add('personRelationships');

    await expect(processEntityExtraction(
      extraction,
      'letter-1',
      { runId: 'run-a', revision: 7 },
    )).resolves.toMatchObject({ relationshipsCreated: 1 });

    const promotedRows = updatedRows.filter(({ table }) =>
      table === 'letterPersons'
      || table === 'letterPlaces'
      || table === 'personRelationships'
    );
    expect(promotedRows).toHaveLength(4);
    for (const row of promotedRows) {
      expect(row.patch).toMatchObject({ entityExtractionRevision: 7 });
      expect(row.condition).toEqual(expect.objectContaining({
        kind: 'and',
        clauses: expect.arrayContaining([
          {
            kind: 'eq',
            field: `${row.table}.entityExtractionRevision`,
            value: 0,
          },
          {
            kind: 'isNull',
            field: `${row.table}.confirmedAt`,
          },
        ]),
      }));
    }
    expect(insertedRows.some(({ table }) =>
      table === 'letterPersons'
      || table === 'letterPlaces'
      || table === 'personRelationships'
    )).toBe(false);
  });

  it('does not touch committed rows after the exact claim is lost', async () => {
    controls.claimLost = true;

    await expect(processEntityExtraction(
      extraction,
      'letter-1',
      { runId: 'stale-run', revision: 7 },
    )).rejects.toBeInstanceOf(EntityExtractionClaimLostError);

    expect(deletedRows).toEqual([]);
    expect(insertedRows).toEqual([]);
    expect(updatePatches).toHaveLength(1);
  });

  it('never reaches the SUCCESS transition after a materialization write fails', async () => {
    controls.failInsertTable = 'canonicalPlaces';

    await expect(processEntityExtraction(
      extraction,
      'letter-1',
      { runId: 'run-a', revision: 7 },
    )).rejects.toThrow('write failed for canonicalPlaces');

    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(updatePatches[0]).toMatchObject({ entityExtractionRunId: 'run-a' });
    expect(updatePatches.some((patch) =>
      patch.entityExtractionStatus === 'SUCCESS'
    )).toBe(false);
  });

  it('rolls back instead of committing through an ambiguous person-link conflict', async () => {
    findMatchingPersonsMock.mockResolvedValue([{
      entityId: 'person-a',
      similarity: 100,
    }]);
    controls.conflictInsertTables.add('letterPersons');
    controls.existingRows.set('letterPersons', [{
      id: 'ambiguous-person-link',
      entityExtractionRevision: null,
      confirmedAt: null,
    }]);

    await expect(processEntityExtraction(
      {
        ...extraction,
        people: [extraction.people[0]],
        places: [],
        relationships: [],
      },
      'letter-1',
      { runId: 'run-a', revision: 7 },
    )).rejects.toBeInstanceOf(EntityExtractionProjectionConflictError);

    expect(updatePatches.some((patch) =>
      patch.entityExtractionStatus === 'SUCCESS'
    )).toBe(false);
  });

  it('rolls back instead of committing through an ambiguous place-link conflict', async () => {
    findMatchingPlacesMock.mockResolvedValue([{
      entityId: 'place-vienna',
      similarity: 100,
    }]);
    controls.conflictInsertTables.add('letterPlaces');
    controls.existingRows.set('letterPlaces', [{
      id: 'ambiguous-place-link',
      entityExtractionRevision: null,
      confirmedAt: null,
    }]);

    await expect(processEntityExtraction(
      {
        ...extraction,
        people: [],
        relationships: [],
      },
      'letter-1',
      { runId: 'run-a', revision: 7 },
    )).rejects.toBeInstanceOf(EntityExtractionProjectionConflictError);

    expect(updatePatches.some((patch) =>
      patch.entityExtractionStatus === 'SUCCESS'
    )).toBe(false);
  });

  it('fully adopts a system-backfill relationship into the exact projection', async () => {
    findMatchingPersonsMock.mockImplementation(async (name: string) => [{
      entityId: name === 'Alice' ? 'person-a' : 'person-b',
      similarity: 100,
    }]);
    controls.adoptBackfillRelationship = true;

    await expect(processEntityExtraction(
      {
        ...extraction,
        places: [],
      },
      'letter-1',
      { runId: 'run-a', revision: 7 },
    )).resolves.toMatchObject({ relationshipsCreated: 1 });

    const adopted = updatedRows.find(({ table, condition }) =>
      table === 'personRelationships'
      && JSON.stringify(condition).includes('system-backfill')
    );
    expect(adopted?.patch).toMatchObject({
      relationshipType: 'friend',
      notes: 'The letter calls Bob a friend.',
      discoveredInLetterId: 'letter-1',
      entityExtractionRevision: 7,
      confidence: 90,
      confirmedBy: null,
      confirmedAt: null,
    });
    expect(insertedRows.some(({ table }) =>
      table === 'personRelationships'
    )).toBe(false);
  });

  it('rolls back through an ambiguous unowned relationship conflict', async () => {
    findMatchingPersonsMock.mockImplementation(async (name: string) => [{
      entityId: name === 'Alice' ? 'person-a' : 'person-b',
      similarity: 100,
    }]);
    controls.conflictInsertTables.add('personRelationships');
    controls.existingRows.set('personRelationships', [{
      id: 'ambiguous-relationship',
      discoveredInLetterId: null,
      entityExtractionRevision: null,
      confirmedAt: null,
    }]);

    await expect(processEntityExtraction(
      {
        ...extraction,
        places: [],
      },
      'letter-1',
      { runId: 'run-a', revision: 7 },
    )).rejects.toBeInstanceOf(EntityExtractionProjectionConflictError);

    expect(updatePatches.some((patch) =>
      patch.entityExtractionStatus === 'SUCCESS'
    )).toBe(false);
  });

  it('leaves a confirmed relationship conflict untouched and commits', async () => {
    findMatchingPersonsMock.mockImplementation(async (name: string) => [{
      entityId: name === 'Alice' ? 'person-a' : 'person-b',
      similarity: 100,
    }]);
    controls.conflictInsertTables.add('personRelationships');
    controls.existingRows.set('personRelationships', [{
      id: 'confirmed-relationship',
      discoveredInLetterId: null,
      entityExtractionRevision: null,
      confirmedAt: new Date('2026-01-01T00:00:00.000Z'),
    }]);

    await expect(processEntityExtraction(
      {
        ...extraction,
        places: [],
      },
      'letter-1',
      { runId: 'run-a', revision: 7 },
    )).resolves.toMatchObject({ relationshipsCreated: 0 });

    expect(updatePatches.at(-1)).toMatchObject({
      entityExtractionStatus: 'SUCCESS',
      entityExtractionRevision: 7,
    });
  });

  it('proves an independently committed relationship before leaving it untouched', async () => {
    findMatchingPersonsMock.mockImplementation(async (name: string) => [{
      entityId: name === 'Alice' ? 'person-a' : 'person-b',
      similarity: 100,
    }]);
    controls.conflictInsertTables.add('personRelationships');
    controls.existingRows.set('personRelationships', [{
      id: 'trusted-relationship',
      discoveredInLetterId: 'letter-2',
      entityExtractionRevision: 4,
      confirmedAt: null,
    }]);
    controls.existingRows.set('letters', [{ id: 'letter-2' }]);

    await expect(processEntityExtraction(
      {
        ...extraction,
        places: [],
      },
      'letter-1',
      { runId: 'run-a', revision: 7 },
    )).resolves.toMatchObject({ relationshipsCreated: 0 });

    expect(updatePatches.at(-1)).toMatchObject({
      entityExtractionStatus: 'SUCCESS',
      entityExtractionRevision: 7,
    });
  });
});
