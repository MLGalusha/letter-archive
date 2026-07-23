import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;
type Condition =
  | { kind: 'eq'; field: string; value: unknown }
  | { kind: 'inArray'; field: string; values: unknown[] }
  | { kind: 'and' | 'or'; clauses: Condition[] };

const { store, counters, operations } = vi.hoisted(() => ({
  store: {
    canonicalPersons: [] as Row[],
    canonicalPlaces: [] as Row[],
    letterPersons: [] as Row[],
    letterPlaces: [] as Row[],
    letters: [] as Row[],
    personRelationships: [] as Row[],
    auditLog: [] as Row[],
  },
  counters: {
    audit: 0,
  },
  operations: [] as string[],
}));

vi.mock('drizzle-orm', () => ({
  and: (...clauses: Condition[]) => ({ kind: 'and', clauses }),
  asc: (value: unknown) => value,
  desc: (value: unknown) => value,
  eq: (field: string, value: unknown) => ({ kind: 'eq', field, value }),
  inArray: (field: string, values: unknown[]) => ({ kind: 'inArray', field, values }),
  or: (...clauses: Condition[]) => ({ kind: 'or', clauses }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    kind: 'sql',
    strings: Array.from(strings),
    values,
  }),
}));

vi.mock('../../letter/metadata-job.js', () => ({
  buildHumanMetadataJobPatch: () => ({}),
}));

vi.mock('../../letter/metadata-projection.js', () => ({
  buildStructuredMetadataSqlPatch: () => ({}),
}));

vi.mock('../../../db/index.js', () => {
  const table = (tableName: keyof typeof store, fields: string[]) => ({
    tableName,
    ...Object.fromEntries(fields.map((field) => [field, `${tableName}.${field}`])),
  });

  const canonicalPersons = table('canonicalPersons', [
    'id',
    'canonicalName',
    'aliases',
    'notes',
    'biography',
    'biographyStatus',
    'biographyVerifiedAt',
    'biographyVerifiedBy',
    'createdAt',
    'updatedAt',
  ]);
  const canonicalPlaces = table('canonicalPlaces', [
    'id',
    'canonicalName',
    'aliases',
    'placeType',
    'notes',
    'createdAt',
    'updatedAt',
  ]);
  const letterPersons = table('letterPersons', [
    'id',
    'letterId',
    'personId',
    'role',
    'nameAsWritten',
    'relationshipToSender',
    'context',
    'confidence',
    'entityExtractionRevision',
    'confirmedBy',
    'confirmedAt',
    'createdAt',
  ]);
  const letterPlaces = table('letterPlaces', [
    'id',
    'letterId',
    'placeId',
    'role',
    'nameAsWritten',
    'context',
    'confidence',
    'entityExtractionRevision',
    'confirmedBy',
    'confirmedAt',
    'createdAt',
  ]);
  const letters = table('letters', [
    'id',
    'entityExtractionRevision',
    'entityExtractionJson',
  ]);
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
  const auditLog = table('auditLog', [
    'id',
    'action',
    'entityType',
    'entityId',
    'userId',
    'changes',
  ]);

  const fieldName = (field: string) => field.slice(field.indexOf('.') + 1);
  const matches = (row: Row, condition: Condition | undefined): boolean => {
    if (!condition) return true;
    if (condition.kind === 'eq') {
      return row[fieldName(condition.field)] === condition.value;
    }
    if (condition.kind === 'inArray') {
      return condition.values.includes(row[fieldName(condition.field)]);
    }
    if (condition.kind === 'and') {
      return condition.clauses.every((clause) => matches(row, clause));
    }
    return condition.clauses.some((clause) => matches(row, clause));
  };

  const rowsFor = (target: { tableName: keyof typeof store }) => store[target.tableName];
  const queryFor = (target: { tableName: keyof typeof store }) => ({
    findFirst: async ({ where }: { where?: Condition } = {}) => {
      operations.push(`query:${target.tableName}:findFirst`);
      return rowsFor(target).find((row) => matches(row, where));
    },
    findMany: async ({ where }: { where?: Condition } = {}) => {
      operations.push(`query:${target.tableName}:findMany`);
      return rowsFor(target).filter((row) => matches(row, where));
    },
  });

  const executeOnce = <T>(operation: () => T) => {
    let result: T | undefined;
    let executed = false;
    return () => {
      if (!executed) {
        result = operation();
        executed = true;
      }
      return result as T;
    };
  };

  const database: {
    query: Record<string, ReturnType<typeof queryFor>>;
    transaction: <T>(callback: (tx: unknown) => Promise<T>) => Promise<T>;
    execute: (query?: { values?: unknown[] }) => Promise<never[]>;
    update: (target: { tableName: keyof typeof store }) => unknown;
    delete: (target: { tableName: keyof typeof store }) => unknown;
    insert: (target: { tableName: keyof typeof store }) => unknown;
  } & Record<string, unknown> = {
    query: {
      canonicalPersons: queryFor(canonicalPersons),
      canonicalPlaces: queryFor(canonicalPlaces),
      letterPersons: queryFor(letterPersons),
      letterPlaces: queryFor(letterPlaces),
      letters: queryFor(letters),
      personRelationships: queryFor(personRelationships),
      auditLog: queryFor(auditLog),
    },
    transaction: async <T>(callback: (tx: unknown) => Promise<T>) => {
      const snapshot = Object.fromEntries(
        Object.entries(store).map(([key, rows]) => [key, structuredClone(rows)]),
      ) as typeof store;
      const auditCounter = counters.audit;
      try {
        return await callback(database);
      } catch (error) {
        for (const key of Object.keys(store) as Array<keyof typeof store>) {
          store[key].splice(0, store[key].length, ...snapshot[key]);
        }
        counters.audit = auditCounter;
        throw error;
      }
    },
    execute: async (query) => {
      const lockedTable = query?.values?.find(
        (value): value is { tableName: keyof typeof store } => (
          typeof value === 'object'
          && value !== null
          && 'tableName' in value
        ),
      );
      operations.push(`execute:${lockedTable?.tableName ?? 'sql'}`);
      return [];
    },
    update: (target: { tableName: keyof typeof store }) => ({
      set: (patch: Row) => ({
        where: (condition: Condition) => {
          const execute = executeOnce(() => {
            const matched = rowsFor(target).filter((row) => matches(row, condition));
            for (const row of matched) Object.assign(row, patch);
            return matched;
          });
          return {
            then: (
              resolve: (value: Row[]) => unknown,
              reject: (reason: unknown) => unknown,
            ) => Promise.resolve(execute()).then(resolve, reject),
            returning: async () => execute(),
          };
        },
      }),
    }),
    delete: (target: { tableName: keyof typeof store }) => ({
      where: (condition: Condition) => {
        const execute = executeOnce(() => {
          const rows = rowsFor(target);
          const deleted = rows.filter((row) => matches(row, condition));
          for (let index = rows.length - 1; index >= 0; index -= 1) {
            if (matches(rows[index], condition)) rows.splice(index, 1);
          }
          return deleted;
        });
        return {
          then: (
            resolve: (value: Row[]) => unknown,
            reject: (reason: unknown) => unknown,
          ) => Promise.resolve(execute()).then(resolve, reject),
        };
      },
    }),
    insert: (target: { tableName: keyof typeof store }) => ({
      values: (value: Row) => {
        const insert = (ignoreConflict = false) => {
          const row = { ...value };
          if (target.tableName === 'auditLog' && !row.id) {
            counters.audit += 1;
            row.id = `audit-${counters.audit}`;
          }
          const rows = rowsFor(target);
          const uniqueFields = target.tableName === 'letterPersons'
            ? ['letterId', 'personId', 'role']
            : target.tableName === 'letterPlaces'
              ? ['letterId', 'placeId', 'role']
              : target.tableName === 'personRelationships'
                ? ['personAId', 'personBId']
                : [];
          const conflicts = rows.some((existing) => (
            existing.id === row.id
            || (
              uniqueFields.length > 0
              && uniqueFields.every((field) => existing[field] === row[field])
            )
          ));
          if (conflicts) {
            if (ignoreConflict) return [] as Row[];
            throw new Error(`unique conflict in ${target.tableName}`);
          }
          rows.push(row);
          return [row];
        };
        const execute = executeOnce(() => insert());
        return {
          then: (
            resolve: (value: Row[]) => unknown,
            reject: (reason: unknown) => unknown,
          ) => Promise.resolve(execute()).then(resolve, reject),
          returning: async () => execute(),
          onConflictDoNothing: async () => insert(true),
        };
      },
    }),
  };

  return {
    db: database,
    canonicalPersons,
    canonicalPlaces,
    letterPersons,
    letterPlaces,
    letters,
    personRelationships,
    auditLog,
  };
});

import {
  mergePersonsWithUndo,
  undoPersonMerge,
} from '../persons.js';
import {
  mergePlacesWithUndo,
  undoPlaceMerge,
} from '../places.js';

const keepPersonId = '000-person-keep';
const mergePersonId = '100-person-merge';
const otherPersonId = '200-person-other';
const keepPlaceId = '000-place-keep';
const mergePlaceId = '100-place-merge';

function resetStore(): void {
  for (const rows of Object.values(store)) rows.splice(0, rows.length);
  counters.audit = 0;
  operations.splice(0, operations.length);
}

function person(id: string, canonicalName: string): Row {
  return {
    id,
    canonicalName,
    aliases: [],
    notes: null,
    biography: null,
    biographyStatus: 'EMPTY',
    biographyVerifiedAt: null,
    biographyVerifiedBy: null,
    createdAt: new Date('2026-07-20T10:00:00.000Z'),
    updatedAt: new Date('2026-07-20T10:00:00.000Z'),
  };
}

function place(id: string, canonicalName: string): Row {
  return {
    id,
    canonicalName,
    aliases: [],
    placeType: 'city',
    notes: null,
    createdAt: new Date('2026-07-20T10:00:00.000Z'),
    updatedAt: new Date('2026-07-20T10:00:00.000Z'),
  };
}

describe('entity merge provenance', () => {
  beforeEach(resetStore);

  it('moves complete person-junction and relationship winners, then undo restores both revisions', async () => {
    store.canonicalPersons.push(
      person(keepPersonId, 'Keep Person'),
      person(mergePersonId, 'Merge Person'),
      person(otherPersonId, 'Other Person'),
    );
    store.letters.push(
      {
        id: 'letter-junction',
        entityExtractionRevision: 7,
        entityExtractionJson: { people: [] },
      },
      {
        id: 'letter-system',
        entityExtractionRevision: 2,
        entityExtractionJson: null,
      },
      {
        id: 'letter-human',
        entityExtractionRevision: 4,
        entityExtractionJson: { relationships: [] },
      },
    );

    const retainedLink = {
      id: 'link-retained',
      letterId: 'letter-junction',
      personId: keepPersonId,
      role: 'mentioned',
      nameAsWritten: 'stale retained name',
      relationshipToSender: 'stale retained relationship',
      context: 'stale retained context',
      confidence: 99,
      entityExtractionRevision: 6,
      confirmedBy: null,
      confirmedAt: null,
      createdAt: new Date('2026-07-20T10:00:00.000Z'),
    };
    const incomingLink = {
      id: 'link-incoming',
      letterId: 'letter-junction',
      personId: mergePersonId,
      role: 'mentioned',
      nameAsWritten: 'current extraction name',
      relationshipToSender: null,
      context: 'current extraction context',
      confidence: 40,
      entityExtractionRevision: 7,
      confirmedBy: null,
      confirmedAt: null,
      createdAt: new Date('2026-07-20T11:00:00.000Z'),
    };
    const retainedLinkBefore = { ...retainedLink };
    const incomingLinkBefore = { ...incomingLink };
    store.letterPersons.push(retainedLink, incomingLink);

    const retainedRelationship = {
      id: 'relationship-retained',
      personAId: keepPersonId,
      personBId: otherPersonId,
      relationshipType: 'unknown',
      notes: 'system notes must not survive',
      discoveredInLetterId: 'letter-system',
      entityExtractionRevision: null,
      confidence: 95,
      confirmedBy: 'system-backfill',
      confirmedAt: null,
      createdAt: new Date('2026-07-20T10:00:00.000Z'),
      updatedAt: new Date('2026-07-20T10:00:00.000Z'),
    };
    const humanConfirmedAt = new Date('2026-07-21T12:00:00.000Z');
    const incomingRelationship = {
      id: 'relationship-incoming',
      personAId: mergePersonId,
      personBId: otherPersonId,
      relationshipType: 'sibling',
      notes: null,
      discoveredInLetterId: 'letter-human',
      entityExtractionRevision: 4,
      confidence: 35,
      confirmedBy: 'admin@example.test',
      confirmedAt: humanConfirmedAt,
      createdAt: new Date('2026-07-21T11:00:00.000Z'),
      updatedAt: new Date('2026-07-21T12:00:00.000Z'),
    };
    const retainedRelationshipBefore = { ...retainedRelationship };
    const incomingRelationshipBefore = { ...incomingRelationship };
    store.personRelationships.push(retainedRelationship, incomingRelationship);

    const result = await mergePersonsWithUndo(
      keepPersonId,
      mergePersonId,
      'admin@example.test',
    );

    expect(operations.indexOf('execute:canonicalPersons')).toBeLessThan(
      operations.indexOf('query:letterPersons:findMany'),
    );
    expect(operations.indexOf('execute:letterPersons')).toBeLessThan(
      operations.indexOf('query:letterPersons:findMany'),
    );
    expect(operations.indexOf('execute:personRelationships')).toBeLessThan(
      operations.indexOf('query:personRelationships:findMany'),
    );
    expect(result.undoActionId).toBe('audit-1');
    expect(store.letterPersons).toHaveLength(1);
    expect(store.letterPersons[0]).toMatchObject({
      id: 'link-retained',
      personId: keepPersonId,
      nameAsWritten: 'current extraction name',
      relationshipToSender: null,
      context: 'current extraction context',
      confidence: 40,
      entityExtractionRevision: 7,
      confirmedBy: null,
      confirmedAt: null,
    });
    expect(store.personRelationships).toHaveLength(1);
    expect(store.personRelationships[0]).toMatchObject({
      id: 'relationship-retained',
      relationshipType: 'sibling',
      notes: null,
      discoveredInLetterId: 'letter-human',
      entityExtractionRevision: 4,
      confidence: 35,
      confirmedBy: 'admin@example.test',
      confirmedAt: humanConfirmedAt,
    });

    const mergeAudit = store.auditLog[0];
    const changes = mergeAudit.changes as {
      deletedDuplicateLinks: Array<{ entityExtractionRevision: number | null }>;
      mutatedExistingLinks: Array<{
        before: { entityExtractionRevision: number | null };
      }>;
      deletedRelationships: Array<{ entityExtractionRevision: number | null }>;
      mutatedExistingRelationships: Array<{
        before: { entityExtractionRevision: number | null };
      }>;
    };
    expect(changes.deletedDuplicateLinks[0].entityExtractionRevision).toBe(7);
    expect(changes.mutatedExistingLinks[0].before.entityExtractionRevision).toBe(6);
    expect(changes.deletedRelationships[0].entityExtractionRevision).toBe(4);
    expect(
      changes.mutatedExistingRelationships[0].before.entityExtractionRevision,
    ).toBeNull();

    store.personRelationships[0].notes = 'edited after merge';
    const divergedPersonState = structuredClone(store);
    await expect(
      undoPersonMerge(result.undoActionId!, 'admin@example.test'),
    ).rejects.toThrow(
      'Retained person relationships changed after the merge; undo was not applied',
    );
    expect(store).toEqual(divergedPersonState);
    expect(store.auditLog.map((row) => row.action)).toEqual(['person.merge']);
    store.personRelationships[0].notes = null;

    await undoPersonMerge(result.undoActionId!, 'admin@example.test');

    expect(store.letterPersons).toHaveLength(2);
    expect(store.letterPersons.find((row) => row.id === 'link-retained')).toMatchObject(
      retainedLinkBefore,
    );
    expect(store.letterPersons.find((row) => row.id === 'link-incoming')).toMatchObject(
      incomingLinkBefore,
    );
    expect(store.personRelationships).toHaveLength(2);
    expect(
      store.personRelationships.find((row) => row.id === 'relationship-retained'),
    ).toMatchObject(retainedRelationshipBefore);
    expect(
      store.personRelationships.find((row) => row.id === 'relationship-incoming'),
    ).toMatchObject(incomingRelationshipBefore);
  });

  it('moves a complete current place-junction payload and undo restores both revisions', async () => {
    store.canonicalPlaces.push(
      place(keepPlaceId, 'Keep Place'),
      place(mergePlaceId, 'Merge Place'),
    );
    store.letters.push({
      id: 'letter-place',
      entityExtractionRevision: 9,
      entityExtractionJson: { places: [] },
    });

    const retainedLink = {
      id: 'place-link-retained',
      letterId: 'letter-place',
      placeId: keepPlaceId,
      role: 'mentioned',
      nameAsWritten: 'stale place',
      context: 'stale context',
      confidence: 100,
      entityExtractionRevision: 8,
      confirmedBy: null,
      confirmedAt: null,
      createdAt: new Date('2026-07-20T10:00:00.000Z'),
    };
    const incomingLink = {
      id: 'place-link-incoming',
      letterId: 'letter-place',
      placeId: mergePlaceId,
      role: 'mentioned',
      nameAsWritten: 'current place',
      context: null,
      confidence: 25,
      entityExtractionRevision: 9,
      confirmedBy: null,
      confirmedAt: null,
      createdAt: new Date('2026-07-21T10:00:00.000Z'),
    };
    const retainedBefore = { ...retainedLink };
    const incomingBefore = { ...incomingLink };
    store.letterPlaces.push(retainedLink, incomingLink);

    const result = await mergePlacesWithUndo(
      keepPlaceId,
      mergePlaceId,
      'admin@example.test',
    );

    expect(operations.indexOf('execute:canonicalPlaces')).toBeLessThan(
      operations.indexOf('query:letterPlaces:findMany'),
    );
    expect(operations.indexOf('execute:letterPlaces')).toBeLessThan(
      operations.indexOf('query:letterPlaces:findMany'),
    );
    expect(result.undoActionId).toBe('audit-1');
    expect(store.letterPlaces).toHaveLength(1);
    expect(store.letterPlaces[0]).toMatchObject({
      id: 'place-link-retained',
      placeId: keepPlaceId,
      nameAsWritten: 'current place',
      context: null,
      confidence: 25,
      entityExtractionRevision: 9,
      confirmedBy: null,
      confirmedAt: null,
    });

    const changes = store.auditLog[0].changes as {
      deletedDuplicateLinks: Array<{ entityExtractionRevision: number | null }>;
      mutatedExistingLinks: Array<{
        before: { entityExtractionRevision: number | null };
      }>;
    };
    expect(changes.deletedDuplicateLinks[0].entityExtractionRevision).toBe(9);
    expect(changes.mutatedExistingLinks[0].before.entityExtractionRevision).toBe(8);

    store.letterPlaces[0].context = 'edited after merge';
    const divergedPlaceState = structuredClone(store);
    await expect(
      undoPlaceMerge(result.undoActionId!, 'admin@example.test'),
    ).rejects.toThrow(
      'Retained place links changed after the merge; undo was not applied',
    );
    expect(store).toEqual(divergedPlaceState);
    expect(store.auditLog.map((row) => row.action)).toEqual(['place.merge']);
    store.letterPlaces[0].context = null;

    await undoPlaceMerge(result.undoActionId!, 'admin@example.test');

    expect(store.letterPlaces).toHaveLength(2);
    expect(
      store.letterPlaces.find((row) => row.id === 'place-link-retained'),
    ).toMatchObject(retainedBefore);
    expect(
      store.letterPlaces.find((row) => row.id === 'place-link-incoming'),
    ).toMatchObject(incomingBefore);
  });

  it('rejects an incomplete person collision restore instead of recording undo', async () => {
    store.canonicalPersons.push(
      person(keepPersonId, 'Keep Person'),
      person(mergePersonId, 'Merge Person'),
    );
    store.letters.push({
      id: 'letter-person-conflict',
      entityExtractionRevision: 3,
      entityExtractionJson: { people: [] },
    });
    const incoming = {
      id: 'person-link-incoming',
      letterId: 'letter-person-conflict',
      personId: mergePersonId,
      role: 'mentioned',
      nameAsWritten: 'incoming',
      relationshipToSender: null,
      context: null,
      confidence: 80,
      entityExtractionRevision: 3,
      confirmedBy: null,
      confirmedAt: null,
      createdAt: new Date('2026-07-20T10:00:00.000Z'),
    };
    store.letterPersons.push(
      {
        ...incoming,
        id: 'person-link-retained',
        personId: keepPersonId,
        nameAsWritten: 'retained',
        entityExtractionRevision: 2,
      },
      incoming,
    );

    const result = await mergePersonsWithUndo(
      keepPersonId,
      mergePersonId,
      'admin@example.test',
    );
    store.letterPersons.push({
      ...incoming,
      personId: keepPersonId,
      role: 'sender',
      nameAsWritten: 'replacement using snapshot id',
    });
    const beforeUndo = structuredClone(store);

    await expect(
      undoPersonMerge(result.undoActionId!, 'admin@example.test'),
    ).rejects.toThrow('unique conflict in letterPersons');

    expect(store).toEqual(beforeUndo);
    expect(store.auditLog.map((row) => row.action)).toEqual(['person.merge']);
  });

  it('rolls back every place mutation when a collision snapshot cannot be restored', async () => {
    store.canonicalPlaces.push(
      place(keepPlaceId, 'Keep Place'),
      place(mergePlaceId, 'Merge Place'),
    );
    store.letters.push({
      id: 'letter-place-conflict',
      entityExtractionRevision: 5,
      entityExtractionJson: { places: [] },
    });
    const incoming = {
      id: 'place-link-incoming',
      letterId: 'letter-place-conflict',
      placeId: mergePlaceId,
      role: 'mentioned',
      nameAsWritten: 'incoming',
      context: null,
      confidence: 80,
      entityExtractionRevision: 5,
      confirmedBy: null,
      confirmedAt: null,
      createdAt: new Date('2026-07-20T10:00:00.000Z'),
    };
    store.letterPlaces.push(
      {
        ...incoming,
        id: 'place-link-retained',
        placeId: keepPlaceId,
        nameAsWritten: 'retained',
        entityExtractionRevision: 4,
      },
      incoming,
    );

    const result = await mergePlacesWithUndo(
      keepPlaceId,
      mergePlaceId,
      'admin@example.test',
    );
    store.letterPlaces.push({
      ...incoming,
      placeId: keepPlaceId,
      role: 'destination',
      nameAsWritten: 'replacement using snapshot id',
    });
    const beforeUndo = structuredClone(store);

    await expect(
      undoPlaceMerge(result.undoActionId!, 'admin@example.test'),
    ).rejects.toThrow('unique conflict in letterPlaces');

    expect(store).toEqual(beforeUndo);
    expect(store.auditLog.map((row) => row.action)).toEqual(['place.merge']);
  });
});
