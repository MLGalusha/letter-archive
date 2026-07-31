import { beforeEach, describe, expect, it, vi } from 'vitest';

type TestPageState = {
  id: string;
  letterId: string;
  checksumSha256: string | null;
  ownerRevision: number;
  pageLayout: unknown;
  pageLayoutChecksumSha256: string | null;
  lineSegments: unknown;
  segmentTrustState: 'unverified' | 'trusted';
  updatedAt: Date;
};

type TestCondition =
  | { kind: 'and'; clauses: TestCondition[] }
  | { kind: 'eq'; field: string; value: unknown }
  | { kind: 'isNull'; field: string }
  | { kind: 'sourceRevision'; expectedRevision: unknown };

const harness = vi.hoisted(() => ({
  page: null as TestPageState | null,
  ownerExists: true,
  patches: [] as Array<Record<string, unknown>>,
  conditions: [] as TestCondition[],
  mutateAfterLockedPageRead: null as null | (() => void),
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...clauses: TestCondition[]) => ({ kind: 'and', clauses })),
  eq: vi.fn((field: string, value: unknown) => ({ kind: 'eq', field, value })),
  isNull: vi.fn((field: string) => ({ kind: 'isNull', field })),
  sql: vi.fn((_strings: TemplateStringsArray, ...values: unknown[]) => ({
    kind: 'sourceRevision',
    expectedRevision: values.at(-1),
  })),
}));

vi.mock('../../db/index.js', () => {
  const letters = {
    id: 'letters.id',
    primarySourceRevision: 'letters.primarySourceRevision',
  };
  const letterPages = {
    id: 'letterPages.id',
    letterId: 'letterPages.letterId',
    checksumSha256: 'letterPages.checksumSha256',
    pageLayout: 'letterPages.pageLayout',
    lineSegments: 'letterPages.lineSegments',
  };

  function pageField(field: string): keyof TestPageState {
    const key = field.replace('letterPages.', '');
    return key as keyof TestPageState;
  }

  function matches(condition: TestCondition): boolean {
    const page = harness.page;
    if (!page) return false;
    switch (condition.kind) {
      case 'and':
        return condition.clauses.every(matches);
      case 'eq':
        return page[pageField(condition.field)] === condition.value;
      case 'isNull':
        return page[pageField(condition.field)] === null;
      case 'sourceRevision':
        return page.ownerRevision === condition.expectedRevision;
    }
  }

  const tx = {
    query: {
      letterPages: {
        findFirst: vi.fn((options: {
          columns: Record<string, boolean>;
        }) => {
          const page = harness.page;
          if (!page) return undefined;
          if (options.columns.letterId) {
            return { letterId: page.letterId };
          }
          if (options.columns.lineSegments) {
            const result = { lineSegments: page.lineSegments };
            harness.mutateAfterLockedPageRead?.();
            harness.mutateAfterLockedPageRead = null;
            return result;
          }
          throw new Error('Unexpected page selection in source-bound write test');
        }),
      },
    },
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          for: vi.fn(() => harness.ownerExists && harness.page
            ? [{ id: harness.page.letterId }]
            : []),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((patch: Record<string, unknown>) => ({
        where: vi.fn((condition: TestCondition) => ({
          returning: vi.fn(() => {
            harness.patches.push(patch);
            harness.conditions.push(condition);
            if (!matches(condition) || !harness.page) return [];
            Object.assign(harness.page, patch);
            return [{ id: harness.page.id }];
          }),
        })),
      })),
    })),
  };

  return {
    db: {
      transaction: vi.fn(
        async (callback: (executor: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
    },
    letters,
    letterPages,
  };
});

import { insertSourceBoundPageLayout } from '../page-source-bound-write.js';

const sourceChecksum = 'a'.repeat(64);
const canonicalChecksum = 'b'.repeat(64);
const canonicalLayout = {
  schemaVersion: 2,
  layoutId: 'layout-first',
};
const projectedSegments = [{
  id: 'line-native',
  line: 1,
  baseline: [[10, 20], [90, 20]],
}];
const expectedSource = {
  primarySourceRevision: 4,
  sourceChecksum,
};

function resetPage(overrides: Partial<TestPageState> = {}): TestPageState {
  const page = {
    id: 'page-1',
    letterId: 'letter-1',
    checksumSha256: sourceChecksum,
    ownerRevision: 4,
    pageLayout: null,
    pageLayoutChecksumSha256: null,
    lineSegments: null,
    segmentTrustState: 'unverified' as const,
    updatedAt: new Date('2026-07-28T12:00:00.000Z'),
    ...overrides,
  };
  harness.page = page;
  return page;
}

function insert(layout: unknown = canonicalLayout) {
  return insertSourceBoundPageLayout(
    'page-1',
    {
      pageLayout: layout,
      pageLayoutChecksumSha256: canonicalChecksum,
      updatedAt: new Date('2026-07-28T13:00:00.000Z'),
    },
    {
      lineSegments: projectedSegments,
      segmentTrustState: 'unverified',
    },
    expectedSource,
  );
}

describe('source-bound PageLayout insertion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.ownerExists = true;
    harness.patches = [];
    harness.conditions = [];
    harness.mutateAfterLockedPageRead = null;
    resetPage();
  });

  it('creates canonical evidence and its initial projection only once', async () => {
    const page = resetPage();

    await expect(insert()).resolves.toEqual({
      saved: true,
      projectionAction: 'created',
    });
    expect(page).toMatchObject({
      pageLayout: canonicalLayout,
      pageLayoutChecksumSha256: canonicalChecksum,
      lineSegments: projectedSegments,
      segmentTrustState: 'unverified',
    });

    const replacementLayout = {
      schemaVersion: 2,
      layoutId: 'layout-replacement',
    };
    await expect(insert(replacementLayout)).resolves.toEqual({
      saved: false,
      projectionAction: null,
    });
    expect(page.pageLayout).toBe(canonicalLayout);
    expect(page.lineSegments).toBe(projectedSegments);
    expect(harness.conditions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'and',
        clauses: expect.arrayContaining([
          { kind: 'isNull', field: 'letterPages.pageLayout' },
        ]),
      }),
    ]));
  });

  it('stores canonical evidence without replacing existing review geometry or trust', async () => {
    const reviewedSegments = [{
      id: 'human-line',
      line: 1,
      bbox: [1, 2, 30, 40],
      mappedText: 'human correction',
    }];
    const page = resetPage({
      lineSegments: reviewedSegments,
      segmentTrustState: 'trusted',
    });

    await expect(insert()).resolves.toEqual({
      saved: true,
      projectionAction: 'preserved',
    });
    expect(page.pageLayout).toBe(canonicalLayout);
    expect(page.pageLayoutChecksumSha256).toBe(canonicalChecksum);
    expect(page.lineSegments).toBe(reviewedSegments);
    expect(page.segmentTrustState).toBe('trusted');
    expect(harness.patches).toHaveLength(1);
    expect(harness.patches[0]).not.toHaveProperty('lineSegments');
    expect(harness.patches[0]).not.toHaveProperty('segmentTrustState');
  });

  it('falls back to canonical-only storage when review geometry wins an out-of-band race', async () => {
    const racedSegments = [{
      id: 'raced-line',
      line: 1,
      bbox: [5, 5, 25, 25],
    }];
    const page = resetPage();
    harness.mutateAfterLockedPageRead = () => {
      if (!harness.page) throw new Error('Expected a page');
      harness.page.lineSegments = racedSegments;
      harness.page.segmentTrustState = 'trusted';
    };

    await expect(insert()).resolves.toEqual({
      saved: true,
      projectionAction: 'preserved',
    });
    expect(page.pageLayout).toBe(canonicalLayout);
    expect(page.lineSegments).toBe(racedSegments);
    expect(page.segmentTrustState).toBe('trusted');
    expect(harness.patches).toHaveLength(2);
    expect(harness.patches[0]).toHaveProperty('lineSegments');
    expect(harness.patches[1]).not.toHaveProperty('lineSegments');
  });

  it.each([
    ['source checksum', { checksumSha256: 'f'.repeat(64) }],
    ['owner revision', { ownerRevision: 5 }],
  ])('refuses a stale %s without changing the page', async (_name, stale) => {
    const page = resetPage(stale);
    const before = structuredClone(page);

    await expect(insert()).resolves.toEqual({
      saved: false,
      projectionAction: null,
    });
    expect(page).toEqual(before);
    expect(harness.conditions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'and',
        clauses: expect.arrayContaining([
          {
            kind: 'eq',
            field: 'letterPages.checksumSha256',
            value: sourceChecksum,
          },
          {
            kind: 'sourceRevision',
            expectedRevision: 4,
          },
        ]),
      }),
    ]));
  });
});
