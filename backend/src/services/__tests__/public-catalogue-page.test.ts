import { expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { letters } from '../../db/index.js';
import { cataloguePageSql, getPublicCataloguePage } from '../public-catalogue-page.js';
import { publicLetterQuerySchema } from '../../schemas/letter.js';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('../../db/index.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../db/index.js')>(), db: { execute },
}));
const dialect = new PgDialect();
const conditions = [eq(letters.visibility, 'PUBLISHED')];

it('selects and counts published roots before bounded content hydration', () => {
  const query = dialect.sqlToQuery(cataloguePageSql(conditions, publicLetterQuerySchema.parse({ page: 3, limit: 20, sort: 'sender' })));
  expect(query.sql).toContain('DISTINCT ON (collection_id, date_raw, type_sequence)');
  expect(query.sql).toContain('CASE WHEN metadata_published THEN sender ELSE NULL END');
  expect(query.sql).toContain('COUNT(*)::int FROM roots');
  expect(query.sql).toMatch(/LIMIT \$\d+ OFFSET \$\d+/);
  expect(query.params).toContain('PUBLISHED');
  expect(query.params.slice(-2)).toEqual([20, 40]);
});

it('constrains companion loading to the selected complete unit identity', async () => {
  execute.mockResolvedValueOnce([{ total: 99, units: [{ collectionId: 'collection-a', dateRaw: '1947XXXX', typeSequence: 2 }] }]);
  const page = await getPublicCataloguePage(conditions, publicLetterQuerySchema.parse({}));
  expect(page.total).toBe(99);
  expect(dialect.sqlToQuery(page.where!).params).toEqual(['PUBLISHED', 'collection-a', '1947XXXX', 2]);
});

it('retains the count and cannot load all rows for an empty page', async () => {
  execute.mockResolvedValueOnce([{ total: 99, units: [] }]);
  const page = await getPublicCataloguePage(conditions, publicLetterQuerySchema.parse({ page: 100 }));
  expect(page.total).toBe(99);
  expect(page.units).toEqual([]);
  expect(dialect.sqlToQuery(page.where!).sql).toBe('FALSE');
});
