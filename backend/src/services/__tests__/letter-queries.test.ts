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

import { adminLettersQuerySchema, queryAdminLetters } from '../letter-queries.js';

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

  it('counts visibility stats from any matching row in a grouped letter', async () => {
    await queryAdminLetters({
      page: 1,
      limit: 50,
      sort: 'createdAt',
      sortOrder: 'desc',
    });

    const statsSql = renderSql(executeMock.mock.calls[0]?.[0]);

    expect(statsSql).toContain('visibility_item.visibility = PUBLISHED');
    expect(statsSql).toContain('visibility_item.visibility = HIDDEN');
    expect(statsSql).toContain('COUNT(*) FILTER (WHERE has_published) as published');
    expect(statsSql).toContain('COUNT(*) FILTER (WHERE has_hidden) as hidden');
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

  it('filters workflow after representative rows are selected', async () => {
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
    expect(countSql).toContain(') representatives');
    expect(countSql.indexOf(') representatives')).toBeLessThan(countSql.indexOf('workflow = ANY'));
    expect(representativeSql.indexOf(') representatives')).toBeLessThan(representativeSql.indexOf('workflow = ANY'));
  });

  it('filters representative rows by missing cleanup fields', async () => {
    await queryAdminLetters({
      page: 1,
      limit: 50,
      sort: 'createdAt',
      sortOrder: 'desc',
      missing: ['sender', 'date'],
    });

    const countSql = renderSql(executeMock.mock.calls[1]?.[0]);
    const representativeSql = renderSql(executeMock.mock.calls[2]?.[0]);

    expect(countSql).toContain("sender IS NULL OR BTRIM(sender) = ''");
    expect(countSql).toContain('letter_date IS NULL');
    expect(representativeSql).toContain("sender IS NULL OR BTRIM(sender) = ''");
    expect(representativeSql).toContain('letter_date IS NULL');
  });

  it('filters representative rows by actual content-shape existence', async () => {
    await queryAdminLetters({
      page: 1,
      limit: 50,
      sort: 'createdAt',
      sortOrder: 'desc',
      contentShape: ['photos', 'telegram', 'card'],
    });

    const statsSql = renderSql(executeMock.mock.calls[0]?.[0]);
    const countSql = renderSql(executeMock.mock.calls[1]?.[0]);
    const representativeSql = renderSql(executeMock.mock.calls[2]?.[0]);

    expect(statsSql).toContain('has_photos_count');
    expect(statsSql).toContain('has_telegram_count');
    expect(statsSql).toContain('has_card_count');
    expect(countSql).toContain('has_photos = true');
    expect(countSql).toContain('has_telegram = true');
    expect(countSql).toContain('has_card = true');
    expect(representativeSql).toContain('has_photos = true');
    expect(representativeSql).toContain('has_telegram = true');
    expect(representativeSql).toContain('has_card = true');
  });

  it('orders representative ids with ordered backend sort rules before pagination', async () => {
    await queryAdminLetters({
      page: 2,
      limit: 25,
      sort: 'createdAt',
      sortOrder: 'desc',
      sortRules: [
        { field: 'telegram', direction: 'desc' },
        { field: 'sender', direction: 'asc' },
      ],
    });

    const representativeSql = renderSql(executeMock.mock.calls[2]?.[0]);

    expect(representativeSql).toContain('count_item.collection_id = filtered.collection_id');
    expect(representativeSql).toContain('::letter_type[]');
    expect(representativeSql).toContain('T');
    expect(representativeSql).toContain('filtered.sender ASC NULLS LAST');
    expect(representativeSql).toContain('filtered.id ASC');
    expect(representativeSql).toContain('LIMIT 25');
    expect(representativeSql).toContain('OFFSET 25');
  });

  it('resolves multiple collection codes into one collection-id filter', async () => {
    findCollectionsMock.mockResolvedValueOnce([{ id: 'collection-003' }, { id: 'collection-009' }]);

    await queryAdminLetters({
      page: 1,
      limit: 50,
      sort: 'createdAt',
      sortOrder: 'desc',
      collection: ['003', '009'],
    });

    expect(findCollectionsMock).toHaveBeenCalledWith({
      where: {
        clauses: [
          { field: 'collections.collectionCode', value: '%003' },
          { field: 'collections.collectionCode', value: '%009' },
        ],
      },
    });

    const statsSql = renderSql(executeMock.mock.calls[0]?.[0]);
    const countSql = renderSql(executeMock.mock.calls[1]?.[0]);
    const representativeSql = renderSql(executeMock.mock.calls[2]?.[0]);

    expect(statsSql).toContain('collection-003');
    expect(statsSql).toContain('collection-009');
    expect(countSql).toContain('collection-003');
    expect(countSql).toContain('collection-009');
    expect(representativeSql).toContain('collection-003');
    expect(representativeSql).toContain('collection-009');
  });

  it('parses comma-separated collection codes from the admin query string', () => {
    const query = adminLettersQuerySchema.parse({
      collection: '003,009',
    });

    expect(query.collection).toEqual(['003', '009']);
  });
});
