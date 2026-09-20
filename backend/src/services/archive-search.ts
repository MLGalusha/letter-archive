import { ilike, or } from 'drizzle-orm';
import { db, collections } from '../db/index.js';
import type { ArchiveSearchQuery } from '../schemas/letter.js';
import { getRows } from './letter-queries.js';
import { archiveSearchTerms, canFuzzyMatchArchiveTerm } from './archive-search-matching.js';
import { buildArchiveSearchCtes, buildArchiveSearchFacetsQuery, buildArchiveSearchOrderBy, buildArchiveSearchRowsQuery } from './archive-search-query.js';
import { transformArchiveSearchRow } from './archive-search-preview.js';
import type { ArchiveSearchRow } from './archive-search-shared.js';

type ArchiveFacetValue = {
  value: string;
  count: number;
};

type ArchiveFormatFacet = ArchiveFacetValue & {
  label: string;
};

type ArchiveCollectionFacet = ArchiveFacetValue & {
  label: string;
};

type ArchiveYearFacet = {
  value: number;
  count: number;
};

type ArchiveLabeledFacetRow = {
  value: string;
  label: string;
  count: number | string | bigint;
};

type ArchiveFacetRow = {
  value: string | number | null;
  count: number | string | bigint;
};

const ARCHIVE_FORMAT_LABELS = {
  letter: 'Letters',
  photo: 'Photos',
  ephemera: 'Ephemera',
  voice: 'Voice',
  article: 'Articles',
  diary: 'Diary',
  cover: 'Covers',
  card: 'Cards',
  telegram: 'Telegrams',
} as const;

export async function searchArchiveSummaries(query: ArchiveSearchQuery) {
  const collectionIds = await resolveArchiveCollectionIds(query.collection);
  if (query.collection && collectionIds.length === 0) {
    return emptyArchiveSearchResponse(query.page, query.limit);
  }

  const ctes = buildArchiveSearchCtes(query, collectionIds);
  const orderBy = buildArchiveSearchOrderBy(query);
  const offset = (query.page - 1) * query.limit;
  const fuzzyTerms = query.exact ? [] : archiveSearchTerms(query.search || '').filter(canFuzzyMatchArchiveTerm);

  // Run main rows query and combined facets query in parallel (2 queries instead of 9)
  // This evaluates the expensive CTE only twice instead of 9 times
  const [rowsResult, facetsResult] = await Promise.all([
    db.execute(buildArchiveSearchRowsQuery(query, ctes, orderBy, offset, fuzzyTerms)),
    // Combined facets query — evaluates the CTE once for all 8 facets
    db.execute(buildArchiveSearchFacetsQuery(ctes)),
  ]);

  // The singleton aggregate preserves the row statement's snapshot even on an
  // empty page. Its LEFT JOIN placeholder is not an archive result.
  type CountedArchiveRow = ArchiveSearchRow & { totalCount: number | string | bigint };
  const countedRows = getRows<CountedArchiveRow | { id: null; totalCount: number | string | bigint }>(rowsResult);
  const total = Number(countedRows[0]?.totalCount ?? 0);
  const rows = countedRows.filter((row): row is CountedArchiveRow => row.id !== null);

  // Split combined facets result by facet type
  type FacetRow = { facet: string; value: string | number | null; label: string | null; count: number | string | bigint };
  const allFacets = getRows<FacetRow>(facetsResult);
  const facetsByType = new Map<string, FacetRow[]>();
  for (const row of allFacets) {
    const list = facetsByType.get(row.facet) || [];
    list.push(row);
    facetsByType.set(row.facet, list);
  }

  const facetLimits: Record<string, number> = { collections: 8, correspondents: 8, senders: 8, recipients: 8, places: 8, years: 8, topics: 50 };
  const truncated = Object.entries(facetLimits)
    .filter(([facet, limit]) => (facetsByType.get(facet)?.length ?? 0) > limit)
    .map(([facet]) => facet);
  for (const [facet, limit] of Object.entries(facetLimits)) {
    facetsByType.set(facet, (facetsByType.get(facet) || []).slice(0, limit));
  }

  return {
    letters: rows.map((row) => transformArchiveSearchRow(row, query)),
    page: query.page,
    limit: query.limit,
    total,
    facets: {
      formats: completeArchiveFormatFacets(facetsByType.get('formats') || []),
      senders: mapArchiveTextFacets(facetsByType.get('senders') || []),
      recipients: mapArchiveTextFacets(facetsByType.get('recipients') || []),
      truncated,
      collections: mapArchiveCollectionFacets((facetsByType.get('collections') || []) as unknown as ArchiveLabeledFacetRow[]),
      correspondents: mapArchiveTextFacets(facetsByType.get('correspondents') || []),
      places: mapArchiveTextFacets(facetsByType.get('places') || []),
      years: mapArchiveYearFacets(facetsByType.get('years') || []),
      topics: mapArchiveTextFacets(facetsByType.get('topics') || []),
      tones: mapArchiveTextFacets(facetsByType.get('tones') || []),
      relationships: mapArchiveTextFacets(facetsByType.get('relationships') || []),
    },
  };
}

async function resolveArchiveCollectionIds(collectionQuery?: string) {
  if (!collectionQuery) return [];

  const escapedCollection = collectionQuery.replace(/%/g, '\\%').replace(/_/g, '\\_');
  const matchingCollections = await db.query.collections.findMany({
    where: or(
      ilike(collections.collectionCode, `%${escapedCollection}%`),
      ilike(collections.title, `%${escapedCollection}%`),
    ),
    columns: { id: true, collectionCode: true },
  });

  // A complete unique code identifies one collection; other text keeps the
  // existing partial code/title lookup used by the free-entry field.
  const exactCode = matchingCollections.find((collection) => collection.collectionCode === collectionQuery);
  return exactCode ? [exactCode.id] : matchingCollections.map((collection) => collection.id);
}

function emptyArchiveSearchResponse(page: number, limit: number) {
  return {
    letters: [],
    page,
    limit,
    total: 0,
    facets: {
      formats: completeArchiveFormatFacets([]),
      senders: [] as ArchiveFacetValue[],
      recipients: [] as ArchiveFacetValue[],
      truncated: [] as string[],
      collections: [] as ArchiveCollectionFacet[],
      correspondents: [] as ArchiveFacetValue[],
      places: [] as ArchiveFacetValue[],
      years: [] as ArchiveYearFacet[],
      topics: [] as ArchiveFacetValue[],
      tones: [] as ArchiveFacetValue[],
      relationships: [] as ArchiveFacetValue[],
    },
  };
}

function completeArchiveFormatFacets(rows: ArchiveFacetRow[]): ArchiveFormatFacet[] {
  const counts = new Map(mapArchiveFormatFacets(rows).map((facet) => [facet.value, facet.count]));
  return Object.entries(ARCHIVE_FORMAT_LABELS).map(([value, label]) => ({
    value, label, count: counts.get(value) ?? 0,
  }));
}

function mapArchiveFormatFacets(rows: ArchiveFacetRow[]): ArchiveFormatFacet[] {
  const facets: ArchiveFormatFacet[] = [];

  for (const row of rows) {
    const value = typeof row.value === 'string' ? row.value : null;
    if (!value || !(value in ARCHIVE_FORMAT_LABELS)) continue;
    facets.push({
      value,
      label: ARCHIVE_FORMAT_LABELS[value as keyof typeof ARCHIVE_FORMAT_LABELS],
      count: Number(row.count || 0),
    });
  }

  return facets;
}

function mapArchiveCollectionFacets(rows: ArchiveLabeledFacetRow[]): ArchiveCollectionFacet[] {
  return rows
    .map((row) => {
      if (typeof row.value !== 'string' || row.value.trim().length === 0) return null;
      const label = typeof row.label === 'string' && row.label.trim().length > 0
        ? row.label
        : row.value;

      return {
        value: row.value,
        label,
        count: Number(row.count || 0),
      };
    })
    .filter((row): row is ArchiveCollectionFacet => row !== null);
}

function mapArchiveTextFacets(rows: ArchiveFacetRow[]): ArchiveFacetValue[] {
  return rows
    .map((row) => {
      if (typeof row.value !== 'string' || row.value.trim().length === 0) return null;
      return {
        value: row.value,
        count: Number(row.count || 0),
      };
    })
    .filter((row): row is ArchiveFacetValue => row !== null);
}

function mapArchiveYearFacets(rows: ArchiveFacetRow[]): ArchiveYearFacet[] {
  return rows
    .map((row) => {
      const value = Number(row.value);
      if (!Number.isFinite(value)) return null;
      return {
        value,
        count: Number(row.count || 0),
      };
    })
    .filter((row): row is ArchiveYearFacet => row !== null);
}
