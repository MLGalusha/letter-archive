import { Router } from 'express';
import { eq, and, or, inArray, ilike, asc, desc, sql } from 'drizzle-orm';
import { db, letters, collections, letterPages, type LetterType } from '../db/index.js';
import { archiveSearchQuerySchema, letterQuerySchema, type ArchiveSearchQuery } from '../schemas/letter.js';
import {
  formatLetterDate,
  formatPartialDate,
  generateTitle,
  mapTypeToImageType,
  transformLetterToDTO,
  transformLettersToDTO,
  transformLetterWithRelatedToDTO,
  transformLettersWithRelatedToDTO,
  type LetterWithRelations,
} from '../dto/index.js';
import { getRows } from '../services/letter-queries.js';
import { logIfSlow, TIMING_THRESHOLDS } from '../utils/logger.js';

const router = Router();

const MEDIA_COUNT_LABELS = {
  letter: ['page', 'pages'],
  photo: ['photo', 'photos'],
  ephemera: ['piece', 'pieces'],
  voice: ['recording', 'recordings'],
  article: ['article', 'articles'],
  diary: ['page', 'pages'],
  cover: ['cover', 'covers'],
  card: ['card', 'cards'],
  telegram: ['telegram', 'telegrams'],
} as const;

type SummaryLetterWithRelations = {
  id: string;
  collectionId: string;
  dateRaw: string;
  createdAt: Date | string;
  typeSequence: number;
  type: LetterWithRelations['type'];
  workflow: LetterWithRelations['workflow'];
  visibility: LetterWithRelations['visibility'];
  sender: string | null;
  recipient: string | null;
  locationWritten: string | null;
  hook: string | null;
  summary: string | null;
  transcriptionText: string | null;
  extraContentTranscript: string | null;
  photoDescription: string | null;
  metadataContentStatus: LetterWithRelations['metadataContentStatus'];
  collection: {
    title: string | null;
    collectionCode: string;
  };
  pages: Array<{
    id: string;
    pageNumber: number;
    checksumSha256: string | null;
  }>;
};

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

type ArchiveSearchRow = {
  id: string;
  collectionId: string;
  collectionCode: string;
  collectionTitle: string | null;
  dateRaw: string;
  createdAt: Date | string;
  primaryType: LetterWithRelations['type'];
  primaryPageCount: number;
  sender: string | null;
  recipient: string | null;
  location: string | null;
  hook: string | null;
  metadataVerified: boolean;
  pageId: string | null;
  checksumSha256: string | null;
  formats: string[] | null;
  senders: string[] | null;
  recipients: string[] | null;
  places: string[] | null;
  hooks: string[] | null;
  summaries: string[] | null;
  topics: string[] | null;
  tones: string[] | null;
  relationships: string[] | null;
  photoDescriptions: string[] | null;
  extraContentTranscripts: string[] | null;
  transcriptionTexts: string[] | null;
};

type ArchiveFacetRow = {
  value: string | number | null;
  count: number | string | bigint;
};

type ArchiveSearchHighlightRange = {
  start: number;
  end: number;
};

type ArchiveSearchPreview = {
  excerpt: string;
  matchCount: number;
  highlightRanges: ArchiveSearchHighlightRange[];
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

/**
 * GET /letters - List letters with optional filtering
 *
 * IMPORTANT: Workflow filter is applied to the PRIMARY of each group, not to
 * individual letter records. This ensures that filtering to "UPLOADED" doesn't
 * show a C-type cover when its L-type letter is already TRANSCRIBED.
 */
router.get('/letters', async (req, res, next) => {
  const start = Date.now();
  try {
    const query = letterQuerySchema.parse(req.query);

    req.log.debug(
      { collection: query.collection, visibility: query.visibility, workflow: query.workflow, page: query.page },
      'Letters list query'
    );

    // Build conditions WITHOUT workflow filter (applied after grouping)
    const conditions = [];

    // Filter by collection code - supports partial matching (e.g., "7" matches "007")
    if (query.collection) {
      const escapedCollection = query.collection.replace(/%/g, '\\%').replace(/_/g, '\\_');
      const matchingCollections = await db.query.collections.findMany({
        where: ilike(collections.collectionCode, `%${escapedCollection}`),
      });
      if (matchingCollections.length > 0) {
        conditions.push(inArray(letters.collectionId, matchingCollections.map(c => c.id)));
      } else {
        // Collection not found, return empty results
        res.json({ letters: [], page: query.page, limit: query.limit, total: 0 });
        return;
      }
    }

    // Filter by visibility (can apply directly since all types share visibility)
    if (query.visibility) {
      conditions.push(eq(letters.visibility, query.visibility));
    }

    // NOTE: workflow filter NOT applied here - applied after grouping below

    // Determine sort column and order
    // For date sorting, use dateRaw with X replaced by 0
    // This makes unknown dates sort at the start of their range:
    // 18XXXXXX → 18000000, so "1800s" comes before "1801"
    const sortFn = query.sortOrder === 'asc' ? asc : desc;
    const getSortExpression = () => {
      switch (query.sort) {
        case 'letterDate':
          // Replace X with 0 so unknown parts sort at the beginning of their range
          return sql`REPLACE(${letters.dateRaw}, 'X', '0')`;
        case 'sender':
          return letters.sender;
        case 'workflow':
          return letters.workflow;
        case 'visibility':
          return letters.visibility;
        case 'createdAt':
        default:
          return letters.createdAt;
      }
    };

    // Fetch all letters (no workflow filter yet) - we need all types to determine primary
    // Note: We fetch more than limit to account for filtering after grouping
    const results = await db.query.letters.findMany({
      where: and(...conditions),
      with: {
        collection: true,
        pages: {
          orderBy: (p, { asc: pageAsc }) => [pageAsc(p.pageNumber)],
        },
      },
      orderBy: [sortFn(getSortExpression())],
    });

    // Group letters by (collectionId, dateRaw, typeSequence) — all types on the
    // same date merge into one group so covers/telegrams don't appear as separate entries
    const allResults = results as LetterWithRelations[];

    const groupMap = new Map<string, LetterWithRelations[]>();
    for (const letter of allResults) {
      const key = `${letter.collectionId}:${letter.dateRaw}:${letter.typeSequence}`;
      const group = groupMap.get(key) || [];
      group.push(letter);
      groupMap.set(key, group);
    }

    // Select primaries: prefer L-type, then first by type alphabetically
    const filteredResults: LetterWithRelations[] = [];
    for (const [_key, group] of groupMap) {
      const primary = group.find((l) => l.type === 'L') || group[0];

      // Apply workflow filter to PRIMARY's workflow state
      if (query.workflow && primary.workflow !== query.workflow) {
        continue; // Skip entire group if primary doesn't match workflow filter
      }

      filteredResults.push(primary);
    }

    // Apply pagination after filtering
    const paginatedResults = filteredResults.slice(
      (query.page - 1) * query.limit,
      query.page * query.limit
    );

    // Enrich primary letters with related content from the already-loaded groupMap
    const enrichedResults = paginatedResults.map((letter) => {
      const key = `${letter.collectionId}:${letter.dateRaw}:${letter.typeSequence}`;
      const group = groupMap.get(key) || [];
      const relatedItems = group.filter((l) => l.id !== letter.id);
      return { letter, relatedItems };
    });

    // Transform to frontend-compatible format with related items
    const transformedLetters = transformLettersWithRelatedToDTO(enrichedResults);

    const duration = Date.now() - start;
    req.log.info(
      { resultCount: transformedLetters.length, totalGroups: filteredResults.length, page: query.page, duration },
      'Letters list completed'
    );
    logIfSlow(req.log, 'letters list query', duration, TIMING_THRESHOLDS.DB_QUERY);

    res.json({
      letters: transformedLetters,
      page: query.page,
      limit: query.limit,
      total: filteredResults.length,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/letters/summaries', async (req, res, next) => {
  const start = Date.now();
  try {
    const query = letterQuerySchema.parse(req.query);
    const conditions = [];

    if (query.collection) {
      const escapedCollection = query.collection.replace(/%/g, '\\%').replace(/_/g, '\\_');
      const matchingCollections = await db.query.collections.findMany({
        where: ilike(collections.collectionCode, `%${escapedCollection}`),
      });
      if (matchingCollections.length > 0) {
        conditions.push(inArray(letters.collectionId, matchingCollections.map((collection) => collection.id)));
      } else {
        res.json({ letters: [], page: query.page, limit: query.limit, total: 0 });
        return;
      }
    }

    if (query.visibility) {
      conditions.push(eq(letters.visibility, query.visibility));
    }

    const sortFn = query.sortOrder === 'asc' ? asc : desc;
    const getSortExpression = () => {
      switch (query.sort) {
        case 'letterDate':
          return sql`REPLACE(${letters.dateRaw}, 'X', '0')`;
        case 'sender':
          return letters.sender;
        case 'workflow':
          return letters.workflow;
        case 'visibility':
          return letters.visibility;
        case 'createdAt':
        default:
          return letters.createdAt;
      }
    };

    const results = await db.query.letters.findMany({
      where: and(...conditions),
      columns: {
        id: true,
        collectionId: true,
        dateRaw: true,
        createdAt: true,
        typeSequence: true,
        type: true,
        workflow: true,
        visibility: true,
        sender: true,
        recipient: true,
        locationWritten: true,
        hook: true,
        summary: true,
        transcriptionText: true,
        extraContentTranscript: true,
        photoDescription: true,
        metadataContentStatus: true,
      },
      with: {
        collection: {
          columns: {
            title: true,
            collectionCode: true,
          },
        },
        pages: {
          columns: {
            id: true,
            pageNumber: true,
            checksumSha256: true,
          },
          orderBy: (page, { asc: pageAsc }) => [pageAsc(page.pageNumber)],
        },
      },
      orderBy: [sortFn(getSortExpression())],
    });

    const allResults = results as SummaryLetterWithRelations[];
    const groupMap = new Map<string, SummaryLetterWithRelations[]>();
    for (const letter of allResults) {
      const key = `${letter.collectionId}:${letter.dateRaw}:${letter.type}${letter.typeSequence}`;
      const group = groupMap.get(key) || [];
      group.push(letter);
      groupMap.set(key, group);
    }

    const filteredResults: SummaryLetterWithRelations[] = [];
    for (const [, group] of groupMap) {
      const primary = group[0];

      if (query.workflow && primary.workflow !== query.workflow) {
        continue;
      }

      filteredResults.push(primary);
    }

    const paginatedResults = filteredResults.slice(
      (query.page - 1) * query.limit,
      query.page * query.limit,
    );

    const transformedLetters = paginatedResults.map((letter) => {
      const key = `${letter.collectionId}:${letter.dateRaw}:${letter.type}${letter.typeSequence}`;
      const group = groupMap.get(key) || [];
      return transformLetterSummary(letter, group.filter((item) => item.id !== letter.id));
    });

    const duration = Date.now() - start;
    req.log.info(
      { resultCount: transformedLetters.length, totalGroups: filteredResults.length, page: query.page, duration },
      'Letters summary query completed',
    );
    logIfSlow(req.log, 'letters summary query', duration, TIMING_THRESHOLDS.DB_QUERY);

    res.json({
      letters: transformedLetters,
      page: query.page,
      limit: query.limit,
      total: filteredResults.length,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/letters/search', async (req, res, next) => {
  const start = Date.now();
  try {
    const query = archiveSearchQuerySchema.parse(req.query);
    const response = await searchArchiveSummaries(query);
    const duration = Date.now() - start;

    req.log.info(
      {
        search: query.search,
        collection: query.collection,
        total: response.total,
        page: response.page,
        duration,
      },
      'Archive search completed',
    );
    logIfSlow(req.log, 'archive search query', duration, TIMING_THRESHOLDS.DB_QUERY);

    res.json(response);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /letters/:letterId - Get a single letter with pages
 * Also fetches related cards (C) and extras (E) for the same date/sequence
 */
router.get('/letters/:letterId', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    req.log.debug({ letterId }, 'Fetching letter');

    const letter = await db.query.letters.findFirst({
      where: and(
        eq(letters.id, letterId),

        eq(letters.visibility, 'PUBLISHED')
      ),
      with: {
        collection: true,
        pages: {
          orderBy: (p, { asc }) => [asc(p.pageNumber)],
        },
      },
    });

    if (!letter) {
      req.log.debug({ letterId }, 'Letter not found or not published');
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    // Fetch related items (all other types with same date/sequence)
    const related = await db.query.letters.findMany({
      where: and(
        eq(letters.collectionId, letter.collectionId),
        eq(letters.dateRaw, letter.dateRaw),
        eq(letters.typeSequence, letter.typeSequence),
        sql`${letters.type} != ${letter.type}`, // Exclude the current letter's type
        eq(letters.visibility, 'PUBLISHED'),
      ),
      with: {
        collection: true,
        pages: {
          orderBy: (p, { asc }) => [asc(p.pageNumber)],
        },
      },
      orderBy: (l, { asc }) => [asc(l.type)], // Alphabetical by type
    });
    const relatedItems = related as LetterWithRelations[];

    // Transform to frontend-compatible format, including related items
    res.json(transformLetterWithRelatedToDTO(letter as LetterWithRelations, relatedItems));
  } catch (error) {
    next(error);
  }
});

/**
 * GET /letters/:letterId/adjacent - Get prev/next letters in the same collection
 * Returns adjacent letter previews and the current position within the collection
 */
router.get('/letters/:letterId/adjacent', async (req, res, next) => {
  try {
    const { letterId } = req.params;

    // Find the current letter with its collection info
    const letter = await db.query.letters.findFirst({
      where: and(
        eq(letters.id, letterId),
        eq(letters.visibility, 'PUBLISHED')
      ),
      columns: {
        id: true,
        collectionId: true,
        dateRaw: true,
        createdAt: true,
      },
      with: {
        collection: {
          columns: {
            collectionCode: true,
            title: true,
          },
        },
      },
    });

    if (!letter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    // All published records in the collection, ordered by date
    const allCollectionLetters = await db.query.letters.findMany({
      where: and(
        eq(letters.collectionId, letter.collectionId),
        eq(letters.visibility, 'PUBLISHED'),
      ),
      columns: {
        id: true,
        dateRaw: true,
        type: true,
        typeSequence: true,
        createdAt: true,
        sender: true,
        recipient: true,
        hook: true,
      },
      with: {
        pages: { columns: { id: true } },
      },
      orderBy: [asc(letters.dateRaw), asc(letters.createdAt)],
    });

    // Deduplicate: group by (dateRaw, typeSequence), prefer L-type as the
    // navigable entry so companion covers/telegrams don't appear separately
    const seen = new Map<string, typeof allCollectionLetters[number]>();
    for (const l of allCollectionLetters) {
      const key = `${l.dateRaw}:${l.typeSequence}`;
      const existing = seen.get(key);
      if (!existing || (l.type === 'L' && existing.type !== 'L')) {
        seen.set(key, l);
      }
    }
    const collectionLetters = [...seen.values()];

    // Find current position — if the current letter is a companion type,
    // it resolves to the same slot as its L-type sibling
    let currentIndex = collectionLetters.findIndex(l => l.id === letterId);
    if (currentIndex === -1) {
      // Current letter is a companion type — find by date instead
      const dateKey = `${letter.dateRaw}`;
      currentIndex = collectionLetters.findIndex(l => l.dateRaw === dateKey);
    }

    // Group all letters by dateRaw:typeSequence for content labels
    const companionGroups = new Map<string, typeof allCollectionLetters>();
    for (const l of allCollectionLetters) {
      const key = `${l.dateRaw}:${l.typeSequence}`;
      const group = companionGroups.get(key) || [];
      group.push(l);
      companionGroups.set(key, group);
    }

    function buildPreview(l: typeof collectionLetters[number]) {
      const key = `${l.dateRaw}:${l.typeSequence}`;
      const companions = companionGroups.get(key) || [l];

      // Build content labels: "3 pages", "1 photo", etc.
      const typeCounts = new Map<string, number>();
      for (const c of companions) {
        const imageType = mapTypeToImageType(c.type as LetterType);
        typeCounts.set(imageType, (typeCounts.get(imageType) || 0) + (c.pages?.length || 0));
      }
      const contentLabels: string[] = [];
      for (const [type, count] of typeCounts) {
        if (count === 0) continue;
        const labels = MEDIA_COUNT_LABELS[type as keyof typeof MEDIA_COUNT_LABELS];
        if (labels) {
          contentLabels.push(`${count} ${count === 1 ? labels[0] : labels[1]}`);
        }
      }

      return {
        id: l.id,
        dateRaw: l.dateRaw,
        date: l.dateRaw ? formatPartialDate(l.dateRaw) : undefined,
        sender: l.sender || undefined,
        recipient: l.recipient || undefined,
        hook: l.hook || undefined,
        contentLabels: contentLabels.length > 0 ? contentLabels : undefined,
      };
    }

    if (currentIndex === -1) {
      // Letter exists but not found in collection list (edge case)
      res.json({
        prev: null,
        next: null,
        position: null,
        total: collectionLetters.length,
        collectionCode: letter.collection.collectionCode,
        collectionTitle: letter.collection.title || null,
      });
      return;
    }

    // Wrap around: first letter's prev = last letter, last letter's next = first letter
    const lastIdx = collectionLetters.length - 1;
    const prevIdx = currentIndex > 0 ? currentIndex - 1 : lastIdx;
    const nextIdx = currentIndex < lastIdx ? currentIndex + 1 : 0;
    const prev = collectionLetters.length > 1 ? buildPreview(collectionLetters[prevIdx]) : null;
    const next = collectionLetters.length > 1 ? buildPreview(collectionLetters[nextIdx]) : null;

    res.json({
      prev,
      next,
      prevWraps: currentIndex === 0,
      nextWraps: currentIndex === lastIdx,
      position: currentIndex + 1,
      total: collectionLetters.length,
      collectionCode: letter.collection.collectionCode,
      collectionTitle: letter.collection.title || null,
    });
  } catch (error) {
    next(error);
  }
});

export default router;

function transformLetterSummary(
  letter: SummaryLetterWithRelations,
  relatedItems: SummaryLetterWithRelations[],
) {
  const primaryType = mapTypeToImageType(letter.type);
  const [singular, plural] = MEDIA_COUNT_LABELS[primaryType];
  const primaryCount = letter.pages.length;
  const primaryPage = letter.pages[0];

  return {
    id: letter.id,
    title: generateTitle(letter as never, letter.collection as never),
    imageUrl: primaryPage
      ? `/images/${primaryPage.id}${primaryPage.checksumSha256 ? `?v=${primaryPage.checksumSha256.slice(0, 8)}` : ''}`
      : undefined,
    imageType: primaryType,
    primaryChip: primaryCount > 0
      ? `${primaryCount} ${primaryCount === 1 ? singular : plural}`
      : undefined,
    sender: letter.sender || undefined,
    recipient: letter.recipient || undefined,
    collectionCode: letter.collection.collectionCode,
    createdAt: toIsoDateString(letter.createdAt),
    date: formatLetterDate(letter as never),
    dateRaw: letter.dateRaw,
    hook: letter.hook || undefined,
    location: letter.locationWritten || undefined,
    verified: letter.metadataContentStatus === 'VERIFIED',
    searchText: buildShelfSearchText(letter, relatedItems),
  };
}

function buildShelfSearchText(
  letter: SummaryLetterWithRelations,
  relatedItems: SummaryLetterWithRelations[],
): string {
  return [
    letter.sender,
    letter.recipient,
    letter.locationWritten,
    letter.hook,
    letter.summary,
    letter.photoDescription,
    letter.extraContentTranscript,
    letter.transcriptionText,
    ...relatedItems.flatMap((item) => [
      item.sender,
      item.recipient,
      item.locationWritten,
      item.hook,
      item.summary,
      item.photoDescription,
      item.extraContentTranscript,
      item.transcriptionText,
    ]),
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ');
}

async function searchArchiveSummaries(query: ArchiveSearchQuery) {
  const collectionIds = await resolveArchiveCollectionIds(query.collection);
  if (query.collection && collectionIds.length === 0) {
    return emptyArchiveSearchResponse(query.page, query.limit);
  }

  const ctes = buildArchiveSearchCtes(query, collectionIds);
  const orderBy = buildArchiveSearchOrderBy(query);
  const offset = (query.page - 1) * query.limit;

  const [
    rowsResult,
    totalResult,
    formatsResult,
    collectionsResult,
    correspondentsResult,
    placesResult,
    yearsResult,
    topicsResult,
    tonesResult,
    relationshipsResult,
  ] =
    await Promise.all([
      db.execute(sql`
        ${ctes}
        , primary_page_counts AS (
          SELECT
            sg."collectionId",
            sg."dateRaw",
            sg."typeSequence",
            COUNT(${letterPages.id})::int AS "primaryPageCount"
          FROM scoped_groups sg
          INNER JOIN letters l
            ON l.collection_id = sg."collectionId"
            AND l.date_raw = sg."dateRaw"
            AND l.type_sequence = sg."typeSequence"
            AND l.type = sg."primaryType"
            AND l.visibility = 'PUBLISHED'
          INNER JOIN letter_pages ON letter_pages.letter_id = l.id
          GROUP BY sg."collectionId", sg."dateRaw", sg."typeSequence"
        )
        , display_pages AS (
          SELECT DISTINCT ON (sg."collectionId", sg."dateRaw", sg."typeSequence")
            sg."collectionId",
            sg."dateRaw",
            sg."typeSequence",
            letter_pages.id AS "pageId",
            letter_pages.checksum_sha256 AS "checksumSha256"
          FROM scoped_groups sg
          INNER JOIN letters l
            ON l.collection_id = sg."collectionId"
            AND l.date_raw = sg."dateRaw"
            AND l.type_sequence = sg."typeSequence"
            AND l.type = sg."primaryType"
            AND l.visibility = 'PUBLISHED'
          INNER JOIN letter_pages ON letter_pages.letter_id = l.id
          ORDER BY
            sg."collectionId",
            sg."dateRaw",
            sg."typeSequence",
            letter_pages.page_number ASC
        )
        SELECT
          sg.id,
          sg."collectionId",
          sg."collectionCode",
          sg."collectionTitle",
          sg."dateRaw",
          sg."createdAt",
          sg."primaryType",
          COALESCE(ppc."primaryPageCount", 0) AS "primaryPageCount",
          sg.sender,
          sg.recipient,
          sg.location,
          sg.hook,
          sg."metadataVerified",
          dp."pageId",
          dp."checksumSha256",
          sg.formats,
          sg.senders,
          sg.recipients,
          sg.places,
          sg.hooks,
          sg.summaries,
          sg.topics,
          sg.tones,
          sg.relationships,
          sg."photoDescriptions",
          sg."extraContentTranscripts",
          sg."transcriptionTexts"
        FROM scoped_groups sg
        LEFT JOIN primary_page_counts ppc
          ON ppc."collectionId" = sg."collectionId"
          AND ppc."dateRaw" = sg."dateRaw"
          AND ppc."typeSequence" = sg."typeSequence"
        LEFT JOIN display_pages dp
          ON dp."collectionId" = sg."collectionId"
          AND dp."dateRaw" = sg."dateRaw"
          AND dp."typeSequence" = sg."typeSequence"
        ORDER BY ${orderBy}
        LIMIT ${query.limit}
        OFFSET ${offset}
      `),
      db.execute(sql`
        ${ctes}
        SELECT COUNT(*)::int AS count
        FROM scoped_groups
      `),
      db.execute(sql`
        ${ctes}
        SELECT format AS value, COUNT(*)::int AS count
        FROM (
          SELECT DISTINCT
            bsg."collectionId",
            bsg."dateRaw",
            bsg."typeSequence",
            UNNEST(bsg.formats) AS format
          FROM base_scoped_groups bsg
        ) grouped_formats
        GROUP BY format
        ORDER BY COUNT(*) DESC, format ASC
        LIMIT 6
      `),
      db.execute(sql`
        ${ctes}
        SELECT
          sg."collectionCode" AS value,
          COALESCE(NULLIF(sg."collectionTitle", ''), sg."collectionCode") AS label,
          COUNT(*)::int AS count
        FROM scoped_groups sg
        GROUP BY sg."collectionCode", sg."collectionTitle"
        ORDER BY COUNT(*) DESC, sg."collectionCode" ASC
        LIMIT 8
      `),
      db.execute(sql`
        ${ctes}
        SELECT value, COUNT(*)::int AS count
        FROM (
          SELECT DISTINCT
            sg."collectionId",
            sg."dateRaw",
            sg."typeSequence",
            person_name AS value
          FROM scoped_groups sg
          CROSS JOIN LATERAL UNNEST(
            COALESCE(sg.senders, ARRAY[]::text[]) || COALESCE(sg.recipients, ARRAY[]::text[])
          ) AS person_name
          WHERE person_name IS NOT NULL AND person_name <> ''
        ) grouped_people
        GROUP BY value
        ORDER BY COUNT(*) DESC, value ASC
        LIMIT 8
      `),
      db.execute(sql`
        ${ctes}
        SELECT value, COUNT(*)::int AS count
        FROM (
          SELECT DISTINCT
            sg."collectionId",
            sg."dateRaw",
            sg."typeSequence",
            place_name AS value
          FROM scoped_groups sg
          CROSS JOIN LATERAL UNNEST(COALESCE(sg.places, ARRAY[]::text[])) AS place_name
          WHERE place_name IS NOT NULL AND place_name <> ''
        ) grouped_places
        GROUP BY value
        ORDER BY COUNT(*) DESC, value ASC
        LIMIT 8
      `),
      db.execute(sql`
        ${ctes}
        SELECT SUBSTRING("dateRaw", 1, 4)::int AS value, COUNT(*)::int AS count
        FROM scoped_groups
        WHERE SUBSTRING("dateRaw", 1, 4) ~ '^[0-9]{4}$'
        GROUP BY SUBSTRING("dateRaw", 1, 4)
        ORDER BY SUBSTRING("dateRaw", 1, 4) DESC
        LIMIT 8
      `),
      db.execute(sql`
        ${ctes}
        SELECT value, COUNT(*)::int AS count
        FROM (
          SELECT DISTINCT
            sg."collectionId",
            sg."dateRaw",
            sg."typeSequence",
            topic_name AS value
          FROM scoped_groups sg
          CROSS JOIN LATERAL UNNEST(COALESCE(sg.topics, ARRAY[]::text[])) AS topic_name
          WHERE topic_name IS NOT NULL AND topic_name <> ''
        ) grouped_topics
        GROUP BY value
        ORDER BY COUNT(*) DESC, value ASC
        LIMIT 10
      `),
      db.execute(sql`
        ${ctes}
        SELECT value, COUNT(*)::int AS count
        FROM (
          SELECT DISTINCT
            sg."collectionId",
            sg."dateRaw",
            sg."typeSequence",
            tone_name AS value
          FROM scoped_groups sg
          CROSS JOIN LATERAL UNNEST(COALESCE(sg.tones, ARRAY[]::text[])) AS tone_name
          WHERE tone_name IS NOT NULL AND tone_name <> ''
        ) grouped_tones
        GROUP BY value
        ORDER BY COUNT(*) DESC, value ASC
        LIMIT 8
      `),
      db.execute(sql`
        ${ctes}
        SELECT value, COUNT(*)::int AS count
        FROM (
          SELECT DISTINCT
            sg."collectionId",
            sg."dateRaw",
            sg."typeSequence",
            relationship_name AS value
          FROM scoped_groups sg
          CROSS JOIN LATERAL UNNEST(COALESCE(sg.relationships, ARRAY[]::text[])) AS relationship_name
          WHERE relationship_name IS NOT NULL AND relationship_name <> ''
        ) grouped_relationships
        GROUP BY value
        ORDER BY COUNT(*) DESC, value ASC
        LIMIT 8
      `),
    ]);

  const rows = getRows<ArchiveSearchRow>(rowsResult);
  const totalRows = getRows<{ count: number | string | bigint }>(totalResult);

  return {
    letters: rows.map((row) => transformArchiveSearchRow(row, query)),
    page: query.page,
    limit: query.limit,
    total: Number(totalRows[0]?.count || 0),
    facets: {
      formats: mapArchiveFormatFacets(getRows<ArchiveFacetRow>(formatsResult)),
      collections: mapArchiveCollectionFacets(getRows<ArchiveLabeledFacetRow>(collectionsResult)),
      correspondents: mapArchiveTextFacets(getRows<ArchiveFacetRow>(correspondentsResult)),
      places: mapArchiveTextFacets(getRows<ArchiveFacetRow>(placesResult)),
      years: mapArchiveYearFacets(getRows<ArchiveFacetRow>(yearsResult)),
      topics: mapArchiveTextFacets(getRows<ArchiveFacetRow>(topicsResult)),
      tones: mapArchiveTextFacets(getRows<ArchiveFacetRow>(tonesResult)),
      relationships: mapArchiveTextFacets(getRows<ArchiveFacetRow>(relationshipsResult)),
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
    columns: { id: true },
  });

  return matchingCollections.map((collection) => collection.id);
}

function emptyArchiveSearchResponse(page: number, limit: number) {
  return {
    letters: [],
    page,
    limit,
    total: 0,
    facets: {
      formats: [] as ArchiveFormatFacet[],
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

function buildArchiveSearchCtes(query: ArchiveSearchQuery, collectionIds: string[]) {
  const rowFilters = [sql`l.visibility = 'PUBLISHED'`];

  if (collectionIds.length > 0) {
    rowFilters.push(
      sql`l.collection_id = ANY(ARRAY[${sql.join(collectionIds.map((id) => sql`${id}`), sql`, `)}]::uuid[])`,
    );
  }

  const trimmedSearch = query.search?.trim();
  const fieldSimilarity = trimmedSearch
    ? buildArchiveFieldSimilaritySql(trimmedSearch)
    : sql`0::real`;
  if (trimmedSearch) {
    const likeNeedle = `%${trimmedSearch}%`;
    rowFilters.push(
      sql`(
        ${buildArchiveSearchVectorSql()} @@ websearch_to_tsquery('simple', ${trimmedSearch})
        OR ${buildArchiveSearchTextSql()} ILIKE ${likeNeedle}
        OR similarity(lower(${buildArchiveFuzzyTextSql()}), lower(${trimmedSearch})) > 0.22
        OR ${fieldSimilarity} > 0.46
      )`,
    );
  }

  const baseScopedFilters = [sql`TRUE`];
  if (query.person) {
    const personNeedle = `%${query.person}%`;
    if (query.personRole === 'sender') {
      baseScopedFilters.push(sql`EXISTS (
        SELECT 1
        FROM UNNEST(COALESCE(gf.senders, ARRAY[]::text[])) AS person_name
        WHERE person_name ILIKE ${personNeedle}
      )`);
    } else if (query.personRole === 'recipient') {
      baseScopedFilters.push(sql`EXISTS (
        SELECT 1
        FROM UNNEST(COALESCE(gf.recipients, ARRAY[]::text[])) AS person_name
        WHERE person_name ILIKE ${personNeedle}
      )`);
    } else {
      baseScopedFilters.push(sql`EXISTS (
        SELECT 1
        FROM UNNEST(COALESCE(gf.senders, ARRAY[]::text[]) || COALESCE(gf.recipients, ARRAY[]::text[])) AS person_name
        WHERE person_name ILIKE ${personNeedle}
      )`);
    }
  }
  if (query.sender) {
    const senderNeedle = `%${query.sender}%`;
    baseScopedFilters.push(sql`EXISTS (
      SELECT 1
      FROM UNNEST(COALESCE(gf.senders, ARRAY[]::text[])) AS sender_name
      WHERE sender_name ILIKE ${senderNeedle}
    )`);
  }
  if (query.recipient) {
    const recipientNeedle = `%${query.recipient}%`;
    baseScopedFilters.push(sql`EXISTS (
      SELECT 1
      FROM UNNEST(COALESCE(gf.recipients, ARRAY[]::text[])) AS recipient_name
      WHERE recipient_name ILIKE ${recipientNeedle}
    )`);
  }
  if (query.place) {
    const placeNeedle = `%${query.place}%`;
    baseScopedFilters.push(sql`EXISTS (
      SELECT 1
      FROM UNNEST(COALESCE(gf.places, ARRAY[]::text[])) AS place_name
      WHERE place_name ILIKE ${placeNeedle}
    )`);
  }
  if (query.topic) {
    const topicNeedle = `%${query.topic}%`;
    baseScopedFilters.push(sql`EXISTS (
      SELECT 1
      FROM UNNEST(COALESCE(gf.topics, ARRAY[]::text[])) AS topic_name
      WHERE topic_name ILIKE ${topicNeedle}
    )`);
  }
  if (query.tone) {
    baseScopedFilters.push(sql`${query.tone} = ANY(COALESCE(gf.tones, ARRAY[]::text[]))`);
  }
  if (query.relationship) {
    baseScopedFilters.push(sql`${query.relationship} = ANY(COALESCE(gf.relationships, ARRAY[]::text[]))`);
  }
  if (query.year) {
    const yearText = String(query.year);
    baseScopedFilters.push(sql`SUBSTRING(mg."dateRaw", 1, 4) = ${yearText}`);
  }
  if (query.yearFrom !== undefined) {
    baseScopedFilters.push(sql`SUBSTRING(mg."dateRaw", 1, 4)::int >= ${query.yearFrom}`);
  }
  if (query.yearTo !== undefined) {
    baseScopedFilters.push(sql`SUBSTRING(mg."dateRaw", 1, 4)::int <= ${query.yearTo}`);
  }
  if (query.verified !== undefined) {
    baseScopedFilters.push(sql`pr."metadataVerified" = ${query.verified}`);
  }

  const formatFilter = query.format?.length
    ? sql`COALESCE(bsg.formats, ARRAY[]::text[]) && ARRAY[${sql.join(
      query.format.map((format) => sql`${format}`),
      sql`, `,
    )}]::text[]`
    : sql`TRUE`;

  const searchRank = trimmedSearch
    ? sql`GREATEST(
        ts_rank_cd(${buildArchiveSearchVectorSql()}, websearch_to_tsquery('simple', ${trimmedSearch})),
        CASE WHEN ${buildArchiveSearchTextSql()} ILIKE ${`%${trimmedSearch}%`} THEN 0.08 ELSE 0 END,
        similarity(lower(${buildArchiveFuzzyTextSql()}), lower(${trimmedSearch})),
        ${fieldSimilarity}
      )`
    : sql`0::real`;

  return sql`
    WITH filtered_rows AS (
      SELECT
        l.collection_id AS "collectionId",
        l.date_raw AS "dateRaw",
        l.type_sequence AS "typeSequence",
        ${searchRank} AS "searchRank"
      FROM letters l
      INNER JOIN collections c ON c.id = l.collection_id
      WHERE ${sql.join(rowFilters, sql` AND `)}
    ),
    matching_groups AS (
      SELECT
        "collectionId",
        "dateRaw",
        "typeSequence",
        MAX("searchRank") AS "searchRank"
      FROM filtered_rows
      GROUP BY "collectionId", "dateRaw", "typeSequence"
    ),
    group_filters AS (
      SELECT
        mg."collectionId",
        mg."dateRaw",
        mg."typeSequence",
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT ${buildArchiveMediaTypeSql()}), NULL) AS formats,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT NULLIF(BTRIM(l.sender), '')), NULL) AS senders,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT NULLIF(BTRIM(l.recipient), '')), NULL) AS recipients,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT NULLIF(BTRIM(l.location_written), '')), NULL) AS places,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT NULLIF(BTRIM(l.hook), '')), NULL) AS hooks,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT NULLIF(BTRIM(l.summary), '')), NULL) AS summaries,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT NULLIF(BTRIM(topic_name), '')), NULL) AS topics,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT NULLIF(BTRIM(l.emotional_tone::text), '')), NULL) AS tones,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT NULLIF(BTRIM(l.sender_recipient_relationship::text), '')), NULL) AS relationships,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT NULLIF(BTRIM(l.photo_description), '')), NULL) AS "photoDescriptions",
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT NULLIF(BTRIM(l.extra_content_transcript), '')), NULL) AS "extraContentTranscripts",
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT NULLIF(BTRIM(l.transcription_text), '')), NULL) AS "transcriptionTexts"
      FROM matching_groups mg
      INNER JOIN letters l
        ON l.collection_id = mg."collectionId"
        AND l.date_raw = mg."dateRaw"
        AND l.type_sequence = mg."typeSequence"
        AND l.visibility = 'PUBLISHED'
      LEFT JOIN LATERAL UNNEST(COALESCE(l.primary_topics, ARRAY[]::text[])) AS topic_name ON TRUE
      GROUP BY mg."collectionId", mg."dateRaw", mg."typeSequence"
    ),
    primary_rows AS (
      SELECT DISTINCT ON (l.collection_id, l.date_raw, l.type_sequence)
        l.id,
        l.collection_id AS "collectionId",
        l.date_raw AS "dateRaw",
        l.type_sequence AS "typeSequence",
        l.type AS "primaryType",
        l.sender,
        l.recipient,
        l.location_written AS location,
        l.hook,
        (l.metadata_content_status = 'VERIFIED') AS "metadataVerified",
        c.collection_code AS "collectionCode",
        c.title AS "collectionTitle",
        l.created_at AS "createdAt"
      FROM letters l
      INNER JOIN collections c ON c.id = l.collection_id
      INNER JOIN matching_groups mg
        ON mg."collectionId" = l.collection_id
        AND mg."dateRaw" = l.date_raw
        AND mg."typeSequence" = l.type_sequence
      WHERE l.visibility = 'PUBLISHED'
      ORDER BY
        l.collection_id,
        l.date_raw,
        l.type_sequence,
        CASE WHEN l.type = 'L' THEN 0 ELSE 1 END,
        l.type ASC
    ),
    base_scoped_groups AS (
      SELECT
        mg."collectionId",
        mg."dateRaw",
        mg."typeSequence",
        mg."searchRank",
        gf.formats,
        gf.senders,
        gf.recipients,
        gf.places,
        gf.hooks,
        gf.summaries,
        gf.topics,
        gf.tones,
        gf.relationships,
        gf."photoDescriptions",
        gf."extraContentTranscripts",
        gf."transcriptionTexts",
        pr.id,
        pr."primaryType",
        pr.sender,
        pr.recipient,
        pr.location,
        pr.hook,
        pr."metadataVerified",
        pr."collectionCode",
        pr."collectionTitle",
        pr."createdAt"
      FROM matching_groups mg
      INNER JOIN group_filters gf
        ON gf."collectionId" = mg."collectionId"
        AND gf."dateRaw" = mg."dateRaw"
        AND gf."typeSequence" = mg."typeSequence"
      INNER JOIN primary_rows pr
        ON pr."collectionId" = mg."collectionId"
        AND pr."dateRaw" = mg."dateRaw"
        AND pr."typeSequence" = mg."typeSequence"
      WHERE ${sql.join(baseScopedFilters, sql` AND `)}
    ),
    scoped_groups AS (
      SELECT *
      FROM base_scoped_groups bsg
      WHERE ${formatFilter}
    )
  `;
}

function buildArchiveSearchVectorSql() {
  return sql`(
    setweight(
      to_tsvector(
        'simple',
        TRIM(CONCAT_WS(
          ' ',
          COALESCE(l.sender, ''),
          COALESCE(l.recipient, ''),
          c.collection_code,
          COALESCE(c.title, '')
        ))
      ),
      'A'
    )
    ||
    setweight(
      to_tsvector(
        'simple',
        TRIM(CONCAT_WS(
          ' ',
          l.date_raw,
          ${buildArchiveMediaTypeSql()},
          COALESCE(l.location_written, ''),
          COALESCE(l.hook, ''),
          COALESCE(l.summary, ''),
          ARRAY_TO_STRING(COALESCE(l.tags, ARRAY[]::text[]), ' '),
          ARRAY_TO_STRING(COALESCE(l.primary_topics, ARRAY[]::text[]), ' '),
          COALESCE(l.emotional_tone::text, ''),
          COALESCE(l.sender_recipient_relationship::text, '')
        ))
      ),
      'B'
    )
    ||
    setweight(
      to_tsvector(
        'simple',
        TRIM(CONCAT_WS(
          ' ',
          COALESCE(l.photo_description, ''),
          COALESCE(l.extra_content_transcript, '')
        ))
      ),
      'C'
    )
    ||
    setweight(
      to_tsvector('simple', TRIM(COALESCE(l.transcription_text, ''))),
      'D'
    )
  )`;
}

function buildArchiveSearchTextSql() {
  return sql`TRIM(CONCAT_WS(
    ' ',
    c.collection_code,
    COALESCE(c.title, ''),
    l.date_raw,
    ${buildArchiveMediaTypeSql()},
    COALESCE(l.sender, ''),
    COALESCE(l.recipient, ''),
    COALESCE(l.location_written, ''),
    COALESCE(l.hook, ''),
    COALESCE(l.summary, ''),
    ARRAY_TO_STRING(COALESCE(l.tags, ARRAY[]::text[]), ' '),
    ARRAY_TO_STRING(COALESCE(l.primary_topics, ARRAY[]::text[]), ' '),
    COALESCE(l.emotional_tone::text, ''),
    COALESCE(l.sender_recipient_relationship::text, ''),
    COALESCE(l.photo_description, ''),
    COALESCE(l.extra_content_transcript, ''),
    COALESCE(l.transcription_text, '')
  ))`;
}

function buildArchiveFuzzyTextSql() {
  return sql`TRIM(CONCAT_WS(
    ' ',
    c.collection_code,
    COALESCE(c.title, ''),
    ${buildArchiveMediaTypeSql()},
    COALESCE(l.sender, ''),
    COALESCE(l.recipient, ''),
    COALESCE(l.location_written, ''),
    COALESCE(l.hook, ''),
    COALESCE(l.summary, ''),
    COALESCE(l.emotional_tone::text, ''),
    COALESCE(l.sender_recipient_relationship::text, '')
  ))`;
}

function buildArchiveFieldSimilaritySql(searchTerm: string) {
  return sql`GREATEST(
    word_similarity(lower(COALESCE(l.sender, '')), lower(${searchTerm})),
    word_similarity(lower(COALESCE(l.recipient, '')), lower(${searchTerm})),
    word_similarity(lower(COALESCE(l.location_written, '')), lower(${searchTerm})),
    word_similarity(lower(c.collection_code), lower(${searchTerm})),
    word_similarity(lower(COALESCE(c.title, '')), lower(${searchTerm})),
    word_similarity(lower(COALESCE(${buildArchiveMediaTypeSql()}, '')), lower(${searchTerm})),
    word_similarity(lower(ARRAY_TO_STRING(COALESCE(l.tags, ARRAY[]::text[]), ' ')), lower(${searchTerm})),
    word_similarity(lower(ARRAY_TO_STRING(COALESCE(l.primary_topics, ARRAY[]::text[]), ' ')), lower(${searchTerm})),
    word_similarity(lower(COALESCE(l.emotional_tone::text, '')), lower(${searchTerm})),
    word_similarity(lower(COALESCE(l.sender_recipient_relationship::text, '')), lower(${searchTerm}))
  )`;
}

function buildArchiveMediaTypeSql() {
  return sql`CASE
    WHEN l.type = 'L' THEN 'letter'
    WHEN l.type = 'P' THEN 'photo'
    WHEN l.type = 'E' THEN 'ephemera'
    WHEN l.type = 'V' THEN 'voice'
    WHEN l.type = 'A' THEN 'article'
    WHEN l.type = 'D' THEN 'diary'
    WHEN l.type = 'C' THEN 'cover'
    WHEN l.type = 'N' THEN 'card'
    WHEN l.type = 'T' THEN 'telegram'
    ELSE 'letter'
  END`;
}

function buildArchiveSearchOrderBy(query: ArchiveSearchQuery) {
  const hasSearch = Boolean(query.search?.trim());
  const resolvedSort = query.sort === 'relevance' && !hasSearch ? 'createdAt' : query.sort;

  if (resolvedSort === 'letterDate') {
    return query.sortOrder === 'asc'
      ? sql`REPLACE(sg."dateRaw", 'X', '0') ASC, sg."createdAt" DESC`
      : sql`REPLACE(sg."dateRaw", 'X', '0') DESC, sg."createdAt" DESC`;
  }

  if (resolvedSort === 'createdAt') {
    return query.sortOrder === 'asc'
      ? sql`sg."createdAt" ASC, REPLACE(sg."dateRaw", 'X', '0') ASC`
      : sql`sg."createdAt" DESC, REPLACE(sg."dateRaw", 'X', '0') DESC`;
  }

  if (resolvedSort === 'sender') {
    return query.sortOrder === 'asc'
      ? sql`LOWER(NULLIF(sg.sender, '')) ASC NULLS LAST, REPLACE(sg."dateRaw", 'X', '0') ASC, sg."createdAt" DESC`
      : sql`LOWER(NULLIF(sg.sender, '')) DESC NULLS LAST, REPLACE(sg."dateRaw", 'X', '0') DESC, sg."createdAt" DESC`;
  }

  if (resolvedSort === 'recipient') {
    return query.sortOrder === 'asc'
      ? sql`LOWER(NULLIF(sg.recipient, '')) ASC NULLS LAST, REPLACE(sg."dateRaw", 'X', '0') ASC, sg."createdAt" DESC`
      : sql`LOWER(NULLIF(sg.recipient, '')) DESC NULLS LAST, REPLACE(sg."dateRaw", 'X', '0') DESC, sg."createdAt" DESC`;
  }

  if (resolvedSort === 'collection') {
    return query.sortOrder === 'asc'
      ? sql`LOWER(NULLIF(sg."collectionCode", '')) ASC NULLS LAST, REPLACE(sg."dateRaw", 'X', '0') ASC, sg."createdAt" DESC`
      : sql`LOWER(NULLIF(sg."collectionCode", '')) DESC NULLS LAST, REPLACE(sg."dateRaw", 'X', '0') DESC, sg."createdAt" DESC`;
  }

  return sql`sg."searchRank" DESC, REPLACE(sg."dateRaw", 'X', '0') DESC, sg."createdAt" DESC`;
}

function transformArchiveSearchRow(row: ArchiveSearchRow, query: ArchiveSearchQuery) {
  const primaryImageType = mapTypeToImageType(row.primaryType);
  const [singular, plural] = MEDIA_COUNT_LABELS[primaryImageType];
  const formattedDate = formatLetterDate({ dateRaw: row.dateRaw } as never) || row.dateRaw;
  const pseudoLetter = {
    type: row.primaryType,
    sender: row.sender,
    recipient: row.recipient,
    dateRaw: row.dateRaw,
  };
  const pseudoCollection = {
    title: row.collectionTitle,
    collectionCode: row.collectionCode,
  };

  return {
    id: row.id,
    title: generateTitle(pseudoLetter as never, pseudoCollection as never),
    imageUrl: row.pageId
      ? `/images/${row.pageId}${row.checksumSha256 ? `?v=${row.checksumSha256.slice(0, 8)}` : ''}`
      : undefined,
    imageType: primaryImageType,
    primaryChip: row.primaryPageCount > 0
      ? `${row.primaryPageCount} ${row.primaryPageCount === 1 ? singular : plural}`
      : undefined,
    sender: row.sender || undefined,
    recipient: row.recipient || undefined,
    collectionCode: row.collectionCode,
    createdAt: toIsoDateString(row.createdAt),
    date: formattedDate,
    dateRaw: row.dateRaw,
    hook: row.hook || undefined,
    location: row.location || undefined,
    verified: row.metadataVerified,
    searchPreview: buildArchiveSearchPreview(row, query, formattedDate),
  };
}

function buildArchiveSearchPreview(
  row: ArchiveSearchRow,
  query: ArchiveSearchQuery,
  formattedDate: string,
): ArchiveSearchPreview | undefined {
  const search = query.search?.trim();
  if (!search) return undefined;

  const searchTerms = getArchiveSearchTerms(search);
  const prioritizedGroups = [
    dedupeArchivePreviewValues([
      ...(row.transcriptionTexts || []),
      ...(row.extraContentTranscripts || []),
      ...(row.photoDescriptions || []),
    ]),
    dedupeArchivePreviewValues([
      ...(row.summaries || []),
      ...(row.hooks || []),
    ]),
    dedupeArchivePreviewValues([
      formattedDate,
      ...(row.places || []),
      ...(row.senders || []),
      ...(row.recipients || []),
      row.collectionTitle || '',
      row.collectionCode,
      ...(row.formats || []).map((format) => getArchiveFormatDisplayLabel(format)),
    ]),
  ];

  for (let groupIndex = 0; groupIndex < prioritizedGroups.length; groupIndex += 1) {
    const groupValues = prioritizedGroups[groupIndex];
    const candidates = groupValues
      .map((value) => scoreArchivePreviewValue(value, search, searchTerms))
      .filter((candidate): candidate is ArchivePreviewCandidate => candidate !== null);

    if (candidates.length === 0) continue;

    candidates.sort((left, right) => right.score - left.score || right.totalMatches - left.totalMatches);
    const bestCandidate = candidates[0];
    const matchCount = Math.max(
      candidates.reduce((sum, candidate) => sum + candidate.totalMatches, 0),
      bestCandidate.highlightRanges.length,
      1,
    );

    return {
      excerpt: bestCandidate.excerpt,
      highlightRanges: bestCandidate.highlightRanges,
      matchCount,
    };
  }

  return undefined;
}

type ArchivePreviewCandidate = {
  excerpt: string;
  highlightRanges: ArchiveSearchHighlightRange[];
  score: number;
  totalMatches: number;
};

function dedupeArchivePreviewValues(values: string[]) {
  return Array.from(
    new Set(
      values
        .map((value) => prepareArchivePreviewText(value))
        .filter((value): value is string => value.length > 0),
    ),
  );
}

function toIsoDateString(value: Date | string) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
}

function getArchiveSearchTerms(search: string) {
  const normalized = normalizeArchiveSearchText(search);
  const terms = normalized
    .split(' ')
    .map((term) => term.trim())
    .filter((term) => term.length >= 2);

  return Array.from(new Set(terms));
}

function normalizeArchiveSearchText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function collapseArchiveWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function prepareArchivePreviewText(value: string) {
  return collapseArchiveWhitespace(
    value
      .replace(/---\s*Page\s+\d+\s*---/gi, ' ')
      .replace(/\r\n/g, '\n'),
  );
}

function splitArchivePreviewSegments(value: string) {
  const segments = value
    .split(/\n+|(?<=[.!?])\s+(?=[A-Z0-9"'(])/g)
    .map((segment) => collapseArchiveWhitespace(segment))
    .filter((segment) => segment.length > 0);

  return segments.length > 0 ? segments : [value];
}

function scoreArchivePreviewValue(
  value: string,
  rawSearch: string,
  searchTerms: string[],
): ArchivePreviewCandidate | null {
  const segments = splitArchivePreviewSegments(value);
  let bestCandidate: ArchivePreviewCandidate | null = null;
  let totalMatches = 0;

  for (const segment of segments) {
    const exactRanges = collectArchiveExactMatchRanges(segment, rawSearch, searchTerms);

    if (exactRanges.length > 0) {
      totalMatches += exactRanges.length;
      const excerptResult = buildArchiveExcerptWithHighlights(segment, exactRanges);
      const score =
        exactRanges.length * 10 +
        getArchivePhraseMatchBonus(segment, rawSearch) +
        countArchiveMatchedTerms(segment, searchTerms) * 2;

      if (
        !bestCandidate ||
        score > bestCandidate.score ||
        (score === bestCandidate.score && exactRanges.length > bestCandidate.totalMatches)
      ) {
        bestCandidate = {
          excerpt: excerptResult.excerpt,
          highlightRanges: excerptResult.highlightRanges,
          score,
          totalMatches: exactRanges.length,
        };
      }

      continue;
    }

    if (bestCandidate) {
      continue;
    }

    const fuzzyCandidate = buildArchiveFuzzyPreviewCandidate(segment, searchTerms, rawSearch);
    if (fuzzyCandidate) {
      bestCandidate = fuzzyCandidate;
    }
  }

  if (!bestCandidate) {
    return null;
  }

  return {
    ...bestCandidate,
    totalMatches: totalMatches > 0 ? totalMatches : 1,
  };
}

function collectArchiveExactMatchRanges(
  value: string,
  rawSearch: string,
  searchTerms: string[],
) {
  const loweredValue = value.toLowerCase();
  const rawNeedle = rawSearch.trim().toLowerCase();
  const needles = Array.from(
    new Set([rawNeedle, ...searchTerms.map((term) => term.toLowerCase())].filter((needle) => needle.length > 1)),
  );
  const ranges: ArchiveSearchHighlightRange[] = [];

  for (const needle of needles) {
    let fromIndex = 0;

    while (fromIndex < loweredValue.length) {
      const foundIndex = loweredValue.indexOf(needle, fromIndex);
      if (foundIndex === -1) break;

      ranges.push({
        start: foundIndex,
        end: foundIndex + needle.length,
      });
      fromIndex = foundIndex + Math.max(needle.length, 1);
    }
  }

  return mergeArchiveHighlightRanges(ranges);
}

function mergeArchiveHighlightRanges(ranges: ArchiveSearchHighlightRange[]) {
  if (ranges.length === 0) return [];

  const sortedRanges = [...ranges].sort((left, right) => left.start - right.start || left.end - right.end);
  const mergedRanges: ArchiveSearchHighlightRange[] = [sortedRanges[0]];

  for (let index = 1; index < sortedRanges.length; index += 1) {
    const currentRange = sortedRanges[index];
    const previousRange = mergedRanges[mergedRanges.length - 1];

    if (currentRange.start <= previousRange.end) {
      previousRange.end = Math.max(previousRange.end, currentRange.end);
      continue;
    }

    mergedRanges.push({ ...currentRange });
  }

  return mergedRanges;
}

function buildArchiveExcerptWithHighlights(
  value: string,
  ranges: ArchiveSearchHighlightRange[],
) {
  const maxLength = 108;
  const preferredLead = 18;
  const firstRange = ranges[0];
  const shouldWindowExcerpt =
    value.length > maxLength ||
    (firstRange && firstRange.start > preferredLead + 20);

  if (!shouldWindowExcerpt) {
    return {
      excerpt: value,
      highlightRanges: ranges,
    };
  }

  const window = chooseArchiveExcerptWindow(value, ranges, maxLength, preferredLead);
  const excerptSource = value.slice(window.start, window.end);
  const leadingTrim = excerptSource.length - excerptSource.trimStart().length;
  const trailingTrim = excerptSource.length - excerptSource.trimEnd().length;
  const trimmedStart = window.start + leadingTrim;
  const trimmedEnd = window.end - trailingTrim;
  const excerptBody = value.slice(trimmedStart, trimmedEnd);
  const prefix = trimmedStart > 0 ? '…' : '';
  const suffix = trimmedEnd < value.length ? '…' : '';

  return {
    excerpt: `${prefix}${excerptBody}${suffix}`,
    highlightRanges: ranges
      .filter((range) => range.end > trimmedStart && range.start < trimmedEnd)
      .map((range) => ({
        start: Math.max(range.start, trimmedStart) - trimmedStart + prefix.length,
        end: Math.min(range.end, trimmedEnd) - trimmedStart + prefix.length,
      })),
  };
}

function chooseArchiveExcerptWindow(
  value: string,
  ranges: ArchiveSearchHighlightRange[],
  maxLength: number,
  preferredLead: number,
) {
  let bestWindow = {
    start: 0,
    end: Math.min(value.length, maxLength),
    score: -1,
  };

  for (const range of ranges) {
    let start = Math.max(0, range.start - preferredLead);
    let end = Math.min(value.length, start + maxLength);

    while (start > 0 && value[start - 1] !== ' ') {
      start -= 1;
    }

    while (end < value.length && value[end] !== ' ') {
      end += 1;
    }

    const overlappingRanges = ranges.filter((candidate) => candidate.end > start && candidate.start < end);
    const overlapCount = overlappingRanges.length;
    const overlapChars = overlappingRanges.reduce(
      (sum, candidate) => sum + Math.min(candidate.end, end) - Math.max(candidate.start, start),
      0,
    );
    const firstVisibleMatchOffset = overlapCount > 0
      ? overlappingRanges[0]!.start - start
      : maxLength;
    const distanceFromPreferredLead = Math.abs(firstVisibleMatchOffset - preferredLead);
    const windowScore =
      overlapCount * 1000 +
      overlapChars * 25 -
      distanceFromPreferredLead * 4 -
      start * 0.05;

    if (windowScore > bestWindow.score) {
      bestWindow = { start, end, score: windowScore };
    }
  }

  return bestWindow;
}

function buildArchiveFuzzyPreviewCandidate(
  value: string,
  searchTerms: string[],
  rawSearch: string,
): ArchivePreviewCandidate | null {
  const tokens = Array.from(value.matchAll(/[A-Za-z0-9']+/g));
  const normalizedTerms = searchTerms.length > 0 ? searchTerms : [normalizeArchiveSearchText(rawSearch)];
  let bestTokenMatch:
    | {
        range: ArchiveSearchHighlightRange;
        score: number;
      }
    | null = null;

  for (const token of tokens) {
    const tokenText = token[0];
    const tokenStart = token.index ?? 0;
    const normalizedToken = normalizeArchiveSearchText(tokenText);
    if (normalizedToken.length < 3) continue;

    for (const searchTerm of normalizedTerms) {
      if (searchTerm.length < 3) continue;
      const score = getArchiveTokenSimilarity(normalizedToken, searchTerm);

      if (score < 0.76) continue;

      if (!bestTokenMatch || score > bestTokenMatch.score) {
        bestTokenMatch = {
          score,
          range: {
            start: tokenStart,
            end: tokenStart + tokenText.length,
          },
        };
      }
    }
  }

  if (!bestTokenMatch) {
    return null;
  }

  const excerptResult = buildArchiveExcerptWithHighlights(value, [bestTokenMatch.range]);
  return {
    excerpt: excerptResult.excerpt,
    highlightRanges: excerptResult.highlightRanges,
    score: 4 + bestTokenMatch.score,
    totalMatches: 1,
  };
}

function getArchivePhraseMatchBonus(value: string, rawSearch: string) {
  const phrase = rawSearch.trim().toLowerCase();
  if (phrase.length < 2) return 0;
  return value.toLowerCase().includes(phrase) ? 6 : 0;
}

function countArchiveMatchedTerms(value: string, searchTerms: string[]) {
  const loweredValue = value.toLowerCase();
  return searchTerms.filter((term) => loweredValue.includes(term.toLowerCase())).length;
}

function getArchiveTokenSimilarity(left: string, right: string) {
  if (left === right) return 1;

  let sharedPrefix = 0;
  while (
    sharedPrefix < left.length &&
    sharedPrefix < right.length &&
    left[sharedPrefix] === right[sharedPrefix]
  ) {
    sharedPrefix += 1;
  }

  if (sharedPrefix >= 4 && Math.abs(left.length - right.length) <= 2) {
    return 0.84;
  }

  const distance = getLevenshteinDistance(left, right);
  return 1 - distance / Math.max(left.length, right.length, 1);
}

function getLevenshteinDistance(left: string, right: string) {
  const matrix = Array.from({ length: left.length + 1 }, () =>
    new Array<number>(right.length + 1).fill(0),
  );

  for (let leftIndex = 0; leftIndex <= left.length; leftIndex += 1) {
    matrix[leftIndex][0] = leftIndex;
  }

  for (let rightIndex = 0; rightIndex <= right.length; rightIndex += 1) {
    matrix[0][rightIndex] = rightIndex;
  }

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      matrix[leftIndex][rightIndex] = Math.min(
        matrix[leftIndex - 1][rightIndex] + 1,
        matrix[leftIndex][rightIndex - 1] + 1,
        matrix[leftIndex - 1][rightIndex - 1] + substitutionCost,
      );
    }
  }

  return matrix[left.length][right.length];
}

function getArchiveFormatDisplayLabel(format: string) {
  const normalizedFormat = format.toLowerCase();
  if (normalizedFormat in ARCHIVE_FORMAT_LABELS) {
    return ARCHIVE_FORMAT_LABELS[normalizedFormat as keyof typeof ARCHIVE_FORMAT_LABELS];
  }

  return format;
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
