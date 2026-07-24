import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  transactionMock,
  collectionFindFirstMock,
  lettersFindManyMock,
  computeFingerprintMock,
} = vi.hoisted(() => ({
  transactionMock: vi.fn(),
  collectionFindFirstMock: vi.fn(),
  lettersFindManyMock: vi.fn(),
  computeFingerprintMock: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...clauses: unknown[]) => ({ kind: 'and', clauses })),
  eq: vi.fn((field: unknown, value: unknown) => ({ kind: 'eq', field, value })),
  asc: vi.fn((field: unknown) => ({ kind: 'asc', field })),
}));

vi.mock('../../db/index.js', () => {
  const transactionExecutor = {
    query: {
      collections: { findFirst: collectionFindFirstMock },
      letters: { findMany: lettersFindManyMock },
    },
    execute: vi.fn(),
  };
  transactionMock.mockImplementation(
    (callback: (tx: typeof transactionExecutor) => unknown) =>
      callback(transactionExecutor),
  );
  return {
    db: {
      transaction: transactionMock,
      query: {
        letters: { findMany: vi.fn() },
      },
    },
    collections: {
      id: 'collections.id',
    },
    letters: {
      id: 'letters.id',
      collectionId: 'letters.collectionId',
      type: 'letters.type',
      visibility: 'letters.visibility',
      metadataPublished: 'letters.metadataPublished',
      letterDate: 'letters.letterDate',
      dateRaw: 'letters.dateRaw',
    },
  };
});

vi.mock('../../config/env.js', () => ({
  env: {},
  hasOpenAI: false,
}));

vi.mock('../../services/collection-profile-source.js', () => ({
  computeCollectionProfileSourceFingerprint: computeFingerprintMock,
}));

vi.mock('../../services/notifications.js', () => ({
  notify: vi.fn(),
}));

vi.mock('../../services/usage-tracking.js', () => ({
  logApiUsage: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

import { generateCollectionProfile } from '../generate-collection-profile.js';

describe('collection profile generation source snapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    collectionFindFirstMock.mockResolvedValue({
      id: 'collection-1',
      collectionCode: '001',
      title: 'Collection One',
      description: 'Description',
    });
    lettersFindManyMock.mockResolvedValue([{
      id: 'letter-1',
      letterDate: '1947-08-10',
      dateRaw: '19470810',
      sender: 'Sender',
      recipient: 'Recipient',
      summary: 'Summary',
      hook: 'Hook',
      entityExtractionJson: null,
    }]);
    computeFingerprintMock.mockResolvedValue('a'.repeat(32));
  });

  it('uses one repeatable-read snapshot of only public metadata corpus inputs', async () => {
    const result = await generateCollectionProfile('collection-1');

    expect(result).toMatchObject({
      sourceFingerprint: 'a'.repeat(32),
      isStub: true,
    });
    expect(transactionMock).toHaveBeenCalledWith(
      expect.any(Function),
      {
        isolationLevel: 'repeatable read',
        accessMode: 'read only',
      },
    );
    expect(computeFingerprintMock).toHaveBeenCalledWith(
      'collection-1',
      expect.objectContaining({
        query: expect.objectContaining({
          collections: expect.any(Object),
          letters: expect.any(Object),
        }),
      }),
    );
    expect(lettersFindManyMock).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        kind: 'and',
        clauses: expect.arrayContaining([
          {
            kind: 'eq',
            field: 'letters.type',
            value: 'L',
          },
          {
            kind: 'eq',
            field: 'letters.visibility',
            value: 'PUBLISHED',
          },
          {
            kind: 'eq',
            field: 'letters.metadataPublished',
            value: true,
          },
        ]),
      },
      orderBy: [
        { kind: 'asc', field: 'letters.letterDate' },
        { kind: 'asc', field: 'letters.dateRaw' },
        { kind: 'asc', field: 'letters.id' },
      ],
    }));
  });
});
