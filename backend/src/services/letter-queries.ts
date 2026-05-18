import { eq, and, inArray, sql, or, ilike, count } from 'drizzle-orm';
import { z } from 'zod';
import { PAGINATION } from '../constants/pagination.js';
import { db, letters, letterPages, collections } from '../db/index.js';
import { transformLetterToDTO, transformLetterWithRelatedToDTO, type LetterWithRelations } from '../dto/index.js';

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Helper to extract rows from db.execute result (handles both postgres.js and drizzle formats)
 */
export function getRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}

/**
 * Helper to fetch a letter with its related items (covers, telegrams, ephemera, etc.)
 * and transform it to a DTO with all images properly included.
 *
 * This should be used by any endpoint that returns a letter to the frontend,
 * to ensure the images array includes all related items.
 *
 * @param includeEntities - Also fetch linked persons and places (for detail view)
 */
export async function fetchLetterWithRelatedAndTransform(
  letterId: string,
  includeEntities = true
): Promise<ReturnType<typeof transformLetterWithRelatedToDTO> | null> {
  const letter = await db.query.letters.findFirst({
    where: eq(letters.id, letterId),
    with: {
      collection: true,
      pages: { orderBy: (p, { asc }) => [asc(p.pageNumber)] },
      // Optionally include linked persons/places
      ...(includeEntities ? {
        persons: { with: { person: true } },
        places: { with: { place: true } },
      } : {}),
    },
  });

  if (!letter) return null;

  // Fetch related items (all other types with same date/sequence)
  const related = await db.query.letters.findMany({
    where: and(
      eq(letters.collectionId, letter.collectionId),
      eq(letters.dateRaw, letter.dateRaw),
      eq(letters.typeSequence, letter.typeSequence),
      sql`${letters.type} != ${letter.type}`
    ),
    with: {
      collection: true,
      pages: { orderBy: (p, { asc }) => [asc(p.pageNumber)] },
    },
    orderBy: (l, { asc }) => [asc(l.type)],
  });

  return transformLetterWithRelatedToDTO(letter as LetterWithRelations, related as LetterWithRelations[]);
}

// ============================================================================
// QUERY SCHEMA
// ============================================================================

// Content status enum values for validation
const contentStatusValues = ['EMPTY', 'AI_DRAFT', 'EDITED', 'VERIFIED'] as const;
const missingFieldValues = ['sender', 'recipient', 'date'] as const;
const contentShapeValues = ['extras', 'photos', 'cover', 'telegram', 'card', 'ephemera', 'article', 'diary', 'voice'] as const;
const collectionCodesValue = (val: unknown) => {
  if (typeof val !== 'string') return val;

  const codes = val
    .split(',')
    .map(code => code.trim())
    .filter(Boolean);

  return codes.length > 1 ? codes : val;
};
const adminSortFieldValues = [
  'createdAt',
  'updatedAt',
  'letterDate',
  'sender',
  'recipient',
  'workflow',
  'visibility',
  'collection',
  'lastOpenedAt',
  'flagged',
  'letters',
  'extras',
  'photos',
  'cover',
  'telegram',
  'card',
  'ephemera',
  'article',
  'diary',
  'voice',
] as const;
const sortDirectionValues = ['asc', 'desc'] as const;

type ContentShapeValue = typeof contentShapeValues[number];

const contentShapeTypeMap = {
  photos: ['P'],
  cover: ['C'],
  telegram: ['T'],
  card: ['N'],
  ephemera: ['E'],
  article: ['A'],
  diary: ['D'],
  voice: ['V'],
} as const satisfies Record<Exclude<ContentShapeValue, 'extras'>, readonly string[]>;

const commaSeparatedArray = (val: unknown) => {
  if (typeof val === 'string') {
    return val.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return val;
};

const sortRulesValue = (val: unknown) => {
  if (typeof val !== 'string') return val;
  return val
    .split(',')
    .map((rule) => {
      const [field, direction] = rule.split(':').map((part) => part.trim());
      return { field, direction };
    })
    .filter((rule) => rule.field && rule.direction);
};

const sortRuleSchema = z.object({
  field: z.enum(adminSortFieldValues),
  direction: z.enum(sortDirectionValues),
});

const getContentShapeBooleanExpression = (shape: ContentShapeValue) => {
  switch (shape) {
    case 'extras':
      return sql`has_extras = true`;
    case 'photos':
      return sql`has_photos = true`;
    case 'cover':
      return sql`has_cover = true`;
    case 'telegram':
      return sql`has_telegram = true`;
    case 'card':
      return sql`has_card = true`;
    case 'ephemera':
      return sql`has_ephemera = true`;
    case 'article':
      return sql`has_article = true`;
    case 'diary':
      return sql`has_diary = true`;
    case 'voice':
      return sql`has_voice = true`;
  }
};

export const adminLettersQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(PAGINATION.MAX_LIMIT).default(PAGINATION.DEFAULT_LIMIT),
  visibility: z.enum(['PUBLISHED', 'HIDDEN', 'all']).optional(),
  workflow: z.preprocess(
    // Preprocess: split comma-separated string into array BEFORE validation
    (val) => {
      if (typeof val === 'string' && val.includes(',')) {
        return val.split(',');
      }
      return val;
    },
    // Then validate as either single enum or array of enums
    z.union([
      z.enum(['UPLOADED', 'TRANSCRIBING', 'TRANSCRIBED', 'METADATA_EXTRACTING', 'METADATA_DRAFTED', 'REVIEWED']),
      z.array(z.enum(['UPLOADED', 'TRANSCRIBING', 'TRANSCRIBED', 'METADATA_EXTRACTING', 'METADATA_DRAFTED', 'REVIEWED'])),
    ]).optional()
  ),
  collection: z.preprocess(collectionCodesValue, z.union([z.string(), z.array(z.string())]).optional()),
  search: z.string().optional(),
  sort: z.enum(adminSortFieldValues).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  sortRules: z.preprocess(sortRulesValue, z.array(sortRuleSchema).max(8).optional()),
  flagged: z.enum(['all', 'true', 'false']).optional(),
  missing: z.preprocess(commaSeparatedArray, z.array(z.enum(missingFieldValues)).optional()),
  contentShape: z.preprocess(commaSeparatedArray, z.array(z.enum(contentShapeValues)).optional()),
  // Date filters - individual components
  year: z.coerce.number().min(1800).max(2100).optional(),
  month: z.coerce.number().min(1).max(12).optional(),
  day: z.coerce.number().min(1).max(31).optional(),
  // Date range filters (YYYYMMDD format)
  dateFrom: z.string().regex(/^\d{8}$/).optional(),
  dateTo: z.string().regex(/^\d{8}$/).optional(),
  // Content status filters (comma-separated)
  transcriptStatus: z.preprocess(
    (val) => {
      if (typeof val === 'string' && val.includes(',')) {
        return val.split(',');
      }
      return val ? [val] : undefined;
    },
    z.array(z.enum(contentStatusValues)).optional()
  ),
  metadataStatus: z.preprocess(
    (val) => {
      if (typeof val === 'string' && val.includes(',')) {
        return val.split(',');
      }
      return val ? [val] : undefined;
    },
    z.array(z.enum(contentStatusValues)).optional()
  ),
  extraContentStatus: z.preprocess(
    (val) => {
      if (typeof val === 'string' && val.includes(',')) {
        return val.split(',');
      }
      return val ? [val] : undefined;
    },
    z.array(z.enum(contentStatusValues)).optional()
  ),
});

// ============================================================================
// RESPONSE TYPE
// ============================================================================

export interface AdminLettersResponse {
  letters: Array<ReturnType<typeof transformLetterToDTO> & {
    lettersCount: number;
    extrasCount: number;
    photosCount: number;
    lastOpenedAt?: string;
  }>;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  stats: {
    total: number;
    uploaded: number;
    transcribing: number;
    transcribed: number;
    metadataExtracting: number;
    metadataReady: number;
    reviewed: number;
    published: number;
    hidden: number;
    flagged: number;
    transcript: { empty: number; aiDraft: number; edited: number; verified: number };
    metadata: { empty: number; aiDraft: number; edited: number; verified: number };
    extraContent: { empty: number; aiDraft: number; edited: number; verified: number };
    missing: { sender: number; recipient: number; date: number };
    contentShape: {
      extras: number;
      photos: number;
      cover: number;
      telegram: number;
      card: number;
      ephemera: number;
      article: number;
      diary: number;
      voice: number;
    };
  };
}

// ============================================================================
// MAIN QUERY FUNCTION
// ============================================================================

/**
 * Query admin letters with server-side filtering, pagination, and stats.
 *
 * Accepts parsed query params (from adminLettersQuerySchema) and returns
 * the full response object including letters, pagination, and stats.
 */
export async function queryAdminLetters(
  query: z.infer<typeof adminLettersQuerySchema>
): Promise<AdminLettersResponse> {
  const hasExtrasExpression = () => sql`
    EXISTS (
      SELECT 1
      FROM letters extra
      INNER JOIN letter_pages extra_page ON extra_page.letter_id = extra.id
      WHERE extra.collection_id = letters.collection_id
        AND extra.date_raw = letters.date_raw
        AND extra.type_sequence = letters.type_sequence
        AND extra.type != 'L'
    )
  `;
  const hasContentTypeExpression = (types: readonly string[]) => sql`
    EXISTS (
      SELECT 1
      FROM letters extra
      INNER JOIN letter_pages extra_page ON extra_page.letter_id = extra.id
      WHERE extra.collection_id = letters.collection_id
        AND extra.date_raw = letters.date_raw
        AND extra.type_sequence = letters.type_sequence
        AND extra.type = ANY(ARRAY[${sql.join(types.map(type => sql`${type}`), sql`, `)}]::letter_type[])
    )
  `;

  // Collection filter - supports partial matching (e.g., "7" matches "007", "017", "107")
  let collectionIds: string[] = [];
  if (query.collection && query.collection !== 'all') {
    const collectionCodes = Array.isArray(query.collection) ? query.collection : [query.collection];
    // Find all collections whose code ends with the input (for partial matching)
    // Escape SQL LIKE wildcards to prevent unintended pattern matching
    const collectionCodeClauses = collectionCodes.map((collectionCode) => {
      const escapedCollection = collectionCode.replace(/%/g, '\\%').replace(/_/g, '\\_');
      return ilike(collections.collectionCode, `%${escapedCollection}`);
    });
    const matchingCollections = await db.query.collections.findMany({
      where: or(...collectionCodeClauses),
    });
    if (matchingCollections.length > 0) {
      collectionIds = Array.from(new Set(matchingCollections.map(c => c.id)));
    } else {
      // No collections found, return empty
      return {
        letters: [],
        pagination: { page: query.page, limit: query.limit, total: 0, totalPages: 0 },
        stats: {
          total: 0, uploaded: 0, transcribing: 0, transcribed: 0, metadataExtracting: 0, metadataReady: 0, reviewed: 0, published: 0, hidden: 0, flagged: 0,
          transcript: { empty: 0, aiDraft: 0, edited: 0, verified: 0 },
          metadata: { empty: 0, aiDraft: 0, edited: 0, verified: 0 },
          extraContent: { empty: 0, aiDraft: 0, edited: 0, verified: 0 },
          missing: { sender: 0, recipient: 0, date: 0 },
          contentShape: { extras: 0, photos: 0, cover: 0, telegram: 0, card: 0, ephemera: 0, article: 0, diary: 0, voice: 0 },
        },
      };
    }
  }

  // Pre-compute workflow values for buildWhereClause
  const workflowValues = query.workflow
    ? Array.isArray(query.workflow) ? query.workflow : [query.workflow]
    : null;

  // Calculate stats for the collection (unfiltered by visibility/workflow/search)
  // This lets filter pills show accurate counts
  // Use DISTINCT ON to count unique letter groups, not individual type rows
  const collectionFilter = collectionIds.length > 0
    ? sql`AND collection_id = ANY(ARRAY[${sql.join(collectionIds.map(id => sql`${id}`), sql`, `)}]::uuid[])`
    : sql``;

  const statsResult = await db.execute(sql`
    WITH unique_groups AS (
      SELECT DISTINCT ON (collection_id, date_raw, type_sequence)
        workflow,
        visibility,
        transcript_status,
        metadata_content_status,
        extra_content_status,
        flagged,
        sender,
        recipient,
        letter_date,
        date_raw,
        ${hasContentTypeExpression(['P'])} as has_photos,
        ${hasContentTypeExpression(['C'])} as has_cover,
        ${hasContentTypeExpression(['T'])} as has_telegram,
        ${hasContentTypeExpression(['N'])} as has_card,
        ${hasContentTypeExpression(['E'])} as has_ephemera,
        ${hasContentTypeExpression(['A'])} as has_article,
        ${hasContentTypeExpression(['D'])} as has_diary,
        ${hasContentTypeExpression(['V'])} as has_voice,
        ${hasExtrasExpression()} as has_extras
      FROM letters
      WHERE TRUE ${collectionFilter}
      ORDER BY collection_id, date_raw, type_sequence,
        CASE WHEN type = 'L' THEN 0 ELSE 1 END, type
    )
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE workflow = 'UPLOADED') as uploaded,
      COUNT(*) FILTER (WHERE workflow = 'TRANSCRIBING') as transcribing,
      COUNT(*) FILTER (WHERE workflow = 'TRANSCRIBED') as transcribed,
      COUNT(*) FILTER (WHERE workflow = 'METADATA_EXTRACTING') as metadata_extracting,
      COUNT(*) FILTER (WHERE workflow = 'METADATA_DRAFTED') as metadata_ready,
      COUNT(*) FILTER (WHERE workflow = 'REVIEWED') as reviewed,
      COUNT(*) FILTER (WHERE visibility = 'PUBLISHED') as published,
      COUNT(*) FILTER (WHERE visibility = 'HIDDEN') as hidden,
      COUNT(*) FILTER (WHERE transcript_status = 'EMPTY') as transcript_empty,
      COUNT(*) FILTER (WHERE transcript_status = 'AI_DRAFT') as transcript_ai_draft,
      COUNT(*) FILTER (WHERE transcript_status = 'EDITED') as transcript_edited,
      COUNT(*) FILTER (WHERE transcript_status = 'VERIFIED') as transcript_verified,
      COUNT(*) FILTER (WHERE metadata_content_status = 'EMPTY') as metadata_empty,
      COUNT(*) FILTER (WHERE metadata_content_status = 'AI_DRAFT') as metadata_ai_draft,
      COUNT(*) FILTER (WHERE metadata_content_status = 'EDITED') as metadata_edited,
      COUNT(*) FILTER (WHERE metadata_content_status = 'VERIFIED') as metadata_verified,
      COUNT(*) FILTER (WHERE has_extras AND extra_content_status = 'EMPTY') as extra_content_empty,
      COUNT(*) FILTER (WHERE has_extras AND extra_content_status = 'AI_DRAFT') as extra_content_ai_draft,
      COUNT(*) FILTER (WHERE has_extras AND extra_content_status = 'EDITED') as extra_content_edited,
      COUNT(*) FILTER (WHERE has_extras AND extra_content_status = 'VERIFIED') as extra_content_verified,
      COUNT(*) FILTER (WHERE sender IS NULL OR BTRIM(sender) = '') as missing_sender,
      COUNT(*) FILTER (WHERE recipient IS NULL OR BTRIM(recipient) = '') as missing_recipient,
      COUNT(*) FILTER (WHERE letter_date IS NULL) as missing_date,
      COUNT(*) FILTER (WHERE has_extras) as has_extras_count,
      COUNT(*) FILTER (WHERE has_photos) as has_photos_count,
      COUNT(*) FILTER (WHERE has_cover) as has_cover_count,
      COUNT(*) FILTER (WHERE has_telegram) as has_telegram_count,
      COUNT(*) FILTER (WHERE has_card) as has_card_count,
      COUNT(*) FILTER (WHERE has_ephemera) as has_ephemera_count,
      COUNT(*) FILTER (WHERE has_article) as has_article_count,
      COUNT(*) FILTER (WHERE has_diary) as has_diary_count,
      COUNT(*) FILTER (WHERE has_voice) as has_voice_count,
      COUNT(*) FILTER (WHERE flagged = true) as flagged_count
    FROM unique_groups
  `);

  const statsRows = getRows<Record<string, number | string | bigint>>(statsResult);
  const statsRow = statsRows[0] || {};
  const rawStats = {
    total: Number(statsRow.total || 0),
    uploaded: Number(statsRow.uploaded || 0),
    transcribing: Number(statsRow.transcribing || 0),
    transcribed: Number(statsRow.transcribed || 0),
    metadataExtracting: Number(statsRow.metadata_extracting || 0),
    metadataReady: Number(statsRow.metadata_ready || 0),
    reviewed: Number(statsRow.reviewed || 0),
    published: Number(statsRow.published || 0),
    hidden: Number(statsRow.hidden || 0),
    transcriptEmpty: Number(statsRow.transcript_empty || 0),
    transcriptAiDraft: Number(statsRow.transcript_ai_draft || 0),
    transcriptEdited: Number(statsRow.transcript_edited || 0),
    transcriptVerified: Number(statsRow.transcript_verified || 0),
    metadataEmpty: Number(statsRow.metadata_empty || 0),
    metadataAiDraft: Number(statsRow.metadata_ai_draft || 0),
    metadataEdited: Number(statsRow.metadata_edited || 0),
    metadataVerified: Number(statsRow.metadata_verified || 0),
    extraContentEmpty: Number(statsRow.extra_content_empty || 0),
    extraContentAiDraft: Number(statsRow.extra_content_ai_draft || 0),
    extraContentEdited: Number(statsRow.extra_content_edited || 0),
    extraContentVerified: Number(statsRow.extra_content_verified || 0),
    missingSender: Number(statsRow.missing_sender || 0),
    missingRecipient: Number(statsRow.missing_recipient || 0),
    missingDate: Number(statsRow.missing_date || 0),
    hasExtras: Number(statsRow.has_extras_count || 0),
    hasPhotos: Number(statsRow.has_photos_count || 0),
    hasCover: Number(statsRow.has_cover_count || 0),
    hasTelegram: Number(statsRow.has_telegram_count || 0),
    hasCard: Number(statsRow.has_card_count || 0),
    hasEphemera: Number(statsRow.has_ephemera_count || 0),
    hasArticle: Number(statsRow.has_article_count || 0),
    hasDiary: Number(statsRow.has_diary_count || 0),
    hasVoice: Number(statsRow.has_voice_count || 0),
    flaggedCount: Number(statsRow.flagged_count || 0),
  };

  // Build WHERE clause fragments for the raw SQL queries.
  // Representative-specific filters are applied after DISTINCT ON so they match
  // the primary row (preferring type='L'), not arbitrary extra rows in a group.
  const buildWhereClause = () => {
    const clauses: ReturnType<typeof sql>[] = [sql`TRUE`];

    if (collectionIds.length > 0) {
      clauses.push(sql`collection_id = ANY(ARRAY[${sql.join(collectionIds.map(id => sql`${id}`), sql`, `)}]::uuid[])`);
    }
    if (query.visibility && query.visibility !== 'all') {
      clauses.push(sql`visibility = ${query.visibility}`);
    }
    if (query.search && query.search.trim()) {
      const searchTerm = `%${query.search.trim()}%`;
      clauses.push(sql`(sender ILIKE ${searchTerm} OR recipient ILIKE ${searchTerm} OR summary ILIKE ${searchTerm} OR hook ILIKE ${searchTerm})`);
    }
    if (query.year) {
      // Build regex so X in date_raw matches any digit: year 1856 matches 1856, 185X, 18XX, etc.
      const yearStr = query.year.toString().padStart(4, '0');
      const yearPattern = '^' + yearStr.split('').map(ch => `[${ch}X]`).join('') + '$';
      clauses.push(sql`SUBSTRING(date_raw, 1, 4) ~ ${yearPattern}`);
    }
    if (query.month) {
      const monthStr = query.month.toString().padStart(2, '0');
      const monthPattern = '^' + monthStr.split('').map(ch => `[${ch}X]`).join('') + '$';
      clauses.push(sql`SUBSTRING(date_raw, 5, 2) ~ ${monthPattern}`);
    }
    if (query.day) {
      const dayStr = query.day.toString().padStart(2, '0');
      const dayPattern = '^' + dayStr.split('').map(ch => `[${ch}X]`).join('') + '$';
      clauses.push(sql`SUBSTRING(date_raw, 7, 2) ~ ${dayPattern}`);
    }
    if (query.dateFrom && !query.year && !query.month && !query.day) {
      clauses.push(sql`REPLACE(date_raw, 'X', '0') >= ${query.dateFrom}`);
    }
    if (query.dateTo && !query.year && !query.month && !query.day) {
      clauses.push(sql`REPLACE(date_raw, 'X', '9') <= ${query.dateTo}`);
    }
    if (query.flagged === 'true') clauses.push(sql`flagged = true`);
    else if (query.flagged === 'false') clauses.push(sql`flagged = false`);

    return sql.join(clauses, sql` AND `);
  };

  const buildRepresentativeFilterClause = () => {
    const clauses: ReturnType<typeof sql>[] = [];
    if (workflowValues && workflowValues.length > 0) {
      clauses.push(sql`workflow = ANY(ARRAY[${sql.join(workflowValues.map(w => sql`${w}`), sql`, `)}]::workflow_state[])`);
    }
    if (query.transcriptStatus && query.transcriptStatus.length > 0) {
      clauses.push(sql`transcript_status = ANY(ARRAY[${sql.join(query.transcriptStatus.map(s => sql`${s}`), sql`, `)}]::content_status[])`);
    }
    if (query.metadataStatus && query.metadataStatus.length > 0) {
      clauses.push(sql`metadata_content_status = ANY(ARRAY[${sql.join(query.metadataStatus.map(s => sql`${s}`), sql`, `)}]::content_status[])`);
    }
    if (query.extraContentStatus && query.extraContentStatus.length > 0) {
      clauses.push(sql`has_extras = true AND extra_content_status = ANY(ARRAY[${sql.join(query.extraContentStatus.map(s => sql`${s}`), sql`, `)}]::content_status[])`);
    }
    if (query.missing && query.missing.length > 0) {
      const missingClauses = query.missing.map((field) => {
        switch (field) {
          case 'sender':
            return sql`sender IS NULL OR BTRIM(sender) = ''`;
          case 'recipient':
            return sql`recipient IS NULL OR BTRIM(recipient) = ''`;
          case 'date':
            return sql`letter_date IS NULL`;
        }
      });
      clauses.push(sql`(${sql.join(missingClauses, sql` OR `)})`);
    }
    if (query.contentShape && query.contentShape.length > 0) {
      const shapeClauses = query.contentShape.map(getContentShapeBooleanExpression);
      clauses.push(sql`(${sql.join(shapeClauses, sql` OR `)})`);
    }
    return clauses.length > 0
      ? sql`WHERE ${sql.join(clauses, sql` AND `)}`
      : sql``;
  };

  const whereClause = buildWhereClause();
  const representativeFilterClause = buildRepresentativeFilterClause();

  // Get total count for filtered results (for pagination)
  // DISTINCT ON picks representative per group, then representative filters apply.
  const countResult = await db.execute(sql`
    SELECT COUNT(*) as count FROM (
      SELECT DISTINCT ON (collection_id, date_raw, type_sequence)
        workflow,
        transcript_status,
        metadata_content_status,
        extra_content_status,
        sender,
        recipient,
        letter_date,
        ${hasContentTypeExpression(['P'])} as has_photos,
        ${hasContentTypeExpression(['C'])} as has_cover,
        ${hasContentTypeExpression(['T'])} as has_telegram,
        ${hasContentTypeExpression(['N'])} as has_card,
        ${hasContentTypeExpression(['E'])} as has_ephemera,
        ${hasContentTypeExpression(['A'])} as has_article,
        ${hasContentTypeExpression(['D'])} as has_diary,
        ${hasContentTypeExpression(['V'])} as has_voice,
        ${hasExtrasExpression()} as has_extras
      FROM letters
      WHERE ${whereClause}
      ORDER BY collection_id, date_raw, type_sequence,
        CASE WHEN type = 'L' THEN 0 ELSE 1 END, type
    ) representatives
    ${representativeFilterClause}
  `);
  const countRows = getRows<{ count: number | bigint }>(countResult);
  const totalFiltered = Number(countRows[0]?.count || 0);
  const totalPages = Math.ceil(totalFiltered / query.limit);

  const sortRules = query.sortRules && query.sortRules.length > 0
    ? query.sortRules
    : [{ field: query.sort, direction: query.sortOrder }];

  const getSortDirection = (direction: 'asc' | 'desc') => direction === 'asc' ? sql`ASC` : sql`DESC`;
  const countGroupPagesForTypes = (types: readonly string[]) => sql`(
    SELECT COUNT(*)
    FROM letters count_item
    INNER JOIN letter_pages count_page ON count_page.letter_id = count_item.id
    WHERE count_item.collection_id = filtered.collection_id
      AND count_item.date_raw = filtered.date_raw
      AND count_item.type_sequence = filtered.type_sequence
      AND count_item.type = ANY(ARRAY[${sql.join(types.map(type => sql`${type}`), sql`, `)}]::letter_type[])
  )`;

  const getSortExpression = (field: typeof adminSortFieldValues[number]) => {
    switch (field) {
      case 'letterDate':
        return sql`REPLACE(filtered.date_raw, 'X', '0')`;
      case 'sender':
        return sql`filtered.sender`;
      case 'recipient':
        return sql`filtered.recipient`;
      case 'workflow':
        return sql`filtered.workflow`;
      case 'visibility':
        return sql`filtered.visibility`;
      case 'collection':
        return sql`(SELECT collection_code FROM collections c WHERE c.id = filtered.collection_id)`;
      case 'updatedAt':
        return sql`filtered.updated_at`;
      case 'lastOpenedAt':
        return sql`COALESCE((SELECT last_opened_at FROM letter_views WHERE letter_id = filtered.id), '1970-01-01'::timestamptz)`;
      case 'flagged':
        return sql`filtered.flagged`;
      case 'letters':
        return sql`(
          SELECT COUNT(*)
          FROM letters count_letter
          INNER JOIN letter_pages count_page ON count_page.letter_id = count_letter.id
          WHERE count_letter.collection_id = filtered.collection_id
            AND count_letter.date_raw = filtered.date_raw
            AND count_letter.type_sequence = filtered.type_sequence
            AND count_letter.type = 'L'
        )`;
      case 'extras':
        return sql`(
          SELECT COUNT(*)
          FROM letters count_extra
          INNER JOIN letter_pages count_page ON count_page.letter_id = count_extra.id
          WHERE count_extra.collection_id = filtered.collection_id
            AND count_extra.date_raw = filtered.date_raw
            AND count_extra.type_sequence = filtered.type_sequence
            AND count_extra.type != 'L'
        )`;
      case 'photos':
      case 'cover':
      case 'telegram':
      case 'card':
      case 'ephemera':
      case 'article':
      case 'diary':
      case 'voice':
        return countGroupPagesForTypes(contentShapeTypeMap[field]);
      case 'createdAt':
      default:
        return sql`filtered.created_at`;
    }
  };

  const sortClause = sql.join(
    sortRules.map((rule) => sql`${getSortExpression(rule.field)} ${getSortDirection(rule.direction)} NULLS LAST`),
    sql`, `,
  );

  // Fetch paginated results using DISTINCT ON to get one row per letter group
  // Prefers 'L' type if available, otherwise uses first available type
  const offset = (query.page - 1) * query.limit;

  // Representative filters are applied as a post-DISTINCT-ON WHERE so they
  // match the representative row, not a stray extra-content row in the group.
  const representativeIdsResult = await db.execute(sql`
    SELECT id FROM (
      SELECT * FROM (
        SELECT DISTINCT ON (collection_id, date_raw, type_sequence)
          id, collection_id, date_raw, type_sequence, sender, recipient, workflow, visibility, flagged, created_at, updated_at, letter_date,
          transcript_status, metadata_content_status, extra_content_status,
          ${hasContentTypeExpression(['P'])} as has_photos,
          ${hasContentTypeExpression(['C'])} as has_cover,
          ${hasContentTypeExpression(['T'])} as has_telegram,
          ${hasContentTypeExpression(['N'])} as has_card,
          ${hasContentTypeExpression(['E'])} as has_ephemera,
          ${hasContentTypeExpression(['A'])} as has_article,
          ${hasContentTypeExpression(['D'])} as has_diary,
          ${hasContentTypeExpression(['V'])} as has_voice,
          ${hasExtrasExpression()} as has_extras
        FROM letters
        WHERE ${whereClause}
        ORDER BY collection_id, date_raw, type_sequence,
          CASE WHEN type = 'L' THEN 0 ELSE 1 END, type
      ) representatives
      ${representativeFilterClause}
    ) filtered
    ORDER BY ${sortClause}, filtered.id ASC
    LIMIT ${query.limit}
    OFFSET ${offset}
  `);

  const representativeRows = getRows<{ id: string }>(representativeIdsResult);
  const representativeIds = representativeRows.map(r => r.id);

  // Fetch full letter data with relations using the representative IDs
  let results: Awaited<ReturnType<typeof db.query.letters.findMany>> = [];
  if (representativeIds.length > 0) {
    results = await db.query.letters.findMany({
      where: inArray(letters.id, representativeIds),
      with: {
        collection: true,
        pages: {
          orderBy: (p, { asc: pageAsc }) => [pageAsc(p.pageNumber)],
        },
      },
    });

    // Re-sort results to match the SQL order (Drizzle doesn't preserve inArray order)
    const idOrder = new Map(representativeIds.map((id: string, idx: number) => [id, idx]));
    results.sort((a, b) => (idOrder.get(a.id) ?? 0) - (idOrder.get(b.id) ?? 0));
  }

  // Batch-fetch lastOpenedAt from letter_views (separate table)
  const viewMap = new Map<string, string>();
  if (representativeIds.length > 0) {
    const viewRows = getRows<{ letter_id: string; last_opened_at: Date }>(
      await db.execute(sql`
        SELECT letter_id, last_opened_at FROM letter_views
        WHERE letter_id IN (${sql.join(representativeIds.map(id => sql`${id}`), sql`, `)})
      `)
    );
    for (const v of viewRows) {
      viewMap.set(v.letter_id, v.last_opened_at instanceof Date ? v.last_opened_at.toISOString() : String(v.last_opened_at));
    }
  }

  // Count pages for each letter group, keeping photos available as a subset of extras.
  // All items in a group share collectionId, dateRaw, typeSequence
  const lettersCountMap = new Map<string, number>();
  const extrasCountMap = new Map<string, number>();
  const photosCountMap = new Map<string, number>();
  if (results.length > 0) {
    // Build conditions for all items in each group (any type)
    const groupConditions = results.map(letter =>
      and(
        eq(letters.collectionId, letter.collectionId),
        eq(letters.dateRaw, letter.dateRaw),
        eq(letters.typeSequence, letter.typeSequence)
      )
    );

    // Query to count pages grouped by key and type
    const pageCounts = await db
      .select({
        collectionId: letters.collectionId,
        dateRaw: letters.dateRaw,
        typeSequence: letters.typeSequence,
        type: letters.type,
        pageCount: count(),
      })
      .from(letters)
      .innerJoin(letterPages, eq(letterPages.letterId, letters.id))
      .where(or(...groupConditions))
      .groupBy(
        letters.collectionId,
        letters.dateRaw,
        letters.typeSequence,
        letters.type
      );

    // Build lookup maps: key = "collectionId:dateRaw:typeSequence" -> count
    for (const row of pageCounts) {
      const key = `${row.collectionId}:${row.dateRaw}:${row.typeSequence}`;
      if (row.type === 'L') {
        lettersCountMap.set(key, row.pageCount);
      } else {
        extrasCountMap.set(key, (extrasCountMap.get(key) || 0) + row.pageCount);
        if (row.type === 'P') {
          photosCountMap.set(key, (photosCountMap.get(key) || 0) + row.pageCount);
        }
      }
    }
  }

  // Transform to DTOs with letters count, extras count, and photo count
  const transformedLetters = (results as LetterWithRelations[]).map(letter => {
    const dto = transformLetterToDTO(letter);
    const key = `${letter.collectionId}:${letter.dateRaw}:${letter.typeSequence}`;
    return {
      ...dto,
      lettersCount: lettersCountMap.get(key) || 0,
      extrasCount: extrasCountMap.get(key) || 0,
      photosCount: photosCountMap.get(key) || 0,
      lastOpenedAt: viewMap.get(letter.id),
    };
  });

  return {
    letters: transformedLetters,
    pagination: {
      page: query.page,
      limit: query.limit,
      total: totalFiltered,
      totalPages,
    },
    stats: {
      // Total
      total: Number(rawStats.total),
      // Workflow stats
      uploaded: Number(rawStats.uploaded),
      transcribing: Number(rawStats.transcribing),
      transcribed: Number(rawStats.transcribed),
      metadataExtracting: Number(rawStats.metadataExtracting),
      metadataReady: Number(rawStats.metadataReady),
      reviewed: Number(rawStats.reviewed),
      // Visibility stats
      published: Number(rawStats.published),
      hidden: Number(rawStats.hidden),
      // Flagged count
      flagged: Number(rawStats.flaggedCount),
      // Two-track transcript stats
      transcript: {
        empty: Number(rawStats.transcriptEmpty),
        aiDraft: Number(rawStats.transcriptAiDraft),
        edited: Number(rawStats.transcriptEdited),
        verified: Number(rawStats.transcriptVerified),
      },
      // Two-track metadata stats
      metadata: {
        empty: Number(rawStats.metadataEmpty),
        aiDraft: Number(rawStats.metadataAiDraft),
        edited: Number(rawStats.metadataEdited),
        verified: Number(rawStats.metadataVerified),
      },
      // Extra content stats
      extraContent: {
        empty: Number(rawStats.extraContentEmpty),
        aiDraft: Number(rawStats.extraContentAiDraft),
        edited: Number(rawStats.extraContentEdited),
        verified: Number(rawStats.extraContentVerified),
      },
      missing: {
        sender: Number(rawStats.missingSender),
        recipient: Number(rawStats.missingRecipient),
        date: Number(rawStats.missingDate),
      },
      contentShape: {
        extras: Number(rawStats.hasExtras),
        photos: Number(rawStats.hasPhotos),
        cover: Number(rawStats.hasCover),
        telegram: Number(rawStats.hasTelegram),
        card: Number(rawStats.hasCard),
        ephemera: Number(rawStats.hasEphemera),
        article: Number(rawStats.hasArticle),
        diary: Number(rawStats.hasDiary),
        voice: Number(rawStats.hasVoice),
      },
    },
  };
}
