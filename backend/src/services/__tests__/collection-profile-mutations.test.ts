import { beforeEach, describe, expect, it, vi } from 'vitest';

const { collectionsTable } = vi.hoisted(() => ({
  collectionsTable: {
    id: 'collections.id',
    profileRevision: 'collections.profileRevision',
    profileSourceFingerprint: 'collections.profileSourceFingerprint',
    profileStatus: 'collections.profileStatus',
  },
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ kind: 'and', conditions })),
  eq: vi.fn((field: unknown, value: unknown) => ({
    kind: 'eq',
    field,
    value,
  })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    kind: 'sql',
    strings: [...strings],
    values,
  })),
}));

vi.mock('../../db/index.js', () => ({
  collections: collectionsTable,
  db: {},
}));

vi.mock('../collection-profile-source.js', () => ({
  computeCollectionProfileSourceFingerprint: vi.fn(),
}));

import type { Collection, Database } from '../../db/index.js';
import {
  advanceCollectionProfileRevision,
  commitAtomicCollectionEditorProfile,
  storeGeneratedCollectionProfile,
  updateCollectionProfile,
  updateCollectionSourceMetadata,
} from '../collection-profile-mutations.js';

function makeCollection(
  overrides: Record<string, unknown> = {},
): Collection {
  return {
    id: 'collection-1',
    collectionCode: '009',
    title: 'Collection Nine',
    description: 'Original notes',
    profileRevision: 5,
    profileSourceFingerprint: 'a'.repeat(32),
    profileStatus: 'EDITED',
    profileNarrative: 'Existing narrative',
    ...overrides,
  } as unknown as Collection;
}

function createDatabase(returnedRows: unknown[] = []) {
  const returning = vi.fn().mockResolvedValue(returnedRows);
  const where = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));
  const execute = vi.fn();

  return {
    database: { execute, update } as unknown as Database,
    execute,
    returning,
    set,
    update,
    where,
  };
}

describe('collection profile mutation boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('advances source authority and demotes verified content in one write', async () => {
    const harness = createDatabase();

    await advanceCollectionProfileRevision(
      'collection-1',
      harness.database,
      { clearHighlightImage: true },
    );

    expect(harness.update).toHaveBeenCalledWith(collectionsTable);
    expect(harness.set).toHaveBeenCalledWith({
      profileRevision: expect.objectContaining({ kind: 'sql' }),
      profileStatus: expect.objectContaining({ kind: 'sql' }),
      highlightImageId: null,
    });
    expect(harness.where).toHaveBeenCalledWith({
      kind: 'eq',
      field: 'collections.id',
      value: 'collection-1',
    });
  });

  it('preserves an exact source-metadata no-op without requiring a write', async () => {
    const current = makeCollection();
    const harness = createDatabase();

    const result = await updateCollectionSourceMetadata({
      collection: current,
      expectedProfileRevision: 4,
      title: current.title ?? undefined,
      description: current.description,
    }, harness.database);

    expect(result).toBe(current);
    expect(harness.update).not.toHaveBeenCalled();
  });

  it('rejects a known-stale source-metadata change before writing', async () => {
    const harness = createDatabase();

    await expect(updateCollectionSourceMetadata({
      collection: makeCollection(),
      expectedProfileRevision: 4,
      description: 'Stale replacement',
    }, harness.database)).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining('changed'),
    });
    expect(harness.update).not.toHaveBeenCalled();
  });

  it('compare-and-sets source metadata through the observed revision', async () => {
    const harness = createDatabase([]);

    await expect(updateCollectionSourceMetadata({
      collection: makeCollection(),
      expectedProfileRevision: 5,
      description: 'Concurrent replacement',
    }, harness.database)).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining('changed'),
    });
    expect(harness.where).toHaveBeenCalledWith({
      kind: 'and',
      conditions: [
        { kind: 'eq', field: 'collections.id', value: 'collection-1' },
        {
          kind: 'eq',
          field: 'collections.profileRevision',
          value: 5,
        },
      ],
    });
  });

  it('stores generated output only behind revision and source guards', async () => {
    const harness = createDatabase([{ profileRevision: 6 }]);
    const generatedAt = new Date('2026-07-24T12:00:00.000Z');

    const profileRevision = await storeGeneratedCollectionProfile({
      collectionId: 'collection-1',
      expectedProfileRevision: 5,
      generatedAt,
      profile: {
        sourceFingerprint: 'b'.repeat(32),
        hook: 'Generated hook',
        narrative: 'Generated narrative',
        correspondents: [],
      },
    }, harness.database);

    expect(profileRevision).toBe(6);
    expect(harness.set).toHaveBeenCalledWith(expect.objectContaining({
      profileSourceFingerprint: 'b'.repeat(32),
      profileStatus: 'AI_DRAFT',
      profileGeneratedAt: generatedAt,
      profileRevision: expect.objectContaining({ kind: 'sql' }),
    }));
    expect(harness.where).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'and',
      conditions: expect.arrayContaining([
        {
          kind: 'eq',
          field: 'collections.profileRevision',
          value: 5,
        },
        expect.objectContaining({ kind: 'sql' }),
      ]),
    }));
  });

  it('returns exact profile content no-ops without advancing the revision', async () => {
    const current = makeCollection();
    const harness = createDatabase();

    const result = await updateCollectionProfile({
      collection: current,
      expectedProfileRevision: 5,
      changes: { profileNarrative: 'Existing narrative' },
    }, { database: harness.database });

    expect(result).toBe(current);
    expect(harness.update).not.toHaveBeenCalled();
  });

  it('commits the atomic editor profile patch through its locked revision', async () => {
    const harness = createDatabase([{ profileRevision: 6 }]);

    const profileRevision = await commitAtomicCollectionEditorProfile({
      collection: makeCollection(),
      patch: { description: 'Updated notes' },
      profileContentChanged: false,
    }, {
      database: harness.database,
    });

    expect(profileRevision).toBe(6);
    expect(harness.set).toHaveBeenCalledWith(expect.objectContaining({
      description: 'Updated notes',
      profileStatus: 'EDITED',
      profileRevision: 6,
    }));
    expect(harness.where).toHaveBeenCalledWith({
      kind: 'and',
      conditions: [
        { kind: 'eq', field: 'collections.id', value: 'collection-1' },
        {
          kind: 'eq',
          field: 'collections.profileRevision',
          value: 5,
        },
      ],
    });
  });
});
