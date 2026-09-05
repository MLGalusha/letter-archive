import { Router } from 'express';
import { eq, and, sql, asc } from 'drizzle-orm';
import { db, letters, collections } from '../db/index.js';
import {
  listCollections,
  getCollectionByCode,
  resolveCollectionStartHere,
} from '../services/collections.js';
import { transformLettersWithRelatedToDTO, type LetterWithRelations } from '../dto/index.js';
import { getCollectionAggregations } from '../services/collection-profile.js';
import {
  isVerifiedPublicContent,
  toPublicCollection,
  toPublicLetter,
} from '../services/public-read-model.js';
import {
  publicCatalogueChronologySql,
  isPhotoOnlyCatalogueUnit,
  publicCatalogueLetterTypeSql,
  retainRowsWithPublicCatalogueRoot,
  selectPublicCatalogueRepresentative,
} from '../services/public-catalogue-unit.js';
import {
  collectionProfilePublicationIsCurrent,
  collectionProfileSourceIsCurrent,
  getCurrentCollectionProfilePublicationIds,
} from '../services/collection-profile-source.js';

const router = Router();

interface ProfileCorrespondent {
  name: string;
  biography: string | null;
  hook: string | null;
}

function normalizeProfileCorrespondents(input: unknown): ProfileCorrespondent[] {
  if (!Array.isArray(input)) return [];

  const correspondents = new Map<string, ProfileCorrespondent>();

  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const rawName = 'name' in item && typeof item.name === 'string' ? item.name.trim() : '';
    if (!rawName) continue;

    const hook = 'hook' in item && typeof item.hook === 'string'
      ? item.hook.trim() || null
      : null;
    const biography = 'biography' in item && typeof item.biography === 'string'
      ? item.biography.trim() || null
      : null;

    correspondents.set(rawName.toLowerCase(), {
      name: rawName,
      hook,
      biography,
    });
  }

  return Array.from(correspondents.values());
}

function applyProfileCorrespondentOverrides<
  T extends { name: string; biography: string | null; hook: string | null }
>(people: T[], overrides: ProfileCorrespondent[]): T[] {
  if (overrides.length === 0) return people;

  const overrideMap = new Map(overrides.map((person) => [person.name.trim().toLowerCase(), person]));
  return people.map((person) => {
    const override = overrideMap.get(person.name.trim().toLowerCase());
    if (!override) return person;
    return {
      ...person,
      biography: override.biography,
      hook: override.hook,
    };
  });
}

function filterProfileLetterReferences(input: unknown, publicLetterIds: Set<string>): unknown[] {
  if (!Array.isArray(input)) return [];

  return input.map((item) => {
    if (!item || typeof item !== 'object' || !('letterIds' in item) || !Array.isArray(item.letterIds)) {
      return item;
    }
    return {
      ...item,
      letterIds: item.letterIds.filter(
        (letterId: unknown): letterId is string =>
          typeof letterId === 'string' && publicLetterIds.has(letterId),
      ),
    };
  });
}

// Note: Request logging is handled by the request-logger middleware

/**
 * GET /collections
 * List all collections with letter counts (published only)
 */
router.get('/collections', async (req, res, next) => {
  try {
    const allCollections = await listCollections();

    // Run all aggregation queries in parallel
    const [letterCounts, dateRanges, topSenders, topRecipients] = await Promise.all([
      // Count unique correspondence units (dedup companion types like covers/telegrams)
      db
        .select({
          collectionId: letters.collectionId,
          count: sql<number>`count(DISTINCT (date_raw, type_sequence))::int`,
        })
        .from(letters)
        .where(and(
          eq(letters.visibility, 'PUBLISHED'),
          publicCatalogueLetterTypeSql(letters.type),
        ))
        .groupBy(letters.collectionId),

      // Preserve filename date precision while comparing consistent eight-character keys.
      // Prefixing the original value with its lower/upper bound lets MIN/MAX
      // retain the winning partial date without sorting arrays for each collection.
      db
        .select({
          collectionId: letters.collectionId,
          minDate: sql<string>`SUBSTRING(MIN(REPLACE(UPPER(date_raw), 'X', '0') || UPPER(date_raw)) FILTER (WHERE date_raw ~ '^[0-9]{2}') FROM 9)`,
          maxDate: sql<string>`SUBSTRING(MAX(REPLACE(UPPER(date_raw), 'X', '9') || UPPER(date_raw)) FILTER (WHERE date_raw ~ '^[0-9]{2}') FROM 9)`,
        })
        .from(letters)
        .where(and(
          eq(letters.visibility, 'PUBLISHED'),
          publicCatalogueLetterTypeSql(letters.type),
        ))
        .groupBy(letters.collectionId),

      // Most frequent sender per collection
      db.execute(sql`
        SELECT DISTINCT ON (collection_id)
          collection_id, sender as name
        FROM letters
        WHERE visibility = 'PUBLISHED'
          AND metadata_published = TRUE
          AND type = 'L'
          AND sender IS NOT NULL
        GROUP BY collection_id, sender
        ORDER BY collection_id, count(*) DESC
      `),

      // Most frequent recipient per collection
      db.execute(sql`
        SELECT DISTINCT ON (collection_id)
          collection_id, recipient as name
        FROM letters
        WHERE visibility = 'PUBLISHED'
          AND metadata_published = TRUE
          AND type = 'L'
          AND recipient IS NOT NULL
        GROUP BY collection_id, recipient
        ORDER BY collection_id, count(*) DESC
      `),
    ]);

    const countMap = new Map(letterCounts.map(r => [r.collectionId, r.count]));
    const dateMap = new Map(dateRanges.map(r => [r.collectionId, { min: r.minDate, max: r.maxDate }]));
    const senderMap = new Map((topSenders as unknown as Array<{ collection_id: string; name: string }>).map(r => [r.collection_id, r.name]));
    const recipientMap = new Map((topRecipients as unknown as Array<{ collection_id: string; name: string }>).map(r => [r.collection_id, r.name]));
    const currentProfilePublicationIds =
      await getCurrentCollectionProfilePublicationIds(
        allCollections.map((collection) => collection.id),
      );

    const collectionsWithDetails = allCollections
      .map((collection) => ({
        ...toPublicCollection(
          collection,
          currentProfilePublicationIds.has(collection.id),
        ),
        letterCount: countMap.get(collection.id) || 0,
        dateRange: dateMap.get(collection.id) || null,
        primarySender: senderMap.get(collection.id) || null,
        primaryRecipient: recipientMap.get(collection.id) || null,
      }))
      .filter((collection) => collection.letterCount > 0);

    req.log.debug({ collectionCount: collectionsWithDetails.length }, 'Collections list fetched');
    res.json(collectionsWithDetails);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /collections/:code
 * Get a single collection with its published letters
 */
router.get('/collections/:code', async (req, res, next) => {
  try {
    const { code } = req.params;

    const collection = await getCollectionByCode(code);

    if (!collection) {
      req.log.debug({ collectionCode: code }, 'Collection not found');
      res.status(404).json({ error: 'Collection not found' });
      return;
    }

    // Get published letters in this collection
    const allLetters = await db.query.letters.findMany({
      where: and(
        eq(letters.collectionId, collection.id),
        eq(letters.visibility, 'PUBLISHED')
      ),
      with: {
        collection: true,
        pages: {
          orderBy: (p, { asc }) => [asc(p.pageNumber)],
        },
      },
      orderBy: [publicCatalogueChronologySql(letters.dateRaw, letters.collectionId, letters.typeSequence)],
    });

    // Group by (dateRaw, typeSequence) to merge companions into primaries.
    // Primary = L-type (or first in group if no L-type).
    // Related items (covers, photos, etc.) get their images appended.
    const catalogueLetters = retainRowsWithPublicCatalogueRoot(allLetters);
    const groupMap = new Map<string, (typeof catalogueLetters)[number][]>();
    for (const letter of catalogueLetters) {
      const key = `${letter.dateRaw}|${letter.typeSequence}`;
      const group = groupMap.get(key);
      if (group) {
        group.push(letter);
      } else {
        groupMap.set(key, [letter]);
      }
    }

    const enrichedResults: Array<{ letter: LetterWithRelations; relatedItems: LetterWithRelations[] }> = [];
    for (const [, group] of groupMap) {
      const primary = selectPublicCatalogueRepresentative(group);
      if (!primary) continue;

      const relatedItems = group.filter((l) => l.id !== primary.id);
      enrichedResults.push({
        letter: primary as LetterWithRelations,
        relatedItems: relatedItems as LetterWithRelations[],
      });
    }

    if (enrichedResults.length === 0) {
      req.log.debug({ collectionCode: code }, 'Collection has no public catalogue units');
      res.status(404).json({ error: 'Collection not found' });
      return;
    }

    const collectionDtos = transformLettersWithRelatedToDTO(enrichedResults);
    const collectionLetters = collectionDtos.map((dto, index) => {
      const unit = enrichedResults[index];
      return toPublicLetter(dto, {
        photoOnly: isPhotoOnlyCatalogueUnit([unit.letter, ...unit.relatedItems]),
      });
    });

    req.log.debug(
      { collectionCode: code, letterCount: collectionLetters.length, rawCount: allLetters.length },
      'Collection fetched with letters'
    );

    const profileSourceCurrent = isVerifiedPublicContent(collection.profileStatus)
      && await collectionProfilePublicationIsCurrent(collection.id);
    const result = {
      ...toPublicCollection(collection, profileSourceCurrent),
      letters: collectionLetters,
      letterCount: collectionLetters.length,
    };
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /collections/:code/profile
 * Get the full collection profile: AI-generated content + computed aggregations
 */
router.get('/collections/:code/profile', async (req, res, next) => {
  try {
    const { code } = req.params;
    const collection = await getCollectionByCode(code);

    if (!collection) {
      res.status(404).json({ error: 'Collection not found' });
      return;
    }

    const publicCatalogueUnit = await db.query.letters.findFirst({
      where: and(
        eq(letters.collectionId, collection.id),
        eq(letters.visibility, 'PUBLISHED'),
        publicCatalogueLetterTypeSql(letters.type),
      ),
      columns: { id: true },
    });
    if (!publicCatalogueUnit) {
      req.log.debug({ collectionCode: code }, 'Collection has no public catalogue units');
      res.status(404).json({ error: 'Collection not found' });
      return;
    }

    const profilePublishedAtStart = isVerifiedPublicContent(collection.profileStatus)
      && await collectionProfileSourceIsCurrent(
        collection.id,
        collection.profileSourceFingerprint,
      );
    if (
      isVerifiedPublicContent(collection.profileStatus)
      && !profilePublishedAtStart
    ) {
      req.log.info(
        { collectionId: collection.id },
        'Withholding collection profile whose public source corpus changed',
      );
    }
    const [aggregations, publishedProfileRows] = await Promise.all([
      getCollectionAggregations(collection.id),
      profilePublishedAtStart
        ? db.query.letters.findMany({
            where: and(
              eq(letters.collectionId, collection.id),
              eq(letters.visibility, 'PUBLISHED'),
            ),
            columns: {
              id: true,
              collectionId: true,
              dateRaw: true,
              typeSequence: true,
              type: true,
              metadataPublished: true,
            },
          })
        : Promise.resolve([]),
    ]);
    const publicMetadataLetterIds = new Set(
      retainRowsWithPublicCatalogueRoot(publishedProfileRows)
        .filter((letter) => letter.metadataPublished)
        .map((letter) => letter.id),
    );
    const profileCorrespondents = profilePublishedAtStart
      ? normalizeProfileCorrespondents(collection.profileCorrespondents)
      : [];
    const resolvedStartHere = profilePublishedAtStart
      ? await resolveCollectionStartHere(
          collection.id,
          {
            letterId: collection.profileStartHereLetterId,
            reason: collection.profileStartHereReason,
          },
        )
      : { letterId: null, reason: null };

    // Build start-here with letter context if available
    let startHere: { letterId: string; reason: string; hook: string | null; date: string | null } | null = null;
    if (resolvedStartHere.letterId) {
      const startLetter = await db.query.letters.findFirst({
        where: and(
          eq(letters.id, resolvedStartHere.letterId),
          eq(letters.collectionId, collection.id),
          eq(letters.visibility, 'PUBLISHED'),
          eq(letters.metadataPublished, true),
          publicCatalogueLetterTypeSql(letters.type),
        ),
        columns: {
          id: true,
          hook: true,
          letterDate: true,
          dateRaw: true,
          metadataPublished: true,
        },
      });
      if (startLetter) {
        startHere = {
          letterId: resolvedStartHere.letterId,
          reason: resolvedStartHere.reason || '',
          hook: startLetter.metadataPublished ? startLetter.hook : null,
          date: startLetter.letterDate || startLetter.dateRaw,
        };
      }
    }

    const profilePublished = profilePublishedAtStart
      && await collectionProfilePublicationIsCurrent(collection.id);
    if (profilePublishedAtStart && !profilePublished) {
      req.log.info(
        { collectionId: collection.id },
        'Withholding collection profile revoked during public profile read',
      );
    }
    const publicProfileCorrespondents = profilePublished
      ? profileCorrespondents
      : [];

    res.json({
      // AI-generated content
      hook: profilePublished ? collection.hook : null,
      narrative: profilePublished ? collection.profileNarrative : null,
      profileStatus: profilePublished ? 'VERIFIED' : 'EMPTY',
      startHere: profilePublished ? startHere : null,
      readingPaths: profilePublished
        ? filterProfileLetterReferences(collection.profileReadingPaths, publicMetadataLetterIds)
        : [],
      gapAnalysis: profilePublished ? (collection.profileGapAnalysis || []) : [],
      themes: profilePublished
        ? filterProfileLetterReferences(collection.profileThemes, publicMetadataLetterIds)
        : [],
      profileCorrespondents: publicProfileCorrespondents,
      // Computed aggregations
      ...aggregations,
      keyPeople: applyProfileCorrespondentOverrides(
        aggregations.keyPeople,
        publicProfileCorrespondents,
      ),
    });
  } catch (error) {
    next(error);
  }
});

export default router;
