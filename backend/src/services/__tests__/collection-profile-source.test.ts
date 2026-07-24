import { beforeEach, describe, expect, it, vi } from 'vitest';

const { executeMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
}));

vi.mock('drizzle-orm', () => {
  const sql = Object.assign(
    vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
      strings: Array.from(strings),
      values,
    })),
    {
      join: vi.fn((values: unknown[]) => ({ joined: values })),
    },
  );
  return { sql };
});

vi.mock('../../db/index.js', () => ({
  db: { execute: executeMock },
}));

import {
  collectionProfilePublicationIsCurrent,
  collectionProfileSourceIsCurrent,
  computeCollectionProfileSourceFingerprint,
  getCurrentCollectionProfilePublicationIds,
} from '../collection-profile-source.js';

describe('collection profile source fingerprint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads the canonical database-computed fingerprint', async () => {
    executeMock.mockResolvedValue([{ fingerprint: 'a'.repeat(32) }]);

    await expect(
      computeCollectionProfileSourceFingerprint('collection-1'),
    ).resolves.toBe('a'.repeat(32));
  });

  it('requires a stored fingerprint and exact current match', async () => {
    await expect(
      collectionProfileSourceIsCurrent('collection-1', null),
    ).resolves.toBe(false);
    expect(executeMock).not.toHaveBeenCalled();

    executeMock.mockResolvedValue([{ fingerprint: 'b'.repeat(32) }]);
    await expect(
      collectionProfileSourceIsCurrent('collection-1', 'a'.repeat(32)),
    ).resolves.toBe(false);
    await expect(
      collectionProfileSourceIsCurrent('collection-1', 'b'.repeat(32)),
    ).resolves.toBe(true);
  });

  it('reads final publication authority from one database statement', async () => {
    executeMock.mockResolvedValue([{ current: true }]);

    await expect(
      collectionProfilePublicationIsCurrent('collection-1'),
    ).resolves.toBe(true);
    expect(executeMock).toHaveBeenCalledOnce();

    executeMock.mockResolvedValueOnce([{ current: false }]);
    await expect(
      collectionProfilePublicationIsCurrent('collection-1'),
    ).resolves.toBe(false);
  });

  it('rejects a list profile edit committed after an earlier source read', async () => {
    executeMock
      .mockResolvedValueOnce([{ fingerprint: 'a'.repeat(32) }])
      .mockResolvedValueOnce([]);

    await expect(
      collectionProfileSourceIsCurrent('collection-1', 'a'.repeat(32)),
    ).resolves.toBe(true);
    await expect(
      getCurrentCollectionProfilePublicationIds(['collection-1']),
    ).resolves.toEqual(new Set());

    const finalQuery = executeMock.mock.calls[1]?.[0] as {
      strings: string[];
    };
    const finalSql = finalQuery.strings.join(' ');
    expect(finalSql).toContain("c.profile_status = 'VERIFIED'");
    expect(finalSql).toContain('c.profile_source_fingerprint IS NOT NULL');
    expect(finalSql).toContain(
      'compute_collection_profile_source_fingerprint(c.id)',
    );
  });

  it('reads current collection profile publication ids in one query', async () => {
    executeMock.mockResolvedValue([
      { collection_id: 'collection-1' },
      { collection_id: 'collection-2' },
    ]);

    await expect(
      getCurrentCollectionProfilePublicationIds([
        'collection-1',
        'collection-2',
      ]),
    ).resolves.toEqual(new Set([
      'collection-1',
      'collection-2',
    ]));
    expect(executeMock).toHaveBeenCalledOnce();
  });

  it('does not issue invalid SQL for an empty collection set', async () => {
    await expect(
      getCurrentCollectionProfilePublicationIds([]),
    ).resolves.toEqual(new Set());
    expect(executeMock).not.toHaveBeenCalled();
  });
});
