import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  publicCatalogueChronologySql,
  PUBLIC_CATALOGUE_LETTER_TYPES,
  isPhotoOnlyCatalogueUnit,
  isPublicCatalogueLetterType,
  publicCatalogueLetterTypeSql,
  publicCatalogueRepresentativeOrderSql,
  retainPublicCatalogueRepresentatives,
  retainRowsWithPublicCatalogueRoot,
  selectPublicCatalogueRepresentative,
} from '../public-catalogue-unit.js';

describe('public catalogue units', () => {
  it('uses normalized partial dates and complete unit identity in both directions', () => {
    const dialect = new PgDialect();
    for (const descending of [false, true]) {
      const query = dialect.sqlToQuery(publicCatalogueChronologySql(
        sql.raw('date_raw'), sql.raw('collection_id'), sql.raw('type_sequence'), descending,
      ));
      const direction = descending ? 'DESC' : 'ASC';
      expect(query.sql).toBe(`REPLACE(UPPER(date_raw), 'X', '0') ${direction}, date_raw ${direction}, collection_id ${direction}, type_sequence ${direction}`);
    }
  });

  it('keeps positive catalogue roots and companions from the same unit only', () => {
    const rows = [
      { id: 'root', collectionId: '009', dateRaw: '19470810', typeSequence: '01', type: 'L' },
      { id: 'cover', collectionId: '009', dateRaw: '19470810', typeSequence: '01', type: 'C' },
      { id: 'orphan-date', collectionId: '009', dateRaw: '19470811', typeSequence: '01', type: 'C' },
      { id: 'orphan-sequence', collectionId: '009', dateRaw: '19470810', typeSequence: '02', type: 'N' },
      { id: 'orphan-collection', collectionId: '010', dateRaw: '19470810', typeSequence: '01', type: 'T' },
      { id: 'photo-root', collectionId: '010', dateRaw: '19470812', typeSequence: '01', type: 'P' },
    ];

    expect(retainRowsWithPublicCatalogueRoot(rows).map((row) => row.id)).toEqual([
      'root',
      'cover',
      'photo-root',
    ]);
  });

  it('defines catalogue roots positively', () => {
    expect(['L', 'P', 'V', 'A', 'D'].every(isPublicCatalogueLetterType)).toBe(true);
    expect(['C', 'T', 'E', 'N', 'unknown'].some(isPublicCatalogueLetterType)).toBe(false);
  });

  it('defines photo-only units from rows, including rows without pages', () => {
    expect(isPhotoOnlyCatalogueUnit([{ type: 'P' }, { type: 'P' }])).toBe(true);
    expect(isPhotoOnlyCatalogueUnit([{ type: 'P' }, { type: 'C' }])).toBe(false);
    expect(isPhotoOnlyCatalogueUnit([])).toBe(false);
  });

  it('renders the canonical types as a PostgreSQL array for filtering and ordering', () => {
    const dialect = new PgDialect();
    const filter = dialect.sqlToQuery(publicCatalogueLetterTypeSql(sql.raw('letter_type')));
    const order = dialect.sqlToQuery(publicCatalogueRepresentativeOrderSql(sql.raw('letter_type')));

    expect(filter.sql).toBe('letter_type = ANY(ARRAY[$1, $2, $3, $4, $5]::letter_type[])');
    expect(order.sql).toBe(
      'array_position(ARRAY[$1, $2, $3, $4, $5]::letter_type[], letter_type)',
    );
    expect(filter.params).toEqual(PUBLIC_CATALOGUE_LETTER_TYPES);
    expect(order.params).toEqual(PUBLIC_CATALOGUE_LETTER_TYPES);
  });

  it('selects one stable representative using the canonical root priority', () => {
    const rows = [
      { id: 'diary', type: 'D' },
      { id: 'voice', type: 'V' },
      { id: 'photo', type: 'P' },
      { id: 'letter-z', type: 'L' },
      { id: 'letter-a', type: 'L' },
      { id: 'cover', type: 'C' },
    ];

    expect(selectPublicCatalogueRepresentative(rows)?.id).toBe('letter-a');
  });

  it('collapses each catalogue unit without changing unit order', () => {
    const rows = [
      { id: 'photo-first', collectionId: '009', dateRaw: '19470810', typeSequence: 1, type: 'P' },
      { id: 'letter-first', collectionId: '009', dateRaw: '19470810', typeSequence: 1, type: 'L' },
      { id: 'diary-second', collectionId: '009', dateRaw: '19470811', typeSequence: 1, type: 'D' },
      { id: 'article-second', collectionId: '009', dateRaw: '19470811', typeSequence: 1, type: 'A' },
      { id: 'cover', collectionId: '009', dateRaw: '19470812', typeSequence: 1, type: 'C' },
    ];

    expect(retainPublicCatalogueRepresentatives(rows).map((row) => row.id)).toEqual([
      'letter-first',
      'article-second',
    ]);
  });
});
