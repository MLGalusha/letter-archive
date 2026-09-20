import { getPublicCataloguePage } from '../services/public-catalogue-page.js';
import { Router } from 'express';
import { eq, and, or, inArray, ilike, asc, desc, sql } from 'drizzle-orm';
import { db, letters, collections, letterPages, type LetterType } from '../db/index.js';
import { archiveSearchQuerySchema, publicLetterQuerySchema } from '../schemas/letter.js';
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
import { logIfSlow, TIMING_THRESHOLDS } from '../utils/logger.js';
import {
  publicFieldSql,
  toPublicLetter,
} from '../services/public-read-model.js';
import {
  publicCatalogueChronologySql,
  isPhotoOnlyCatalogueUnit,
  publicCatalogueLetterTypeSql,
  publicCatalogueRepresentativeOrderSql,
  retainPublicCatalogueRepresentatives,
  selectPublicCatalogueRepresentative,
} from '../services/public-catalogue-unit.js';
import { isPublicEntityProjection } from '../services/entities/public-projection.js';

import { searchArchiveSummaries } from '../services/archive-search.js';
import { MEDIA_COUNT_LABELS, toIsoDateString } from '../services/archive-search-shared.js';
export { getArchiveContiguousSearchPhrases } from '../services/archive-search-query.js';

const router = Router();

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
  extraContentStatus: LetterWithRelations['extraContentStatus'];
  photoDescription: string | null;
  photoDescriptionStatus: LetterWithRelations['photoDescriptionStatus'];
  metadataContentStatus: LetterWithRelations['metadataContentStatus'];
  transcriptPublished: boolean;
  metadataPublished: boolean;
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
    const query = publicLetterQuerySchema.parse(req.query);

    req.log.debug(
      { collection: query.collection, page: query.page },
      'Letters list query'
    );

    // Public reads always start from published rows. Publication is not a
    // caller-selected filter on this route.
    const conditions = [eq(letters.visibility, 'PUBLISHED')];

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

    // NOTE: workflow filter NOT applied here - applied after grouping below

    // Determine sort column and order
    // For date sorting, use dateRaw with X replaced by 0
    // This makes unknown dates sort at the start of their range:
    // 18XXXXXX → 18000000, so "1800s" comes before "1801"
    const cataloguePage = await getPublicCataloguePage(conditions, query);
    const sortFn = query.sortOrder === 'asc' ? asc : desc;
    const getSortExpression = () => {
      switch (query.sort) {
        case 'letterDate':
          // Replace X with 0 so unknown parts sort at the beginning of their range
          return sql`REPLACE(${letters.dateRaw}, 'X', '0')`;
        case 'sender':
          return publicFieldSql(letters.metadataPublished, letters.sender);
        case 'createdAt':
        default:
          return letters.createdAt;
      }
    };

    // Load only this page of catalogue units, including their published companions.
    const results = cataloguePage.units.length ? await db.query.letters.findMany({
      where: cataloguePage.where,
      columns: {
        // Exclude large text/JSONB fields not needed for list view
        transcriptionText: false,
        transcriptionJson: false,
        entityExtractionJson: false,
        metadataV2Json: false,
        metadataJson: false,
        aiNotes: false,
        readingText: false,
        extraContentTranscript: false,
      },
      with: {
        collection: true,
        pages: {
          columns: {
            id: true,
            pageNumber: true,
            checksumSha256: true,
          },
          orderBy: (p, { asc: pageAsc }) => [pageAsc(p.pageNumber)],
        },
      },
      orderBy: query.sort === 'letterDate'
        ? [publicCatalogueChronologySql(letters.dateRaw, letters.collectionId, letters.typeSequence, query.sortOrder === 'desc')]
        : [sortFn(getSortExpression())],
    }) : [];

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

    // Select a public catalogue root; supplementary rows remain related media.
    const filteredResults: LetterWithRelations[] = [];
    for (const [_key, group] of groupMap) {
      const primary = selectPublicCatalogueRepresentative(group);
      if (!primary) continue;

      filteredResults.push(primary);
    }

    const paginatedResults = cataloguePage.units.flatMap((unit) => {
      const primary = filteredResults.find((letter) => letter.collectionId === unit.collectionId
        && letter.dateRaw === unit.dateRaw && letter.typeSequence === unit.typeSequence);
      return primary ? [primary] : [];
    });

    // Enrich primary letters with related content from the already-loaded groupMap
    const enrichedResults = paginatedResults.map((letter) => {
      const key = `${letter.collectionId}:${letter.dateRaw}:${letter.typeSequence}`;
      const group = groupMap.get(key) || [];
      const relatedItems = group.filter((l) => l.id !== letter.id);
      return { letter, relatedItems };
    });

    // Transform to frontend-compatible format with related items
    const transformedDtos = transformLettersWithRelatedToDTO(enrichedResults);
    const transformedLetters = transformedDtos.map((dto, index) => {
      const unit = enrichedResults[index];
      return toPublicLetter(dto, {
        photoOnly: isPhotoOnlyCatalogueUnit([unit.letter, ...unit.relatedItems]),
      });
    });

    const duration = Date.now() - start;
    req.log.info(
      { resultCount: transformedLetters.length, totalGroups: cataloguePage.total, page: query.page, duration },
      'Letters list completed'
    );
    logIfSlow(req.log, 'letters list query', duration, TIMING_THRESHOLDS.DB_QUERY);

    res.json({
      letters: transformedLetters,
      page: query.page,
      limit: query.limit,
      total: cataloguePage.total,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/letters/summaries', async (req, res, next) => {
  const start = Date.now();
  try {
    const query = publicLetterQuerySchema.parse(req.query);
    const conditions = [eq(letters.visibility, 'PUBLISHED')];

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

    const cataloguePage = await getPublicCataloguePage(conditions, query);
    const sortFn = query.sortOrder === 'asc' ? asc : desc;
    const getSortExpression = () => {
      switch (query.sort) {
        case 'letterDate':
          return sql`REPLACE(${letters.dateRaw}, 'X', '0')`;
        case 'sender':
          return publicFieldSql(letters.metadataPublished, letters.sender);
        case 'createdAt':
        default:
          return letters.createdAt;
      }
    };

    const results = cataloguePage.units.length ? await db.query.letters.findMany({
      where: cataloguePage.where,
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
        extraContentStatus: true,
        photoDescription: true,
        photoDescriptionStatus: true,
        metadataContentStatus: true,
        transcriptPublished: true,
        metadataPublished: true,
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
      orderBy: query.sort === 'letterDate'
        ? [publicCatalogueChronologySql(letters.dateRaw, letters.collectionId, letters.typeSequence, query.sortOrder === 'desc')]
        : [sortFn(getSortExpression())],
    }) : [];

    // Group by (collectionId, dateRaw, typeSequence) — merge companion types
    // (e.g. L + C on same date) into one group, matching the adjacent API
    const allResults = results as SummaryLetterWithRelations[];
    const groupMap = new Map<string, SummaryLetterWithRelations[]>();
    for (const letter of allResults) {
      const key = `${letter.collectionId}:${letter.dateRaw}:${letter.typeSequence}`;
      const group = groupMap.get(key) || [];
      group.push(letter);
      groupMap.set(key, group);
    }

    // Select a public catalogue root; supplementary rows remain related media.
    const filteredResults: SummaryLetterWithRelations[] = [];
    for (const [, group] of groupMap) {
      const primary = selectPublicCatalogueRepresentative(group);
      if (!primary) continue;

      filteredResults.push(primary);
    }

    const paginatedResults = cataloguePage.units.flatMap((unit) => {
      const primary = filteredResults.find((letter) => letter.collectionId === unit.collectionId
        && letter.dateRaw === unit.dateRaw && letter.typeSequence === unit.typeSequence);
      return primary ? [primary] : [];
    });

    const transformedLetters = paginatedResults.map((letter) => {
      const key = `${letter.collectionId}:${letter.dateRaw}:${letter.typeSequence}`;
      const group = groupMap.get(key) || [];
      return transformLetterSummary(letter, group.filter((item) => item.id !== letter.id));
    });

    const duration = Date.now() - start;
    req.log.info(
      { resultCount: transformedLetters.length, totalGroups: cataloguePage.total, page: query.page, duration },
      'Letters summary query completed',
    );
    logIfSlow(req.log, 'letters summary query', duration, TIMING_THRESHOLDS.DB_QUERY);

    res.json({
      letters: transformedLetters,
      page: query.page,
      limit: query.limit,
      total: cataloguePage.total,
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

    const requestedLetter = await db.query.letters.findFirst({
      where: and(
        eq(letters.id, letterId),
        eq(letters.visibility, 'PUBLISHED')
      ),
      columns: {
        collectionId: true,
        dateRaw: true,
        typeSequence: true,
      },
    });

    if (!requestedLetter) {
      req.log.debug({ letterId }, 'Letter not found or not published');
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    // Every id in a public unit is an alias for the same stable representative.
    // Resolve roots and companions through the same path so direct URLs cannot
    // establish identities that list/search/navigation omit.
    const letter = await db.query.letters.findFirst({
      where: and(
        eq(letters.collectionId, requestedLetter.collectionId),
        eq(letters.dateRaw, requestedLetter.dateRaw),
        eq(letters.typeSequence, requestedLetter.typeSequence),
        eq(letters.visibility, 'PUBLISHED'),
        publicCatalogueLetterTypeSql(letters.type),
      ),
      with: {
        collection: true,
        pages: {
          orderBy: (p, { asc }) => [asc(p.pageNumber)],
        },
        persons: { with: { person: true } },
        places: { with: { place: true } },
      },
      orderBy: (candidate, { asc }) => [
        publicCatalogueRepresentativeOrderSql(candidate.type),
        asc(candidate.id),
      ],
    });

    if (!letter) {
      req.log.debug({ letterId }, 'Supplementary letter has no public catalogue root');
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
    const publicLetter = {
      ...letter,
      persons: letter.persons?.filter((link) => isPublicEntityProjection({
        confirmedAt: link.confirmedAt,
        projectionRevision: link.entityExtractionRevision,
        committedRevision: letter.entityExtractionRevision,
        committedJson: letter.entityExtractionJson,
      })),
      places: letter.places?.filter((link) => isPublicEntityProjection({
        confirmedAt: link.confirmedAt,
        projectionRevision: link.entityExtractionRevision,
        committedRevision: letter.entityExtractionRevision,
        committedJson: letter.entityExtractionJson,
      })),
    };
    const dto = transformLetterWithRelatedToDTO(
      publicLetter as LetterWithRelations,
      relatedItems,
    );
    res.json(toPublicLetter(dto, {
      photoOnly: isPhotoOnlyCatalogueUnit([letter, ...relatedItems]),
    }));
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
        typeSequence: true,
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
        collectionId: true,
        dateRaw: true,
        type: true,
        typeSequence: true,
        createdAt: true,
        sender: true,
        recipient: true,
        hook: true,
        photoDescription: true,
        photoDescriptionStatus: true,
        metadataPublished: true,
      },
      with: {
        pages: {
          columns: { id: true, pageNumber: true, checksumSha256: true },
          orderBy: (p, { asc: pageAsc }) => [pageAsc(p.pageNumber)],
        },
      },
      orderBy: [publicCatalogueChronologySql(letters.dateRaw, letters.collectionId, letters.typeSequence)],
    });

    // Deduplicate public catalogue roots by correspondence-unit identity using
    // the same priority as detail, list, collection, search, and sitemap.
    const collectionLetters = retainPublicCatalogueRepresentatives(allCollectionLetters);

    // Find current position — if the current letter is a companion type,
    // it resolves to the same slot as its L-type sibling
    let currentIndex = collectionLetters.findIndex(l => l.id === letterId);
    if (currentIndex === -1) {
      // Current letter is a companion type — resolve its exact catalogue unit.
      currentIndex = collectionLetters.findIndex((candidate) =>
        candidate.dateRaw === letter.dateRaw
        && candidate.typeSequence === letter.typeSequence
      );
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

      // First page of the primary letter for image preloading
      const firstPage = l.pages?.[0];
      const imageUrl = firstPage
        ? `/images/${firstPage.id}${firstPage.checksumSha256 ? `?v=${firstPage.checksumSha256.slice(0, 8)}` : ''}`
        : undefined;

      const photoOnly = companions.length > 0 && companions.every((item) => item.type === 'P');
      const showMetadata = l.metadataPublished;

      return {
        id: l.id,
        dateRaw: l.dateRaw,
        date: l.dateRaw ? formatPartialDate(l.dateRaw) : undefined,
        sender: showMetadata ? (l.sender || undefined) : undefined,
        recipient: showMetadata ? (l.recipient || undefined) : undefined,
        hook: showMetadata
          ? (l.hook || (
              photoOnly && l.photoDescriptionStatus === 'VERIFIED'
                ? l.photoDescription
                : null
            ) || undefined)
          : (
              photoOnly && l.photoDescriptionStatus === 'VERIFIED'
                ? (l.photoDescription || undefined)
                : undefined
            ),
        contentLabels: contentLabels.length > 0 ? contentLabels : undefined,
        imageUrl,
      };
    }

    if (currentIndex === -1) {
      res.status(404).json({ error: 'Letter not found' });
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

  const group = [letter, ...relatedItems];
  const isPhotoOnly = isPhotoOnlyCatalogueUnit(group);
  const showMetadata = letter.metadataPublished;

  return {
    id: letter.id,
    title: showMetadata
      ? generateTitle(letter as never, letter.collection as never)
      : primaryType.charAt(0).toUpperCase() + primaryType.slice(1),
    imageUrl: primaryPage
      ? `/images/${primaryPage.id}${primaryPage.checksumSha256 ? `?v=${primaryPage.checksumSha256.slice(0, 8)}` : ''}`
      : undefined,
    imageType: primaryType,
    primaryChip: primaryCount > 0
      ? `${primaryCount} ${primaryCount === 1 ? singular : plural}`
      : undefined,
    sender: showMetadata ? (letter.sender || undefined) : undefined,
    recipient: showMetadata ? (letter.recipient || undefined) : undefined,
    collectionCode: letter.collection.collectionCode,
    createdAt: toIsoDateString(letter.createdAt),
    date: formatLetterDate(letter as never),
    dateRaw: letter.dateRaw,
    hook: showMetadata
      ? (letter.hook || (
          isPhotoOnly && letter.photoDescriptionStatus === 'VERIFIED'
            ? letter.photoDescription
            : null
        ) || undefined)
      : (
          isPhotoOnly && letter.photoDescriptionStatus === 'VERIFIED'
            ? (letter.photoDescription || undefined)
            : undefined
        ),
    location: showMetadata ? (letter.locationWritten || undefined) : undefined,
    verified: showMetadata && letter.metadataContentStatus === 'VERIFIED',
    searchText: buildShelfSearchText(letter, relatedItems),
  };
}

export function buildShelfSearchText(
  letter: SummaryLetterWithRelations,
  relatedItems: SummaryLetterWithRelations[],
): string {
  // Truncate long text fields to keep response payload small while preserving
  // enough content for client-side search (most search terms appear early)
  const truncate = (s: string | null, maxLen = 500) =>
    s && s.length > maxLen ? s.slice(0, maxLen) : s;

  const group = [letter, ...relatedItems];
  const photoOnly = group.length > 0 && group.every((item) => item.type === 'P');

  return group.flatMap((item) => [
    ...(item.metadataPublished
      ? [item.sender, item.recipient, item.locationWritten, item.hook, item.summary]
      : []),
    ...(photoOnly && item.photoDescriptionStatus === 'VERIFIED'
      ? [item.photoDescription]
      : []),
    ...(item.transcriptPublished ? [truncate(item.transcriptionText)] : []),
    ...(item.transcriptPublished && item.extraContentStatus === 'VERIFIED'
      ? [truncate(item.extraContentTranscript)]
      : []),
  ])
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ');
}
