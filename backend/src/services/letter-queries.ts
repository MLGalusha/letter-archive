import { eq, and, inArray, sql, or, ilike, count } from 'drizzle-orm';
import { z } from 'zod';
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

export const adminLettersQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(50),
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
  collection: z.string().optional(),
  search: z.string().optional(),
  sort: z.enum(['createdAt', 'letterDate', 'sender', 'recipient', 'workflow', 'visibility', 'collection']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
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
    transcribed: number;
    metadataReady: number;
    published: number;
    hidden: number;
    transcript: { empty: number; aiDraft: number; edited: number; verified: number };
    metadata: { empty: number; aiDraft: number; edited: number; verified: number };
    extraContent: { empty: number; aiDraft: number; edited: number; verified: number };
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
  // Build base conditions
  const conditions: ReturnType<typeof eq>[] = [
  ];

  // Collection filter - supports partial matching (e.g., "7" matches "007", "017", "107")
  let collectionIds: string[] = [];
  if (query.collection && query.collection !== 'all') {
    // Find all collections whose code ends with the input (for partial matching)
    const matchingCollections = await db.query.collections.findMany({
      where: ilike(collections.collectionCode, `%${query.collection}`),
    });
    if (matchingCollections.length > 0) {
      collectionIds = matchingCollections.map(c => c.id);
      conditions.push(inArray(letters.collectionId, collectionIds));
    } else {
      // No collections found, return empty
      return {
        letters: [],
        pagination: { page: query.page, limit: query.limit, total: 0, totalPages: 0 },
        stats: {
          total: 0, uploaded: 0, transcribed: 0, metadataReady: 0, published: 0, hidden: 0,
          transcript: { empty: 0, aiDraft: 0, edited: 0, verified: 0 },
          metadata: { empty: 0, aiDraft: 0, edited: 0, verified: 0 },
          extraContent: { empty: 0, aiDraft: 0, edited: 0, verified: 0 },
        },
      };
    }
  }

  // Visibility filter ('all' means no filter)
  if (query.visibility && query.visibility !== 'all') {
    conditions.push(eq(letters.visibility, query.visibility));
  }

  // Workflow filter (supports array)
  const workflowValues = query.workflow
    ? Array.isArray(query.workflow) ? query.workflow : [query.workflow]
    : null;
  if (workflowValues && workflowValues.length > 0) {
    conditions.push(inArray(letters.workflow, workflowValues));
  }

  // Search filter (ILIKE on sender, recipient, summary, hook)
  if (query.search && query.search.trim()) {
    const searchTerm = `%${query.search.trim()}%`;
    conditions.push(
      or(
        ilike(letters.sender, searchTerm),
        ilike(letters.recipient, searchTerm),
        ilike(letters.summary, searchTerm),
        ilike(letters.hook, searchTerm)
      )!
    );
  }

  // Date filters - individual components (year, month, day)
  // dateRaw format: "18860314" or "1886XXXX" (8 characters)
  if (query.year) {
    conditions.push(sql`SUBSTRING(${letters.dateRaw}, 1, 4) = ${query.year.toString()}`);
  }
  if (query.month) {
    const monthStr = query.month.toString().padStart(2, '0');
    conditions.push(sql`SUBSTRING(${letters.dateRaw}, 5, 2) = ${monthStr}`);
  }
  if (query.day) {
    const dayStr = query.day.toString().padStart(2, '0');
    conditions.push(sql`SUBSTRING(${letters.dateRaw}, 7, 2) = ${dayStr}`);
  }

  // Date range filters (only apply if individual year/month/day not set to avoid conflicts)
  if (query.dateFrom && !query.year && !query.month && !query.day) {
    conditions.push(sql`REPLACE(${letters.dateRaw}, 'X', '0') >= ${query.dateFrom}`);
  }
  if (query.dateTo && !query.year && !query.month && !query.day) {
    conditions.push(sql`REPLACE(${letters.dateRaw}, 'X', '9') <= ${query.dateTo}`);
  }

  // Content status filters
  if (query.transcriptStatus && query.transcriptStatus.length > 0) {
    conditions.push(inArray(letters.transcriptStatus, query.transcriptStatus));
  }
  if (query.metadataStatus && query.metadataStatus.length > 0) {
    conditions.push(inArray(letters.metadataContentStatus, query.metadataStatus));
  }
  if (query.extraContentStatus && query.extraContentStatus.length > 0) {
    conditions.push(inArray(letters.extraContentStatus, query.extraContentStatus));
  }

  // Calculate stats for the collection (unfiltered by visibility/workflow/search)
  // This lets filter pills show accurate counts
  // Use DISTINCT ON to count unique letter groups, not individual type rows
  const collectionFilter = collectionIds.length > 0
    ? sql`AND collection_id = ANY(ARRAY[${sql.join(collectionIds.map(id => sql`${id}`), sql`, `)}]::uuid[])`
    : sql``;

  const statsResult = await db.execute(sql`
    WITH unique_groups AS (
      SELECT DISTINCT ON (collection_id, date_raw, type_sequence)
        workflow, visibility, transcript_status, metadata_content_status, extra_content_status
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
      COUNT(*) FILTER (WHERE extra_content_status = 'EMPTY') as extra_content_empty,
      COUNT(*) FILTER (WHERE extra_content_status = 'AI_DRAFT') as extra_content_ai_draft,
      COUNT(*) FILTER (WHERE extra_content_status = 'EDITED') as extra_content_edited,
      COUNT(*) FILTER (WHERE extra_content_status = 'VERIFIED') as extra_content_verified
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
  };

  // Build WHERE clause fragments for the raw SQL queries
  // We need to convert Drizzle conditions to raw SQL for DISTINCT ON
  const buildWhereClause = () => {
    const clauses: ReturnType<typeof sql>[] = [sql`TRUE`];

    if (collectionIds.length > 0) {
      clauses.push(sql`collection_id = ANY(ARRAY[${sql.join(collectionIds.map(id => sql`${id}`), sql`, `)}]::uuid[])`);
    }
    if (query.visibility) {
      clauses.push(sql`visibility = ${query.visibility}`);
    }
    if (workflowValues && workflowValues.length > 0) {
      clauses.push(sql`workflow = ANY(ARRAY[${sql.join(workflowValues.map(w => sql`${w}`), sql`, `)}]::text[])`);
    }
    if (query.search && query.search.trim()) {
      const searchTerm = `%${query.search.trim()}%`;
      clauses.push(sql`(sender ILIKE ${searchTerm} OR recipient ILIKE ${searchTerm} OR summary ILIKE ${searchTerm} OR hook ILIKE ${searchTerm})`);
    }
    if (query.year) {
      clauses.push(sql`SUBSTRING(date_raw, 1, 4) = ${query.year.toString()}`);
    }
    if (query.month) {
      const monthStr = query.month.toString().padStart(2, '0');
      clauses.push(sql`SUBSTRING(date_raw, 5, 2) = ${monthStr}`);
    }
    if (query.day) {
      const dayStr = query.day.toString().padStart(2, '0');
      clauses.push(sql`SUBSTRING(date_raw, 7, 2) = ${dayStr}`);
    }
    if (query.dateFrom && !query.year && !query.month && !query.day) {
      clauses.push(sql`REPLACE(date_raw, 'X', '0') >= ${query.dateFrom}`);
    }
    if (query.dateTo && !query.year && !query.month && !query.day) {
      clauses.push(sql`REPLACE(date_raw, 'X', '9') <= ${query.dateTo}`);
    }
    if (query.transcriptStatus && query.transcriptStatus.length > 0) {
      clauses.push(sql`transcript_status = ANY(ARRAY[${sql.join(query.transcriptStatus.map(s => sql`${s}`), sql`, `)}]::content_status[])`);
    }
    if (query.metadataStatus && query.metadataStatus.length > 0) {
      clauses.push(sql`metadata_content_status = ANY(ARRAY[${sql.join(query.metadataStatus.map(s => sql`${s}`), sql`, `)}]::content_status[])`);
    }
    if (query.extraContentStatus && query.extraContentStatus.length > 0) {
      clauses.push(sql`extra_content_status = ANY(ARRAY[${sql.join(query.extraContentStatus.map(s => sql`${s}`), sql`, `)}]::content_status[])`);
    }

    return sql.join(clauses, sql` AND `);
  };

  const whereClause = buildWhereClause();

  // Get total count for filtered results (for pagination)
  // Count unique groups, not individual type rows
  const countResult = await db.execute(sql`
    SELECT COUNT(*) as count FROM (
      SELECT DISTINCT collection_id, date_raw, type_sequence
      FROM letters
      WHERE ${whereClause}
    ) groups
  `);
  const countRows = getRows<{ count: number | bigint }>(countResult);
  const totalFiltered = Number(countRows[0]?.count || 0);
  const totalPages = Math.ceil(totalFiltered / query.limit);

  // Determine sort order direction for raw SQL
  const sortDir = query.sortOrder === 'asc' ? sql`ASC` : sql`DESC`;

  // Build ORDER BY expression for raw SQL
  const getSortExpression = () => {
    switch (query.sort) {
      case 'letterDate':
        return sql`REPLACE(date_raw, 'X', '0')`;
      case 'sender':
        return sql`sender`;
      case 'recipient':
        return sql`recipient`;
      case 'workflow':
        return sql`workflow`;
      case 'visibility':
        return sql`visibility`;
      case 'collection':
        return sql`collection_id`;
      case 'createdAt':
      default:
        return sql`created_at`;
    }
  };

  // Fetch paginated results using DISTINCT ON to get one row per letter group
  // Prefers 'L' type if available, otherwise uses first available type
  const offset = (query.page - 1) * query.limit;

  const representativeIdsResult = await db.execute(sql`
    SELECT id FROM (
      SELECT DISTINCT ON (collection_id, date_raw, type_sequence)
        id, ${getSortExpression()} as sort_key
      FROM letters
      WHERE ${whereClause}
      ORDER BY collection_id, date_raw, type_sequence,
        CASE WHEN type = 'L' THEN 0 ELSE 1 END, type
    ) representatives
    ORDER BY sort_key ${sortDir}
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

  // Count pages for each letter group - both L-type (letters) and non-L-type (extras)
  // All items in a group share collectionId, dateRaw, typeSequence
  const lettersCountMap = new Map<string, number>();
  const extrasCountMap = new Map<string, number>();
  if (results.length > 0) {
    // Build conditions for all items in each group (any type)
    const groupConditions = results.map(letter =>
      and(
        eq(letters.collectionId, letter.collectionId),
        eq(letters.dateRaw, letter.dateRaw),
        eq(letters.typeSequence, letter.typeSequence)
      )
    );

    // Query to count pages grouped by key and whether type='L'
    const pageCounts = await db
      .select({
        collectionId: letters.collectionId,
        dateRaw: letters.dateRaw,
        typeSequence: letters.typeSequence,
        isLType: sql<boolean>`${letters.type} = 'L'`,
        pageCount: count(),
      })
      .from(letters)
      .innerJoin(letterPages, eq(letterPages.letterId, letters.id))
      .where(or(...groupConditions))
      .groupBy(
        letters.collectionId,
        letters.dateRaw,
        letters.typeSequence,
        sql`${letters.type} = 'L'`
      );

    // Build lookup maps: key = "collectionId:dateRaw:typeSequence" -> count
    for (const row of pageCounts) {
      const key = `${row.collectionId}:${row.dateRaw}:${row.typeSequence}`;
      if (row.isLType) {
        lettersCountMap.set(key, row.pageCount);
      } else {
        extrasCountMap.set(key, (extrasCountMap.get(key) || 0) + row.pageCount);
      }
    }
  }

  // Transform to DTOs with letters count and extras count
  const transformedLetters = (results as LetterWithRelations[]).map(letter => {
    const dto = transformLetterToDTO(letter);
    const key = `${letter.collectionId}:${letter.dateRaw}:${letter.typeSequence}`;
    return {
      ...dto,
      lettersCount: lettersCountMap.get(key) || 0,
      extrasCount: extrasCountMap.get(key) || 0,
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
      // Legacy workflow stats (for backward compat)
      uploaded: Number(rawStats.uploaded) + Number(rawStats.transcribing),
      transcribed: Number(rawStats.transcribed) + Number(rawStats.metadataExtracting),
      metadataReady: Number(rawStats.metadataReady),
      // Visibility stats
      published: Number(rawStats.published),
      hidden: Number(rawStats.hidden),
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
    },
  };
}
