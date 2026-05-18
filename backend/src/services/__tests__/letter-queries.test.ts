import { beforeEach, describe, expect, it, vi } from 'vitest';

const { executeMock, findCollectionsMock, findLettersMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
  findCollectionsMock: vi.fn(),
  findLettersMock: vi.fn(),
}));

function renderSql(value: unknown): string {
  if (value && typeof value === 'object' && 'text' in value) {
    return String((value as { text: string }).text);
  }
  return String(value);
}

vi.mock('drizzle-orm', () => {
  const sqlTag = (strings: TemplateStringsArray, ...values: unknown[]) => ({
    text: strings.reduce((acc, part, index) => (
      acc + part + (index < values.length ? renderSql(values[index]) : '')
    ), ''),
  });
  sqlTag.join = (values: unknown[], separator: unknown) => ({
    text: values.map(renderSql).join(renderSql(separator)),
  });

  return {
    sql: sqlTag,
    eq: vi.fn((field: unknown, value: unknown) => ({ field, value })),
    and: vi.fn((...clauses: unknown[]) => ({ clauses })),
    inArray: vi.fn((field: unknown, values: unknown[]) => ({ field, values })),
    or: vi.fn((...clauses: unknown[]) => ({ clauses })),
    ilike: vi.fn((field: unknown, value: unknown) => ({ field, value })),
    count: vi.fn(() => ({ count: true })),
  };
});

vi.mock('../../db/index.js', () => ({
  db: {
    execute: executeMock,
    query: {
      collections: { findMany: findCollectionsMock },
      letters: { findMany: findLettersMock },
    },
  },
  collections: {
    collectionCode: 'collections.collectionCode',
  },
  letters: {
    id: 'letters.id',
    collectionId: 'letters.collectionId',
    dateRaw: 'letters.dateRaw',
    typeSequence: 'letters.typeSequence',
    type: 'letters.type',
  },
  letterPages: {
    letterId: 'letter_pages.letterId',
  },
}));

vi.mock('../../dto/index.js', () => ({
  transformLetterToDTO: vi.fn((letter: { id: string }) => ({ id: letter.id })),
  transformLetterWithRelatedToDTO: vi.fn(),
}));

import { queryAdminLetters } from '../letter-queries.js';

describe('queryAdminLetters extra-content filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeMock
      .mockResolvedValueOnce([{
        total: 3,
        extra_content_empty: 1,
        extra_content_ai_draft: 0,
        extra_content_edited: 1,
        extra_content_verified: 0,
      }])
      .mockResolvedValueOnce([{ count: 0 }])
      .mockResolvedValueOnce([]);
  });

  it('counts extra-content status only for groups that have extra item pages', async () => {
    const result = await queryAdminLetters({
      page: 1,
      limit: 50,
      sort: 'createdAt',
      sortOrder: 'desc',
    });

    const statsSql = renderSql(executeMock.mock.calls[0]?.[0]);

    expect(statsSql).toContain('INNER JOIN letter_pages extra_page ON extra_page.letter_id = extra.id');
    expect(statsSql).toContain("COUNT(*) FILTER (WHERE has_extras AND extra_content_status = 'EMPTY')");
    expect(statsSql).toContain("COUNT(*) FILTER (WHERE has_extras AND extra_content_status = 'EDITED')");
    expect(result.stats.extraContent).toEqual({
      empty: 1,
      aiDraft: 0,
      edited: 1,
      verified: 0,
    });
  });

  it('requires extra item pages when filtering by extra-content status', async () => {
    await queryAdminLetters({
      page: 1,
      limit: 50,
      sort: 'createdAt',
      sortOrder: 'desc',
      extraContentStatus: ['EDITED'],
    });

    const countSql = renderSql(executeMock.mock.calls[1]?.[0]);
    const representativeSql = renderSql(executeMock.mock.calls[2]?.[0]);

    expect(countSql).toContain('has_extras = true AND extra_content_status = ANY');
    expect(representativeSql).toContain('has_extras = true AND extra_content_status = ANY');
  });

  it('casts workflow filters to the database workflow enum', async () => {
    await queryAdminLetters({
      page: 1,
      limit: 50,
      sort: 'createdAt',
      sortOrder: 'desc',
      workflow: ['UPLOADED', 'REVIEWED'],
    });

    const countSql = renderSql(executeMock.mock.calls[1]?.[0]);
    const representativeSql = renderSql(executeMock.mock.calls[2]?.[0]);

    expect(countSql).toContain('workflow = ANY');
    expect(countSql).toContain('::workflow_state[]');
    expect(representativeSql).toContain('::workflow_state[]');
    expect(countSql).not.toContain('::text[]');
  });
});
