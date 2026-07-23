import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  sourceRows,
  existingRelationships,
  insertedRows,
  updatedRows,
  insertResults,
  updateResults,
  mapRelationshipMock,
} = vi.hoisted(() => ({
  sourceRows: [] as Array<{
    letterId: string;
    senderRecipientRelationship: string;
    senderPersonId: string | null;
    recipientPersonId: string | null;
  }>,
  existingRelationships: [] as Array<Record<string, unknown> | undefined>,
  insertedRows: [] as Array<Record<string, unknown>>,
  updatedRows: [] as Array<{
    patch: Record<string, unknown>;
    condition: unknown;
  }>,
  insertResults: [] as Array<Array<{ id: string }>>,
  updateResults: [] as Array<Array<{ id: string }>>,
  mapRelationshipMock: vi.fn(() => 'friend'),
}));

vi.mock('drizzle-orm', () => {
  const sql = vi.fn((strings: TemplateStringsArray) => ({
    kind: 'sql',
    text: strings.join('?'),
  }));

  return {
    and: vi.fn((...clauses: unknown[]) => ({ kind: 'and', clauses })),
    asc: vi.fn((field: unknown) => ({ kind: 'asc', field })),
    eq: vi.fn((field: unknown, value: unknown) => ({ kind: 'eq', field, value })),
    isNull: vi.fn((field: unknown) => ({ kind: 'isNull', field })),
    ne: vi.fn((field: unknown, value: unknown) => ({ kind: 'ne', field, value })),
    or: vi.fn((...clauses: unknown[]) => ({ kind: 'or', clauses })),
    sql,
  };
});

vi.mock('../../../db/index.js', () => {
  const table = (name: string, fields: string[]) => ({
    tableName: name,
    ...Object.fromEntries(fields.map((field) => [field, `${name}.${field}`])),
  });
  const letters = table('letters', ['id', 'senderRecipientRelationship']);
  const personRelationships = table('personRelationships', [
    'id',
    'personAId',
    'personBId',
    'relationshipType',
    'notes',
    'discoveredInLetterId',
    'entityExtractionRevision',
    'confidence',
    'confirmedBy',
    'confirmedAt',
    'createdAt',
    'updatedAt',
  ]);

  const relationshipSourceQuery = {
    leftJoin: vi.fn(() => relationshipSourceQuery),
    where: vi.fn(async () => sourceRows),
  };

  return {
    db: {
      select: vi.fn(() => ({
        from: vi.fn(() => relationshipSourceQuery),
      })),
      query: {
        personRelationships: {
          findFirst: vi.fn(async () => existingRelationships.shift()),
        },
      },
      insert: vi.fn(() => ({
        values: vi.fn((data: Record<string, unknown>) => {
          insertedRows.push(data);
          return {
            onConflictDoNothing: vi.fn(() => ({
              returning: vi.fn(async () =>
                insertResults.shift() ?? [{ id: 'inserted-relationship' }]
              ),
            })),
          };
        }),
      })),
      update: vi.fn(() => ({
        set: vi.fn((patch: Record<string, unknown>) => ({
          where: vi.fn((condition: unknown) => {
            updatedRows.push({ patch, condition });
            return {
              returning: vi.fn(async () =>
                updateResults.shift() ?? [{ id: 'updated-relationship' }]
              ),
            };
          }),
        })),
      })),
    },
    letters,
    personRelationships,
  };
});

vi.mock('../participant-sync.js', () => ({
  mapMetadataRelationshipToPersonRelationship: mapRelationshipMock,
}));

vi.mock('../../public-catalogue-unit.js', () => ({
  publicCatalogueLetterTypeSql: vi.fn(() => ({ kind: 'publicCatalogueType' })),
}));

vi.mock('../public-projection.js', () => ({
  publicEntityProjectionSql: vi.fn(() => ({ kind: 'publicEntityProjection' })),
}));

import {
  backfillRelationshipsFromLetters,
  updateRelationship,
} from '../relationships.js';

describe('relationship backfill provenance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sourceRows.length = 0;
    existingRelationships.length = 0;
    insertedRows.length = 0;
    updatedRows.length = 0;
    insertResults.length = 0;
    updateResults.length = 0;
    mapRelationshipMock.mockReturnValue('friend');
  });

  it('updates only an unconfirmed revisionless row owned by system-backfill', async () => {
    sourceRows.push(
      {
        letterId: 'letter-create',
        senderRecipientRelationship: 'friend',
        senderPersonId: 'person-a',
        recipientPersonId: 'person-b',
      },
      {
        letterId: 'letter-owned',
        senderRecipientRelationship: 'friend',
        senderPersonId: 'person-c',
        recipientPersonId: 'person-d',
      },
      {
        letterId: 'letter-confirmed',
        senderRecipientRelationship: 'friend',
        senderPersonId: 'person-e',
        recipientPersonId: 'person-f',
      },
      {
        letterId: 'letter-extracted',
        senderRecipientRelationship: 'friend',
        senderPersonId: 'person-g',
        recipientPersonId: 'person-h',
      },
      {
        letterId: 'letter-ambiguous',
        senderRecipientRelationship: 'friend',
        senderPersonId: 'person-i',
        recipientPersonId: 'person-j',
      },
    );
    existingRelationships.push(
      undefined,
      {
        id: 'relationship-owned',
        relationshipType: 'unknown',
        discoveredInLetterId: null,
        entityExtractionRevision: null,
        confidence: 70,
        confirmedBy: 'system-backfill',
        confirmedAt: null,
      },
      {
        id: 'relationship-confirmed',
        relationshipType: 'unknown',
        discoveredInLetterId: null,
        entityExtractionRevision: null,
        confidence: 100,
        confirmedBy: 'admin',
        confirmedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        id: 'relationship-extracted',
        relationshipType: 'unknown',
        discoveredInLetterId: 'letter-original',
        entityExtractionRevision: 4,
        confidence: 85,
        confirmedBy: null,
        confirmedAt: null,
      },
      {
        id: 'relationship-ambiguous',
        relationshipType: 'unknown',
        discoveredInLetterId: null,
        entityExtractionRevision: null,
        confidence: 60,
        confirmedBy: null,
        confirmedAt: null,
      },
    );

    await expect(backfillRelationshipsFromLetters()).resolves.toEqual({
      scannedLetters: 5,
      created: 1,
      updated: 1,
      skipped: 3,
    });

    expect(insertedRows).toEqual([
      expect.objectContaining({
        personAId: 'person-a',
        personBId: 'person-b',
        relationshipType: 'friend',
        discoveredInLetterId: 'letter-create',
        confirmedBy: 'system-backfill',
      }),
    ]);
    expect(updatedRows).toHaveLength(1);
    expect(updatedRows[0]?.patch).toMatchObject({
      relationshipType: 'friend',
      discoveredInLetterId: 'letter-owned',
      confidence: 90,
    });
    expect(updatedRows[0]?.condition).toEqual({
      kind: 'and',
      clauses: [
        {
          kind: 'eq',
          field: 'personRelationships.id',
          value: 'relationship-owned',
        },
        {
          kind: 'eq',
          field: 'personRelationships.confirmedBy',
          value: 'system-backfill',
        },
        {
          kind: 'isNull',
          field: 'personRelationships.confirmedAt',
        },
        {
          kind: 'isNull',
          field: 'personRelationships.entityExtractionRevision',
        },
        {
          kind: 'eq',
          field: 'personRelationships.relationshipType',
          value: 'unknown',
        },
      ],
    });
  });

  it('counts a lost ownership CAS as skipped rather than updated', async () => {
    sourceRows.push({
      letterId: 'letter-owned',
      senderRecipientRelationship: 'friend',
      senderPersonId: 'person-c',
      recipientPersonId: 'person-d',
    });
    existingRelationships.push({
      id: 'relationship-owned',
      relationshipType: 'unknown',
      discoveredInLetterId: null,
      entityExtractionRevision: null,
      confidence: 70,
      confirmedBy: 'system-backfill',
      confirmedAt: null,
    });
    updateResults.push([]);

    await expect(backfillRelationshipsFromLetters()).resolves.toEqual({
      scannedLetters: 1,
      created: 0,
      updated: 0,
      skipped: 1,
    });

    expect(updatedRows).toHaveLength(1);
  });

  it('counts a concurrent insert conflict as skipped rather than created', async () => {
    sourceRows.push({
      letterId: 'letter-create',
      senderRecipientRelationship: 'friend',
      senderPersonId: 'person-a',
      recipientPersonId: 'person-b',
    });
    existingRelationships.push(undefined);
    insertResults.push([]);

    await expect(backfillRelationshipsFromLetters()).resolves.toEqual({
      scannedLetters: 1,
      created: 0,
      updated: 0,
      skipped: 1,
    });

    expect(insertedRows).toHaveLength(1);
  });

  it('writes manual confirmation and extraction relinquishment in one update', async () => {
    const confirmedAt = new Date('2026-07-23T12:00:00.000Z');

    await updateRelationship('relationship-extracted', {
      notes: 'Corrected by a reviewer',
      entityExtractionRevision: null,
      confirmedBy: 'admin',
      confirmedAt,
    });

    expect(updatedRows).toHaveLength(1);
    expect(updatedRows[0]).toEqual({
      patch: {
        notes: 'Corrected by a reviewer',
        entityExtractionRevision: null,
        confirmedBy: 'admin',
        confirmedAt,
        updatedAt: expect.any(Date),
      },
      condition: {
        kind: 'eq',
        field: 'personRelationships.id',
        value: 'relationship-extracted',
      },
    });
  });
});
