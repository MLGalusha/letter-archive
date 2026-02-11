import { Router } from 'express';
import { eq, and, isNull, isNotNull, inArray, sql, or, ilike, count } from 'drizzle-orm';
import { z } from 'zod';
import { db, letters, letterPages, collections, letterVersions, letterPersons, canonicalPersons, letterPlaces, canonicalPlaces } from '../../db/index.js';
import { getLetterById, resetLetterForProcessing } from '../../services/letters.js';
import { transformLetterToDTO, transformLetterWithRelatedToDTO, type LetterWithRelations } from '../../dto/index.js';
import { processLetter, processMetadata, runTranscription } from '../../pipeline/processor.js';
import { runMetadataExtractionV2, runEntityExtractionOnly } from '../../pipeline/metadataV2.js';
import { resyncMetadata, auditMetadata, type MetadataAuditContext, type LinkedPersonInfo } from '../../ai/resync.js';
import { checkExtraContentForText, transcribeExtraContent } from '../../ai/openai.js';
import { createLogger } from '../../utils/logger.js';
import { env } from '../../config/env.js';

const log = createLogger({ module: 'admin-letters' });
const router = Router();

// Helper to extract rows from db.execute result (handles both postgres.js and drizzle formats)
function getRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}

// ============================================================================
// ENUM VALIDATION HELPERS
// ============================================================================

// Content status enum values for validation
const contentStatusValues = ['EMPTY', 'AI_DRAFT', 'EDITED', 'VERIFIED'] as const;

// Valid relationship types for the database enum
const VALID_RELATIONSHIP_TYPES = [
  'spouse', 'fiancé/fiancée', 'romantic-partner', 'parent', 'child', 'sibling',
  'grandparent', 'grandchild', 'aunt/uncle', 'nephew/niece', 'cousin', 'in-law',
  'friend', 'acquaintance', 'business-associate', 'employer', 'employee', 'unknown'
] as const;

type RelationshipType = typeof VALID_RELATIONSHIP_TYPES[number];

/**
 * Normalize and validate AI-generated relationship type to match database enum.
 * Returns null if the value cannot be mapped to a valid enum.
 */
function normalizeRelationshipType(value: string | null | undefined): RelationshipType | null {
  if (!value) return null;

  const normalized = value.toLowerCase().trim();

  // Direct match
  if (VALID_RELATIONSHIP_TYPES.includes(normalized as RelationshipType)) {
    return normalized as RelationshipType;
  }

  // Common AI variations that need mapping
  const mappings: Record<string, RelationshipType> = {
    'romantic partners': 'romantic-partner',
    'romantic partner': 'romantic-partner',
    'partners': 'romantic-partner',
    'partner': 'romantic-partner',
    'fiance': 'fiancé/fiancée',
    'fiancee': 'fiancé/fiancée',
    'fianc': 'fiancé/fiancée',
    'engaged': 'fiancé/fiancée',
    'married': 'spouse',
    'husband': 'spouse',
    'wife': 'spouse',
    'mom': 'parent',
    'dad': 'parent',
    'mother': 'parent',
    'father': 'parent',
    'son': 'child',
    'daughter': 'child',
    'brother': 'sibling',
    'sister': 'sibling',
    'grandmother': 'grandparent',
    'grandfather': 'grandparent',
    'grandson': 'grandchild',
    'granddaughter': 'grandchild',
    'aunt': 'aunt/uncle',
    'uncle': 'aunt/uncle',
    'niece': 'nephew/niece',
    'nephew': 'nephew/niece',
    'business associate': 'business-associate',
    'colleague': 'business-associate',
    'coworker': 'business-associate',
    'co-worker': 'business-associate',
    'boss': 'employer',
    'manager': 'employer',
  };

  if (mappings[normalized]) {
    return mappings[normalized];
  }

  // If we can't map it, return unknown rather than failing
  log.warn({ original: value, normalized }, 'Unknown relationship type from AI, defaulting to unknown');
  return 'unknown';
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
async function fetchLetterWithRelatedAndTransform(
  letterId: string,
  includeEntities = true
): Promise<ReturnType<typeof transformLetterWithRelatedToDTO> | null> {
  const letter = await db.query.letters.findFirst({
    where: and(eq(letters.id, letterId), isNull(letters.deletedAt)),
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
      sql`${letters.type} != ${letter.type}`,
      isNull(letters.deletedAt)
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
// ADMIN LETTERS LIST WITH SERVER-SIDE FILTERING + PAGINATION
// ============================================================================

const adminLettersQuerySchema = z.object({
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

/**
 * GET /admin/letters - List letters with server-side filtering, pagination, and stats
 *
 * Query params:
 * - page: Page number (default 1)
 * - limit: Items per page (default 50, max 100)
 * - visibility: 'PUBLISHED' | 'HIDDEN'
 * - workflow: Single value or comma-separated list of workflow states
 * - collection: Collection code (or 'all')
 * - search: Search term for sender/recipient/title
 * - sort: Sort field
 * - sortOrder: 'asc' | 'desc'
 *
 * Response includes:
 * - letters: Paginated letter list
 * - pagination: { page, limit, total, totalPages }
 * - stats: Counts for the collection (not affected by filters except collection)
 */
router.get('/letters', async (req, res, next) => {
  const start = Date.now();
  try {
    const query = adminLettersQuerySchema.parse(req.query);

    req.log.debug(
      { collection: query.collection, visibility: query.visibility, workflow: query.workflow, search: query.search, page: query.page },
      'Admin letters list query'
    );

    // Build base conditions
    const conditions: ReturnType<typeof eq>[] = [
      isNull(letters.deletedAt),
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
        res.json({
          letters: [],
          pagination: { page: query.page, limit: query.limit, total: 0, totalPages: 0 },
          stats: { total: 0, uploaded: 0, transcribed: 0, metadataReady: 0, published: 0, hidden: 0 },
        });
        return;
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
      // Match year at the start of dateRaw
      conditions.push(sql`SUBSTRING(${letters.dateRaw}, 1, 4) = ${query.year.toString()}`);
    }
    if (query.month) {
      // Match month (positions 5-6 in YYYYMMDD format)
      const monthStr = query.month.toString().padStart(2, '0');
      conditions.push(sql`SUBSTRING(${letters.dateRaw}, 5, 2) = ${monthStr}`);
    }
    if (query.day) {
      // Match day (positions 7-8 in YYYYMMDD format)
      const dayStr = query.day.toString().padStart(2, '0');
      conditions.push(sql`SUBSTRING(${letters.dateRaw}, 7, 2) = ${dayStr}`);
    }

    // Date range filters (only apply if individual year/month/day not set to avoid conflicts)
    if (query.dateFrom && !query.year && !query.month && !query.day) {
      // Filter dateRaw >= dateFrom (treating X as 0 for comparison)
      conditions.push(sql`REPLACE(${letters.dateRaw}, 'X', '0') >= ${query.dateFrom}`);
    }
    if (query.dateTo && !query.year && !query.month && !query.day) {
      // Filter dateRaw <= dateTo (treating X as 9 for end range)
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
        WHERE deleted_at IS NULL ${collectionFilter}
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
    const stats = {
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
      const clauses: ReturnType<typeof sql>[] = [sql`deleted_at IS NULL`];

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
          eq(letters.typeSequence, letter.typeSequence),
          isNull(letters.deletedAt)
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

    const duration = Date.now() - start;
    req.log.info(
      { resultCount: transformedLetters.length, total: totalFiltered, page: query.page, duration },
      'Admin letters list completed'
    );

    res.json({
      letters: transformedLetters,
      pagination: {
        page: query.page,
        limit: query.limit,
        total: totalFiltered,
        totalPages,
      },
      stats: {
        // Total
        total: Number(stats.total),
        // Legacy workflow stats (for backward compat)
        uploaded: Number(stats.uploaded) + Number(stats.transcribing),
        transcribed: Number(stats.transcribed) + Number(stats.metadataExtracting),
        metadataReady: Number(stats.metadataReady),
        // Visibility stats
        published: Number(stats.published),
        hidden: Number(stats.hidden),
        // Two-track transcript stats
        transcript: {
          empty: Number(stats.transcriptEmpty),
          aiDraft: Number(stats.transcriptAiDraft),
          edited: Number(stats.transcriptEdited),
          verified: Number(stats.transcriptVerified),
        },
        // Two-track metadata stats
        metadata: {
          empty: Number(stats.metadataEmpty),
          aiDraft: Number(stats.metadataAiDraft),
          edited: Number(stats.metadataEdited),
          verified: Number(stats.metadataVerified),
        },
        // Extra content stats
        extraContent: {
          empty: Number(stats.extraContentEmpty),
          aiDraft: Number(stats.extraContentAiDraft),
          edited: Number(stats.extraContentEdited),
          verified: Number(stats.extraContentVerified),
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// ON-DEMAND PROCESSING STATE AND FUNCTIONS
// ============================================================================

interface ProcessingState {
  isRunning: boolean;
  isPaused: boolean;
  shouldAbort: boolean;
  currentJob: { letterId: string; type: 'transcription' | 'metadata' } | null;
  completed: number;
  failed: number;
  total: number;
  errors: string[];
  lastCompletedAt: number | null;  // timestamp for live updates
}

let processingState: ProcessingState = {
  isRunning: false,
  isPaused: false,
  shouldAbort: false,
  currentJob: null,
  completed: 0,
  failed: 0,
  total: 0,
  errors: [],
  lastCompletedAt: null,
};

/**
 * Async processing function that runs in the background.
 */
async function processLettersAsync(letterIds: string[], type: 'transcription' | 'metadata') {
  log.info({ type, letterCount: letterIds.length }, 'Starting async processing batch');
  const batchStart = Date.now();

  for (const letterId of letterIds) {
    // Check for abort
    if (processingState.shouldAbort) {
      log.info({ type, completed: processingState.completed, failed: processingState.failed }, 'Processing aborted');
      processingState.isRunning = false;
      break;
    }

    // Wait while paused
    if (processingState.isPaused) {
      log.info({ type, letterId }, 'Processing paused');
    }
    while (processingState.isPaused && !processingState.shouldAbort) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (processingState.isPaused === false && processingState.shouldAbort === false) {
      // Resumed
    }

    if (processingState.shouldAbort) {
      log.info({ type, completed: processingState.completed, failed: processingState.failed }, 'Processing aborted after pause');
      processingState.isRunning = false;
      break;
    }

    processingState.currentJob = { letterId, type };
    const jobStart = Date.now();

    try {
      if (type === 'transcription') {
        await processLetter(letterId);
      } else {
        await processMetadata(letterId);
      }
      processingState.completed++;
      processingState.lastCompletedAt = Date.now();
      const jobDuration = Date.now() - jobStart;
      log.debug({ letterId, type, duration: jobDuration, progress: `${processingState.completed}/${processingState.total}` }, 'Job completed');
    } catch (error) {
      processingState.failed++;
      processingState.lastCompletedAt = Date.now();
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      processingState.errors.push(`${letterId}: ${errorMessage}`);
      log.error({ letterId, type, err: error }, 'Job failed');
    }
  }

  const batchDuration = Date.now() - batchStart;
  log.info(
    {
      type,
      total: processingState.total,
      completed: processingState.completed,
      failed: processingState.failed,
      duration: batchDuration,
    },
    'Async processing batch finished'
  );

  processingState.isRunning = false;
  processingState.currentJob = null;
}

/**
 * GET /admin/processing/status - Get current processing status
 */
router.get('/processing/status', (_req, res) => {
  res.json(processingState);
});

/**
 * GET /admin/processing/queue - Get full queue status with active, queued, and recent jobs
 */
router.get('/processing/queue', async (_req, res, next) => {
  try {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    // Active jobs: any status = RUNNING
    const activeLetters = await db.query.letters.findMany({
      where: and(
        isNull(letters.deletedAt),
        or(
          eq(letters.transcriptionStatus, 'RUNNING'),
          eq(letters.metadataStatus, 'RUNNING'),
          eq(letters.entityExtractionStatus, 'RUNNING')
        )
      ),
      with: { collection: true },
    });

    const active = activeLetters.flatMap(l => {
      const jobs: Array<{
        letterId: string;
        letterTitle: string;
        collectionCode: string;
        sender: string | null;
        recipient: string | null;
        type: string;
        startedAt: string;
      }> = [];
      if (l.transcriptionStatus === 'RUNNING') {
        jobs.push({
          letterId: l.id,
          letterTitle: l.dateRaw,
          collectionCode: l.collection.collectionCode,
          sender: l.sender,
          recipient: l.recipient,
          type: 'transcription',
          startedAt: l.updatedAt?.toISOString() ?? now.toISOString(),
        });
      }
      if (l.metadataStatus === 'RUNNING') {
        jobs.push({
          letterId: l.id,
          letterTitle: l.dateRaw,
          collectionCode: l.collection.collectionCode,
          sender: l.sender,
          recipient: l.recipient,
          type: 'metadata',
          startedAt: l.updatedAt?.toISOString() ?? now.toISOString(),
        });
      }
      if (l.entityExtractionStatus === 'RUNNING') {
        jobs.push({
          letterId: l.id,
          letterTitle: l.dateRaw,
          collectionCode: l.collection.collectionCode,
          sender: l.sender,
          recipient: l.recipient,
          type: 'entity_extraction',
          startedAt: l.updatedAt?.toISOString() ?? now.toISOString(),
        });
      }
      return jobs;
    });

    // Queued transcription jobs
    const queuedTranscription = await db.query.letters.findMany({
      where: and(
        eq(letters.type, 'L'),
        eq(letters.workflow, 'UPLOADED'),
        eq(letters.transcriptionStatus, 'PENDING'),
        isNull(letters.deletedAt)
      ),
      with: { collection: true },
      orderBy: (l, { asc }) => [asc(l.createdAt)],
      limit: 50,
    });

    // Queued metadata jobs
    const queuedMetadata = await db.query.letters.findMany({
      where: and(
        eq(letters.type, 'L'),
        eq(letters.workflow, 'TRANSCRIBED'),
        eq(letters.metadataStatus, 'PENDING'),
        isNotNull(letters.transcriptConfirmedAt),
        isNull(letters.deletedAt)
      ),
      with: { collection: true },
      orderBy: (l, { asc }) => [asc(l.createdAt)],
      limit: 50,
    });

    // Queued entity extraction jobs
    const queuedEntityExtraction = await db.query.letters.findMany({
      where: and(
        eq(letters.type, 'L'),
        eq(letters.entityExtractionStatus, 'PENDING'),
        isNull(letters.deletedAt)
      ),
      with: { collection: true },
      orderBy: (l, { asc }) => [asc(l.createdAt)],
      limit: 50,
    });

    // Recent completions/failures (last hour, limit 20)
    // Query letters updated recently that have SUCCESS or FAILED status
    const recentLetters = await db.query.letters.findMany({
      where: and(
        isNull(letters.deletedAt),
        sql`${letters.updatedAt} >= ${oneHourAgo.toISOString()}`,
        or(
          eq(letters.transcriptionStatus, 'SUCCESS'),
          eq(letters.transcriptionStatus, 'FAILED'),
          eq(letters.metadataStatus, 'SUCCESS'),
          eq(letters.metadataStatus, 'FAILED'),
          eq(letters.entityExtractionStatus, 'SUCCESS'),
          eq(letters.entityExtractionStatus, 'FAILED')
        )
      ),
      with: { collection: true },
      orderBy: (l, { desc }) => [desc(l.updatedAt)],
      limit: 30,
    });

    const recent: Array<{
      letterId: string;
      letterTitle: string;
      collectionCode: string;
      type: string;
      status: string;
      error?: string;
      completedAt: string;
    }> = [];

    // Helper to check if a failure was an admin action (clear/remove from queue)
    const isAdminCleared = (error: string | null) => error?.includes('from queue by admin');

    for (const l of recentLetters) {
      const letterUpdatedAt = l.updatedAt?.toISOString() ?? now.toISOString();

      // For transcription, use transcribedAt if available — only show if it's recent
      // This prevents old transcription entries from appearing when metadata updates the letter
      const transcriptionTime = l.transcribedAt?.getTime();
      const transcriptionRecent = transcriptionTime && transcriptionTime >= oneHourAgo.getTime();

      if (transcriptionRecent && (l.transcriptionStatus === 'SUCCESS' || (l.transcriptionStatus === 'FAILED' && !isAdminCleared(l.transcriptionError)))) {
        recent.push({
          letterId: l.id,
          letterTitle: l.dateRaw,
          collectionCode: l.collection.collectionCode,
          type: 'transcription',
          status: l.transcriptionStatus,
          error: l.transcriptionStatus === 'FAILED' ? (l.transcriptionError ?? undefined) : undefined,
          completedAt: l.transcribedAt!.toISOString(),
        });
      }
      if (l.metadataStatus === 'SUCCESS' || (l.metadataStatus === 'FAILED' && !isAdminCleared(l.metadataError))) {
        recent.push({
          letterId: l.id,
          letterTitle: l.dateRaw,
          collectionCode: l.collection.collectionCode,
          type: 'metadata',
          status: l.metadataStatus,
          error: l.metadataStatus === 'FAILED' ? (l.metadataError ?? undefined) : undefined,
          completedAt: letterUpdatedAt,
        });
      }
      if (l.entityExtractionStatus === 'SUCCESS' || (l.entityExtractionStatus === 'FAILED' && !isAdminCleared(l.entityExtractionError))) {
        recent.push({
          letterId: l.id,
          letterTitle: l.dateRaw,
          collectionCode: l.collection.collectionCode,
          type: 'entity_extraction',
          status: l.entityExtractionStatus,
          error: l.entityExtractionStatus === 'FAILED' ? (l.entityExtractionError ?? undefined) : undefined,
          completedAt: letterUpdatedAt,
        });
      }
    }

    // Sort recent by completedAt desc and limit to 20
    recent.sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());
    recent.splice(20);

    const mapQueued = (items: typeof queuedTranscription) =>
      items.map(l => ({
        letterId: l.id,
        letterTitle: l.dateRaw,
        collectionCode: l.collection.collectionCode,
        sender: l.sender,
        recipient: l.recipient,
        queuedAt: l.updatedAt?.toISOString() ?? l.createdAt.toISOString(),
      }));

    res.json({
      active,
      queued: {
        transcription: mapQueued(queuedTranscription),
        metadata: mapQueued(queuedMetadata),
        entityExtraction: mapQueued(queuedEntityExtraction),
      },
      recent,
      counts: {
        activeCount: active.length,
        queuedTranscription: queuedTranscription.length,
        queuedMetadata: queuedMetadata.length,
        queuedEntityExtraction: queuedEntityExtraction.length,
        recentSuccessCount: recent.filter(r => r.status === 'SUCCESS').length,
        recentFailedCount: recent.filter(r => r.status === 'FAILED').length,
      },
      onDemandProcessing: processingState,
    });
  } catch (error) {
    next(error);
  }
});

// Schema for processing filter options (matches frontend StartProcessingOptions)
const processingFilterSchema = z.object({
  collectionCode: z.string().optional(),
  visibility: z.enum(['PUBLISHED', 'HIDDEN']).optional(),
  search: z.string().optional(),
  year: z.coerce.number().min(1800).max(2100).optional(),
  month: z.coerce.number().min(1).max(12).optional(),
  day: z.coerce.number().min(1).max(31).optional(),
  dateFrom: z.string().regex(/^\d{8}$/).optional(),
  dateTo: z.string().regex(/^\d{8}$/).optional(),
});

/**
 * Build filter conditions from processing options
 * Returns { conditions, collectionNotFound } - check collectionNotFound before using conditions
 */
async function buildProcessingConditions(
  options: z.infer<typeof processingFilterSchema>,
  baseConditions: ReturnType<typeof eq>[]
): Promise<{ conditions: ReturnType<typeof eq>[]; collectionNotFound: boolean }> {
  const conditions = [...baseConditions];

  // Collection filter (partial matching like GET endpoint)
  if (options.collectionCode) {
    const matchingCollections = await db.query.collections.findMany({
      where: ilike(collections.collectionCode, `%${options.collectionCode}`),
    });
    if (matchingCollections.length > 0) {
      const collectionIds = matchingCollections.map(c => c.id);
      conditions.push(inArray(letters.collectionId, collectionIds));
    } else {
      return { conditions: [], collectionNotFound: true };
    }
  }

  // Visibility filter
  if (options.visibility) {
    conditions.push(eq(letters.visibility, options.visibility));
  }

  // Search filter (ILIKE on sender, recipient, summary, hook)
  if (options.search && options.search.trim()) {
    const searchTerm = `%${options.search.trim()}%`;
    conditions.push(
      or(
        ilike(letters.sender, searchTerm),
        ilike(letters.recipient, searchTerm),
        ilike(letters.summary, searchTerm),
        ilike(letters.hook, searchTerm)
      )!
    );
  }

  // Date filters - individual components
  if (options.year) {
    conditions.push(sql`SUBSTRING(${letters.dateRaw}, 1, 4) = ${options.year.toString()}`);
  }
  if (options.month) {
    const monthStr = options.month.toString().padStart(2, '0');
    conditions.push(sql`SUBSTRING(${letters.dateRaw}, 5, 2) = ${monthStr}`);
  }
  if (options.day) {
    const dayStr = options.day.toString().padStart(2, '0');
    conditions.push(sql`SUBSTRING(${letters.dateRaw}, 7, 2) = ${dayStr}`);
  }

  // Date range filters (only if individual components not set)
  if (options.dateFrom && !options.year && !options.month && !options.day) {
    conditions.push(sql`REPLACE(${letters.dateRaw}, 'X', '0') >= ${options.dateFrom}`);
  }
  if (options.dateTo && !options.year && !options.month && !options.day) {
    conditions.push(sql`REPLACE(${letters.dateRaw}, 'X', '9') <= ${options.dateTo}`);
  }

  return { conditions, collectionNotFound: false };
}

/**
 * POST /admin/processing/start-transcription - Start transcription processing
 * Accepts filter options to process only matching letters
 */
router.post('/processing/start-transcription', async (req, res, next) => {
  try {
    if (processingState.isRunning) {
      res.status(400).json({ error: 'Processing already in progress' });
      return;
    }

    const options = processingFilterSchema.parse(req.body || {});

    // Base conditions for transcription: type L, workflow UPLOADED, not deleted
    const baseConditions: ReturnType<typeof eq>[] = [
      eq(letters.type, 'L'),
      eq(letters.workflow, 'UPLOADED'),
      isNull(letters.deletedAt)
    ];

    const { conditions, collectionNotFound } = await buildProcessingConditions(options, baseConditions);

    if (collectionNotFound) {
      res.json({ message: 'Collection not found', total: 0 });
      return;
    }

    // Find eligible letters
    const eligible = await db.query.letters.findMany({
      where: and(...conditions),
      with: { pages: true },
    });

    const toProcess = eligible.filter(l => l.pages.length > 0);

    if (toProcess.length === 0) {
      res.json({ message: 'No letters to process', total: 0 });
      return;
    }

    // Reset state and start
    processingState = {
      isRunning: true,
      isPaused: false,
      shouldAbort: false,
      currentJob: null,
      completed: 0,
      failed: 0,
      total: toProcess.length,
      errors: [],
      lastCompletedAt: null,
    };

    // Start async processing (don't await - runs in background)
    processLettersAsync(toProcess.map(l => l.id), 'transcription');

    res.json({ message: 'Processing started', total: toProcess.length });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/processing/start-metadata - Start metadata extraction
 * Accepts filter options to process only matching letters
 */
router.post('/processing/start-metadata', async (req, res, next) => {
  try {
    if (processingState.isRunning) {
      res.status(400).json({ error: 'Processing already in progress' });
      return;
    }

    const options = processingFilterSchema.parse(req.body || {});

    // Base conditions for metadata: type L, workflow TRANSCRIBED, transcript confirmed, not deleted
    const baseConditions: ReturnType<typeof eq>[] = [
      eq(letters.type, 'L'),
      eq(letters.workflow, 'TRANSCRIBED'),
      isNotNull(letters.transcriptConfirmedAt),
      isNull(letters.deletedAt)
    ];

    const { conditions, collectionNotFound } = await buildProcessingConditions(options, baseConditions);

    if (collectionNotFound) {
      res.json({ message: 'Collection not found', total: 0 });
      return;
    }

    // Find eligible letters
    const eligible = await db.query.letters.findMany({
      where: and(...conditions),
    });

    if (eligible.length === 0) {
      res.json({ message: 'No letters to process', total: 0 });
      return;
    }

    // Reset state and start
    processingState = {
      isRunning: true,
      isPaused: false,
      shouldAbort: false,
      currentJob: null,
      completed: 0,
      failed: 0,
      total: eligible.length,
      errors: [],
      lastCompletedAt: null,
    };

    // Start async processing (don't await - runs in background)
    processLettersAsync(eligible.map(l => l.id), 'metadata');

    res.json({ message: 'Processing started', total: eligible.length });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/processing/pause - Pause processing
 */
router.post('/processing/pause', (req, res) => {
  if (!processingState.isRunning) {
    req.log.warn('Pause requested but no processing in progress');
    res.status(400).json({ error: 'No processing in progress' });
    return;
  }
  processingState.isPaused = true;
  req.log.info({ completed: processingState.completed, total: processingState.total }, 'Processing paused');
  res.json({ message: 'Processing paused' });
});

/**
 * POST /admin/processing/resume - Resume processing
 */
router.post('/processing/resume', (req, res) => {
  if (!processingState.isRunning) {
    req.log.warn('Resume requested but no processing in progress');
    res.status(400).json({ error: 'No processing in progress' });
    return;
  }
  processingState.isPaused = false;
  req.log.info({ completed: processingState.completed, total: processingState.total }, 'Processing resumed');
  res.json({ message: 'Processing resumed' });
});

/**
 * POST /admin/processing/abort - Abort processing
 */
router.post('/processing/abort', async (req, res, next) => {
  try {
    if (!processingState.isRunning) {
      req.log.warn('Abort requested but no processing in progress');
      res.status(400).json({ error: 'No processing in progress' });
      return;
    }

    processingState.shouldAbort = true;
    req.log.info(
      { completed: processingState.completed, failed: processingState.failed, total: processingState.total },
      'Processing abort requested'
    );

    // If currently processing, revert the current letter's status back to initial state
    if (processingState.currentJob) {
      const { letterId, type } = processingState.currentJob;
      req.log.info({ letterId, type }, 'Reverting in-progress job state');
      if (type === 'transcription') {
        await db.update(letters).set({
          transcriptionStatus: 'PENDING',
          workflow: 'UPLOADED',
          updatedAt: new Date(),
        }).where(eq(letters.id, letterId));
      } else {
        await db.update(letters).set({
          metadataStatus: 'PENDING',
          workflow: 'TRANSCRIBED',
          updatedAt: new Date(),
        }).where(eq(letters.id, letterId));
      }
    }

    res.json({ message: 'Processing aborted' });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// QUEUE MANAGEMENT ENDPOINTS
// ============================================================================

const queueJobTypeSchema = z.enum(['transcription', 'metadata', 'entity_extraction']);

/**
 * POST /admin/processing/queue/remove - Remove a letter from the processing queue
 * Only works for PENDING items (can't cancel RUNNING).
 */
router.post('/processing/queue/remove', async (req, res, next) => {
  try {
    const schema = z.object({
      letterId: z.string().uuid(),
      type: queueJobTypeSchema,
    });
    const { letterId, type } = schema.parse(req.body);

    const letter = await db.query.letters.findFirst({
      where: eq(letters.id, letterId),
    });

    if (!letter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    if (type === 'transcription') {
      if (letter.transcriptionStatus !== 'PENDING') {
        res.status(400).json({ error: `Cannot remove: transcription status is ${letter.transcriptionStatus}` });
        return;
      }
      // Transcription PENDING is the default state, no reset needed beyond confirming it stays
    } else if (type === 'metadata') {
      if (letter.metadataStatus !== 'PENDING') {
        res.status(400).json({ error: `Cannot remove: metadata status is ${letter.metadataStatus}` });
        return;
      }
      // Reset to a state where worker won't pick it up: set to SUCCESS with no data or reset attempt count
      // Since we can't truly "un-queue" from PENDING (it's the default), we mark it as FAILED with a note
      await db.update(letters).set({
        metadataStatus: 'FAILED',
        metadataError: 'Removed from queue by admin',
        updatedAt: new Date(),
      }).where(eq(letters.id, letterId));
    } else if (type === 'entity_extraction') {
      if (letter.entityExtractionStatus !== 'PENDING') {
        res.status(400).json({ error: `Cannot remove: entity extraction status is ${letter.entityExtractionStatus}` });
        return;
      }
      await db.update(letters).set({
        entityExtractionStatus: 'FAILED',
        entityExtractionError: 'Removed from queue by admin',
        updatedAt: new Date(),
      }).where(eq(letters.id, letterId));
    }

    res.json({ message: 'Removed from queue' });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/processing/queue/clear - Clear all queued items of a given type
 */
router.post('/processing/queue/clear', async (req, res, next) => {
  try {
    const schema = z.object({ type: queueJobTypeSchema });
    const { type } = schema.parse(req.body);

    let cleared = 0;

    if (type === 'transcription') {
      const queued = await db.query.letters.findMany({
        where: and(
          eq(letters.type, 'L'),
          eq(letters.workflow, 'UPLOADED'),
          eq(letters.transcriptionStatus, 'PENDING'),
          isNull(letters.deletedAt)
        ),
        columns: { id: true },
      });
      if (queued.length > 0) {
        await db.update(letters).set({
          transcriptionStatus: 'FAILED',
          transcriptionError: 'Cleared from queue by admin',
          updatedAt: new Date(),
        }).where(inArray(letters.id, queued.map(l => l.id)));
        cleared = queued.length;
      }
    } else if (type === 'metadata') {
      const queued = await db.query.letters.findMany({
        where: and(
          eq(letters.type, 'L'),
          eq(letters.workflow, 'TRANSCRIBED'),
          eq(letters.metadataStatus, 'PENDING'),
          isNotNull(letters.transcriptConfirmedAt),
          isNull(letters.deletedAt)
        ),
        columns: { id: true },
      });
      if (queued.length > 0) {
        await db.update(letters).set({
          metadataStatus: 'FAILED',
          metadataError: 'Cleared from queue by admin',
          updatedAt: new Date(),
        }).where(inArray(letters.id, queued.map(l => l.id)));
        cleared = queued.length;
      }
    } else if (type === 'entity_extraction') {
      const queued = await db.query.letters.findMany({
        where: and(
          eq(letters.type, 'L'),
          eq(letters.entityExtractionStatus, 'PENDING'),
          isNull(letters.deletedAt)
        ),
        columns: { id: true },
      });
      if (queued.length > 0) {
        await db.update(letters).set({
          entityExtractionStatus: 'FAILED',
          entityExtractionError: 'Cleared from queue by admin',
          updatedAt: new Date(),
        }).where(inArray(letters.id, queued.map(l => l.id)));
        cleared = queued.length;
      }
    }

    res.json({ message: `Cleared ${cleared} items from ${type} queue`, cleared });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/processing/queue/retry - Retry a failed job
 * Resets status to PENDING so the worker picks it up again.
 */
router.post('/processing/queue/retry', async (req, res, next) => {
  try {
    const schema = z.object({
      letterId: z.string().uuid(),
      type: queueJobTypeSchema,
    });
    const { letterId, type } = schema.parse(req.body);

    const letter = await db.query.letters.findFirst({
      where: eq(letters.id, letterId),
    });

    if (!letter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    if (type === 'transcription') {
      if (letter.transcriptionStatus !== 'FAILED') {
        res.status(400).json({ error: `Cannot retry: transcription status is ${letter.transcriptionStatus}` });
        return;
      }
      await db.update(letters).set({
        transcriptionStatus: 'PENDING',
        transcriptionError: null,
        updatedAt: new Date(),
      }).where(eq(letters.id, letterId));
    } else if (type === 'metadata') {
      if (letter.metadataStatus !== 'FAILED') {
        res.status(400).json({ error: `Cannot retry: metadata status is ${letter.metadataStatus}` });
        return;
      }
      await db.update(letters).set({
        metadataStatus: 'PENDING',
        metadataError: null,
        updatedAt: new Date(),
      }).where(eq(letters.id, letterId));
    } else if (type === 'entity_extraction') {
      if (letter.entityExtractionStatus !== 'FAILED') {
        res.status(400).json({ error: `Cannot retry: entity extraction status is ${letter.entityExtractionStatus}` });
        return;
      }
      await db.update(letters).set({
        entityExtractionStatus: 'PENDING',
        entityExtractionError: null,
        updatedAt: new Date(),
      }).where(eq(letters.id, letterId));
    }

    res.json({ message: `Retrying ${type} for letter ${letterId}` });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// BULK OPERATIONS (must be defined before parameterized routes)
// ============================================================================

const bulkLetterIdsSchema = z.object({
  letterIds: z.array(z.string().uuid()).min(1),
});

/**
 * POST /admin/letters/bulk/transcribe - Queue multiple letters for transcription
 *
 * Only processes L-type letters with workflow='UPLOADED' and at least one page.
 * Returns detailed skip reasons for any letters that can't be processed.
 */
router.post('/letters/bulk/transcribe', async (req, res, next) => {
  try {
    const parseResult = bulkLetterIdsSchema.safeParse(req.body);
    if (!parseResult.success) {
      req.log.warn({ errors: parseResult.error.errors }, 'Invalid bulk transcribe request');
      res.status(400).json({ error: 'Invalid request', details: parseResult.error.errors });
      return;
    }
    const { letterIds } = parseResult.data;

    req.log.info({ requestedCount: letterIds.length }, 'Bulk transcribe request received');

    // Fetch ALL requested letters with pages (not pre-filtered) so we can report skip reasons
    const allRequested = await db.query.letters.findMany({
      where: and(
        inArray(letters.id, letterIds),
        isNull(letters.deletedAt)
      ),
      with: { pages: true },
    });

    const foundIds = new Set(allRequested.map(l => l.id));
    const eligible: typeof allRequested = [];
    const skipReasons: Array<{ letterId: string; reason: string }> = [];

    // Report letters not found
    for (const id of letterIds) {
      if (!foundIds.has(id)) {
        skipReasons.push({ letterId: id, reason: 'Letter not found or deleted' });
      }
    }

    // Check each letter individually for eligibility
    for (const letter of allRequested) {
      if (letter.type !== 'L') {
        skipReasons.push({ letterId: letter.id, reason: `Type is '${letter.type}' (only type 'L' supported)` });
      } else if (letter.workflow !== 'UPLOADED') {
        skipReasons.push({ letterId: letter.id, reason: `Already past upload stage (workflow: ${letter.workflow})` });
      } else if (letter.pages.length === 0) {
        skipReasons.push({ letterId: letter.id, reason: 'No page images uploaded' });
      } else if (letter.transcriptionStatus === 'RUNNING') {
        skipReasons.push({ letterId: letter.id, reason: 'Transcription already running' });
      } else {
        eligible.push(letter);
      }
    }

    if (eligible.length > 0) {
      if (processingState.isRunning) {
        // Another batch is already running — queue for later pickup
        for (const letter of eligible) {
          await db.update(letters).set({
            transcriptionStatus: 'PENDING',
            transcriptionError: null,
            updatedAt: new Date(),
          }).where(eq(letters.id, letter.id));
        }
        req.log.info(
          { queued: eligible.length, skipped: skipReasons.length },
          'Bulk transcribe queued (another batch running)'
        );
        res.json({
          queued: eligible.length,
          skipped: skipReasons.length,
          skipReasons,
          processing: false,
        });
      } else {
        // Set status to PENDING before processing (processLetter checks for this)
        for (const letter of eligible) {
          await db.update(letters).set({
            transcriptionStatus: 'PENDING',
            transcriptionError: null,
            updatedAt: new Date(),
          }).where(eq(letters.id, letter.id));
        }
        // Start processing immediately
        processingState = {
          isRunning: true,
          isPaused: false,
          shouldAbort: false,
          currentJob: null,
          completed: 0,
          failed: 0,
          total: eligible.length,
          errors: [],
          lastCompletedAt: null,
        };
        processLettersAsync(eligible.map(l => l.id), 'transcription');
        req.log.info(
          { queued: eligible.length, skipped: skipReasons.length },
          'Bulk transcribe started immediately'
        );
        res.json({
          queued: eligible.length,
          skipped: skipReasons.length,
          skipReasons,
          processing: true,
        });
      }
    } else {
      req.log.info(
        { skipped: skipReasons.length },
        'Bulk transcribe: no eligible letters'
      );
      res.json({
        queued: 0,
        skipped: skipReasons.length,
        skipReasons,
        processing: false,
      });
    }
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/letters/bulk/extract-metadata - Queue multiple letters for metadata extraction
 *
 * Only processes L-type letters with workflow='TRANSCRIBED' and confirmed transcript.
 * Returns detailed skip reasons for any letters that can't be processed.
 */
router.post('/letters/bulk/extract-metadata', async (req, res, next) => {
  try {
    const bulkMetadataSchema = z.object({
      letterIds: z.array(z.string().uuid()).min(1),
      skipConfirmationCheck: z.boolean().optional().default(false),
    });
    const parseResult = bulkMetadataSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Invalid request', details: parseResult.error.errors });
      return;
    }
    const { letterIds, skipConfirmationCheck } = parseResult.data;

    // Fetch ALL requested letters (not pre-filtered) so we can report skip reasons
    const allRequested = await db.query.letters.findMany({
      where: and(
        inArray(letters.id, letterIds),
        isNull(letters.deletedAt)
      ),
    });

    const foundIds = new Set(allRequested.map(l => l.id));
    const eligible: typeof allRequested = [];
    const skipReasons: Array<{ letterId: string; reason: string }> = [];
    let unconfirmedCount = 0;

    // Report letters not found
    for (const id of letterIds) {
      if (!foundIds.has(id)) {
        skipReasons.push({ letterId: id, reason: 'Letter not found or deleted' });
      }
    }

    // Check each letter individually for eligibility
    for (const letter of allRequested) {
      if (letter.type !== 'L') {
        skipReasons.push({ letterId: letter.id, reason: `Type is '${letter.type}' (only type 'L' supported)` });
      } else if (letter.workflow === 'UPLOADED') {
        skipReasons.push({ letterId: letter.id, reason: 'Needs transcription first (workflow: UPLOADED)' });
      } else if (letter.workflow !== 'TRANSCRIBED') {
        skipReasons.push({ letterId: letter.id, reason: `Already processed (workflow: ${letter.workflow})` });
      } else if (!letter.transcriptConfirmedAt && !skipConfirmationCheck) {
        unconfirmedCount++;
        skipReasons.push({ letterId: letter.id, reason: 'Transcript not yet confirmed' });
      } else if (letter.metadataStatus === 'RUNNING') {
        skipReasons.push({ letterId: letter.id, reason: 'Metadata extraction already running' });
      } else {
        eligible.push(letter);
      }
    }

    // If there are unconfirmed letters and user hasn't confirmed, return early
    // so frontend can show a confirmation dialog
    if (unconfirmedCount > 0 && !skipConfirmationCheck && eligible.length === 0) {
      res.json({
        queued: 0,
        skipped: skipReasons.length,
        skipReasons,
        processing: false,
        unconfirmedCount,
      });
      return;
    }

    if (eligible.length > 0) {
      // Set status to PENDING before processing (processMetadata checks for this)
      for (const letter of eligible) {
        await db.update(letters).set({
          metadataStatus: 'PENDING',
          metadataError: null,
          updatedAt: new Date(),
        }).where(eq(letters.id, letter.id));
      }

      if (processingState.isRunning) {
        // Another batch is already running — letters are queued as PENDING
        res.json({
          queued: eligible.length,
          skipped: skipReasons.length,
          skipReasons,
          processing: false,
          unconfirmedCount,
        });
      } else {
        // Start processing immediately
        processingState = {
          isRunning: true,
          isPaused: false,
          shouldAbort: false,
          currentJob: null,
          completed: 0,
          failed: 0,
          total: eligible.length,
          errors: [],
          lastCompletedAt: null,
        };
        processLettersAsync(eligible.map(l => l.id), 'metadata');
        res.json({
          queued: eligible.length,
          skipped: skipReasons.length,
          skipReasons,
          processing: true,
          unconfirmedCount,
        });
      }
    } else {
      res.json({
        queued: 0,
        skipped: skipReasons.length,
        skipReasons,
        processing: false,
        unconfirmedCount,
      });
    }
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/letters/bulk/reset-transcriptions - Reset transcriptions for selected letters
 *
 * Sets workflow back to UPLOADED, clears transcription text, clears transcript confirmation.
 * This is used for re-testing transcription with updated prompts.
 */
router.post('/letters/bulk/reset-transcriptions', async (req, res, next) => {
  try {
    const parseResult = bulkLetterIdsSchema.safeParse(req.body);
    if (!parseResult.success) {
      req.log.warn({ errors: parseResult.error.errors }, 'Invalid bulk reset request');
      res.status(400).json({ error: 'Invalid request', details: parseResult.error.errors });
      return;
    }
    const { letterIds } = parseResult.data;

    req.log.info({ count: letterIds.length }, 'Bulk reset transcriptions requested');

    // Update all selected letters
    const result = await db.update(letters).set({
      workflow: 'UPLOADED',
      transcriptionText: null,
      transcriptConfirmedAt: null,
      transcriptConfirmedBy: null,
      transcriptionStatus: 'PENDING',
      transcriptionError: null,
      // Also clear metadata since it depends on transcription
      metadataStatus: 'PENDING',
      metadataError: null,
      sender: null,
      recipient: null,
      locationWritten: null,
      hook: null,
      summary: null,
      extractedDate: null,
      extractedDateConfidence: null,
      tags: null,
      // Reset two-track content status
      transcriptStatus: 'EMPTY',
      transcriptVerifiedAt: null,
      transcriptVerifiedBy: null,
      metadataContentStatus: 'EMPTY',
      metadataVerifiedAt: null,
      metadataVerifiedBy: null,
      updatedAt: new Date(),
    }).where(
      and(
        inArray(letters.id, letterIds),
        isNull(letters.deletedAt)
      )
    );

    req.log.info({ updated: letterIds.length }, 'Bulk reset transcriptions completed');

    res.json({
      message: 'Transcriptions reset',
      updated: letterIds.length,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /admin/letters/bulk/update-fields - Bulk update sender/recipient fields
 *
 * Used by the copy-paste edit mode in the admin dashboard.
 * Accepts an array of updates with letterId and sender/recipient values.
 */
const bulkUpdateFieldsSchema = z.object({
  updates: z.array(z.object({
    letterId: z.string().uuid(),
    sender: z.string().optional(),
    recipient: z.string().optional(),
  })).min(1),
});

router.patch('/letters/bulk/update-fields', async (req, res, next) => {
  try {
    const parseResult = bulkUpdateFieldsSchema.safeParse(req.body);
    if (!parseResult.success) {
      req.log.warn({ errors: parseResult.error.errors }, 'Invalid bulk update fields request');
      res.status(400).json({ error: 'Invalid request', details: parseResult.error.errors });
      return;
    }
    const { updates } = parseResult.data;

    req.log.info({ updateCount: updates.length }, 'Bulk update fields request received');

    // Process each update
    let successCount = 0;
    for (const update of updates) {
      const dbUpdates: Record<string, unknown> = {
        updatedAt: new Date(),
      };

      if (update.sender !== undefined) {
        dbUpdates.sender = update.sender || null;
      }
      if (update.recipient !== undefined) {
        dbUpdates.recipient = update.recipient || null;
      }

      // Only update if there are actual field changes
      if (Object.keys(dbUpdates).length > 1) {
        await db.update(letters).set(dbUpdates).where(
          and(
            eq(letters.id, update.letterId),
            isNull(letters.deletedAt)
          )
        );
        successCount++;
      }
    }

    req.log.info({ updated: successCount }, 'Bulk update fields completed');

    res.json({
      message: 'Fields updated',
      updated: successCount,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/letters/bulk/clear-metadata - Clear metadata for selected letters
 *
 * Clears metadata fields but keeps the transcription intact.
 * Resets workflow to TRANSCRIBED if it was past that point.
 */
router.post('/letters/bulk/clear-metadata', async (req, res, next) => {
  try {
    const parseResult = bulkLetterIdsSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Invalid request', details: parseResult.error.errors });
      return;
    }
    const { letterIds } = parseResult.data;

    // Update all selected letters - clear metadata but keep transcription
    await db.update(letters).set({
      sender: null,
      recipient: null,
      locationWritten: null,
      hook: null,
      summary: null,
      extractedDate: null,
      extractedDateConfidence: null,
      tags: null,
      metadataStatus: 'PENDING',
      metadataError: null,
      // Reset metadata two-track status (keep transcript status intact)
      metadataContentStatus: 'EMPTY',
      metadataVerifiedAt: null,
      metadataVerifiedBy: null,
      // Set workflow to TRANSCRIBED if it was past that
      workflow: 'TRANSCRIBED',
      updatedAt: new Date(),
    }).where(
      and(
        inArray(letters.id, letterIds),
        isNull(letters.deletedAt)
      )
    );

    res.json({
      message: 'Metadata cleared',
      updated: letterIds.length,
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// SINGLE LETTER OPERATIONS
// ============================================================================

/**
 * GET /admin/letters/:letterId - Get a single letter with pages (admin - any visibility)
 * Also fetches related cards (C) and extras (E) for the same date/sequence
 * Includes linked persons and places for V2 metadata display
 */
router.get('/letters/:letterId', async (req, res, next) => {
  try {
    const { letterId } = req.params;

    const letter = await db.query.letters.findFirst({
      where: and(eq(letters.id, letterId), isNull(letters.deletedAt)),
      with: {
        collection: true,
        pages: {
          orderBy: (p, { asc }) => [asc(p.pageNumber)],
        },
        persons: {
          with: {
            person: true,
          },
        },
        places: {
          with: {
            place: true,
          },
        },
      },
    });

    if (!letter) {
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
        isNull(letters.deletedAt)
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

// Validation schema for letter updates
const updateLetterSchema = z.object({
  transcriptionText: z.string().optional(),
  sender: z.string().nullable().optional(),
  recipient: z.string().nullable().optional(),
  locationWritten: z.string().nullable().optional(),
  hook: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  extractedDate: z.string().nullable().optional(),
  extractedDateConfidence: z.enum(['exact', 'unknown', 'inferred']).nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
  visibility: z.enum(['PUBLISHED', 'HIDDEN']).optional(),
  notes: z.string().nullable().optional(),
});

/**
 * POST /admin/letters/:letterId/process - Re-enqueue a letter for processing
 *
 * Resets the letter's status and allows the worker to pick it up again.
 */
router.post('/letters/:letterId/process', async (req, res, next) => {
  try {
    const { letterId } = req.params;

    const letter = await getLetterById(letterId);

    if (!letter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    // Reset for processing
    await resetLetterForProcessing(letterId);

    res.json({
      message: 'Letter enqueued for processing',
      letterId,
      note: 'The background worker will pick this up shortly.',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /admin/letters/:letterId - Update letter fields
 */
router.put('/letters/:letterId', async (req, res, next) => {
  try {
    const { letterId } = req.params;

    // Validate request body
    const parseResult = updateLetterSchema.safeParse(req.body);
    if (!parseResult.success) {
      req.log.warn({ letterId, errors: parseResult.error.errors }, 'Invalid letter update request');
      res.status(400).json({ error: 'Invalid request body', details: parseResult.error.errors });
      return;
    }
    const updates = parseResult.data;
    req.log.debug({ letterId, fields: Object.keys(updates) }, 'Letter update requested');

    // Check letter exists
    const existingLetter = await getLetterById(letterId);
    if (!existingLetter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    // Build update object
    const dbUpdates: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (updates.transcriptionText !== undefined) {
      dbUpdates.transcriptionText = updates.transcriptionText;
    }
    if (updates.sender !== undefined) {
      dbUpdates.sender = updates.sender;
    }
    if (updates.recipient !== undefined) {
      dbUpdates.recipient = updates.recipient;
    }
    if (updates.locationWritten !== undefined) {
      dbUpdates.locationWritten = updates.locationWritten;
    }
    if (updates.hook !== undefined) {
      dbUpdates.hook = updates.hook;
    }
    if (updates.summary !== undefined) {
      dbUpdates.summary = updates.summary;
    }
    if (updates.extractedDate !== undefined) {
      // Only set extractedDate if it's a valid YYYY-MM-DD format or null
      // Display-formatted dates like "1947" or "September 14, 1886" should be ignored
      if (updates.extractedDate === null || updates.extractedDate === '') {
        dbUpdates.extractedDate = null;
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(updates.extractedDate)) {
        // Valid ISO date format
        dbUpdates.extractedDate = updates.extractedDate;
      }
      // Otherwise, skip updating extractedDate (it's a display format we can't use)
    }
    if (updates.notes !== undefined) {
      dbUpdates.notes = updates.notes;
    }
    if (updates.extractedDateConfidence !== undefined) {
      dbUpdates.extractedDateConfidence = updates.extractedDateConfidence;
    }
    if (updates.tags !== undefined) {
      dbUpdates.tags = updates.tags;
    }
    if (updates.visibility !== undefined) {
      dbUpdates.visibility = updates.visibility;
      // If publishing, mark as reviewed
      if (updates.visibility === 'PUBLISHED') {
        dbUpdates.reviewedAt = new Date();
        dbUpdates.reviewedBy = 'admin'; // TODO: Use actual user when auth is implemented
      }
    }

    // =========================================================================
    // TWO-TRACK STATUS TRANSITIONS (new system)
    // =========================================================================

    // Transcript edit: AI_DRAFT → EDITED (but not VERIFIED → EDITED, that requires explicit action)
    if (updates.transcriptionText !== undefined) {
      const currentTranscriptStatus = existingLetter.transcriptStatus;
      if (currentTranscriptStatus === 'AI_DRAFT') {
        dbUpdates.transcriptStatus = 'EDITED';
        req.log.debug({ letterId }, 'Transcript status: AI_DRAFT → EDITED');
      }
      // Note: VERIFIED stays VERIFIED - editing verified content keeps it verified
    }

    // Metadata edit: AI_DRAFT → EDITED
    const hasMetadataUpdate = [
      updates.sender,
      updates.recipient,
      updates.locationWritten,
      updates.summary,
      updates.hook,
      updates.extractedDate,
    ].some((field) => field !== undefined);

    if (hasMetadataUpdate) {
      const currentMetadataStatus = existingLetter.metadataContentStatus;
      if (currentMetadataStatus === 'AI_DRAFT') {
        dbUpdates.metadataContentStatus = 'EDITED';
        req.log.debug({ letterId }, 'Metadata status: AI_DRAFT → EDITED');
      }
    }

    // =========================================================================
    // LEGACY WORKFLOW TRANSITIONS (kept for backward compatibility)
    // =========================================================================
    const currentWorkflow = existingLetter.workflow;

    // If admin adds transcription to an UPLOADED letter → TRANSCRIBED
    if (updates.transcriptionText !== undefined) {
      const hasTranscription = updates.transcriptionText && updates.transcriptionText.trim().length > 0;
      if (hasTranscription && currentWorkflow === 'UPLOADED') {
        dbUpdates.workflow = 'TRANSCRIBED';
      } else if (!hasTranscription && ['TRANSCRIBED', 'METADATA_DRAFTED', 'METADATA_EXTRACTING'].includes(currentWorkflow)) {
        // Admin cleared transcription → revert to UPLOADED
        dbUpdates.workflow = 'UPLOADED';
      }
    }

    // If admin adds any metadata to a TRANSCRIBED letter → METADATA_DRAFTED
    if (hasMetadataUpdate) {
      const workflowToCheck = (dbUpdates.workflow as string) || currentWorkflow;
      if (workflowToCheck === 'TRANSCRIBED') {
        dbUpdates.workflow = 'METADATA_DRAFTED';
      }
    }

    // Apply updates
    await db.update(letters).set(dbUpdates).where(eq(letters.id, letterId));

    // Fetch and return updated letter
    const updatedLetter = await db.query.letters.findFirst({
      where: eq(letters.id, letterId),
      with: {
        collection: true,
        pages: {
          orderBy: (p, { asc }) => [asc(p.pageNumber)],
        },
      },
    });

    if (!updatedLetter) {
      req.log.error({ letterId }, 'Failed to fetch letter after update');
      res.status(500).json({ error: 'Failed to fetch updated letter' });
      return;
    }

    req.log.info(
      {
        letterId,
        workflowChange: dbUpdates.workflow ? `${currentWorkflow} -> ${dbUpdates.workflow}` : undefined,
        visibilityChange: updates.visibility,
      },
      'Letter updated'
    );

    // Use helper to include related items in response
    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(404).json({ error: 'Letter not found after update' });
      return;
    }
    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/letters/:letterId/confirm-transcript - Confirm transcript is correct
 *
 * Marks the transcript as confirmed, which triggers metadata extraction.
 * Only works for letters in TRANSCRIBED state.
 */
router.post('/letters/:letterId/confirm-transcript', async (req, res, next) => {
  try {
    const { letterId } = req.params;

    const existingLetter = await getLetterById(letterId);
    if (!existingLetter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    // Only allow confirmation for TRANSCRIBED letters
    if (existingLetter.workflow !== 'TRANSCRIBED') {
      res.status(400).json({
        error: 'Letter must be in TRANSCRIBED state to confirm transcript',
        currentState: existingLetter.workflow,
      });
      return;
    }

    // Mark transcript as confirmed - this triggers metadata extraction by worker
    await db.update(letters).set({
      transcriptConfirmedAt: new Date(),
      transcriptConfirmedBy: 'admin', // TODO: Use actual user when auth is implemented
      metadataStatus: 'PENDING', // Ensure worker picks it up
      updatedAt: new Date(),
    }).where(eq(letters.id, letterId));

    // Fetch and return updated letter with related items
    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(500).json({ error: 'Failed to fetch updated letter' });
      return;
    }

    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/letters/:letterId/regenerate-metadata - Regenerate metadata for a letter
 *
 * Runs metadata extraction immediately (not queued).
 * Works on letters that already have metadata (workflow ENRICHED or COMPLETE).
 */
router.post('/letters/:letterId/regenerate-metadata', async (req, res, next) => {
  try {
    const { letterId } = req.params;

    const existingLetter = await getLetterById(letterId);
    if (!existingLetter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    // Must have a confirmed transcript
    if (!existingLetter.transcriptConfirmedAt) {
      res.status(400).json({
        error: 'Transcript must be confirmed before regenerating metadata',
      });
      return;
    }

    // Cannot regenerate while already running
    if (existingLetter.metadataStatus === 'RUNNING') {
      res.status(400).json({
        error: 'Metadata extraction is already in progress',
      });
      return;
    }

    // Reset attempt count so extraction can proceed
    await db.update(letters).set({
      metadataAttemptCount: 0,
      metadataError: null,
      updatedAt: new Date(),
    }).where(eq(letters.id, letterId));

    // Run metadata extraction immediately
    await runMetadataExtractionV2(letterId);

    // Fetch and return updated letter
    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(500).json({ error: 'Failed to fetch updated letter' });
      return;
    }

    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/letters/:letterId/regenerate-entities - Regenerate entity extraction for a letter
 *
 * Runs only the entity extraction (Prompt 2) without re-running basic metadata.
 * Useful when entity extraction failed or needs improvement.
 */
router.post('/letters/:letterId/regenerate-entities', async (req, res, next) => {
  try {
    const { letterId } = req.params;

    const existingLetter = await getLetterById(letterId);
    if (!existingLetter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    // Must have a transcription
    if (!existingLetter.transcriptionText) {
      res.status(400).json({
        error: 'Letter must have a transcription before extracting entities',
      });
      return;
    }

    // Cannot regenerate while already running
    if (existingLetter.entityExtractionStatus === 'RUNNING') {
      res.status(400).json({
        error: 'Entity extraction is already in progress',
      });
      return;
    }

    // Run entity extraction
    await runEntityExtractionOnly(letterId);

    // Fetch and return updated letter
    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(500).json({ error: 'Failed to fetch updated letter' });
      return;
    }

    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// VERSION HISTORY ENDPOINTS
// ============================================================================

const versionBodySchema = z.object({
  fieldType: z.enum(['transcript', 'metadata']),
  content: z.union([z.string(), z.record(z.unknown())]),
  source: z.enum(['ai', 'human']),
});

/**
 * GET /admin/letters/:letterId/versions - Get version history for a letter
 *
 * Query params:
 * - fieldType: 'transcript' | 'metadata' (required)
 */
router.get('/letters/:letterId/versions', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const fieldType = req.query.fieldType as string;

    if (!fieldType || !['transcript', 'metadata'].includes(fieldType)) {
      res.status(400).json({ error: 'fieldType query param required (transcript or metadata)' });
      return;
    }

    // Verify letter exists
    const letter = await getLetterById(letterId);
    if (!letter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    // Fetch versions for this letter and field type
    const versions = await db.query.letterVersions.findMany({
      where: and(
        eq(letterVersions.letterId, letterId),
        eq(letterVersions.fieldType, fieldType)
      ),
      orderBy: (v, { desc }) => [desc(v.versionNumber)],
    });

    res.json({
      versions: versions.map(v => ({
        versionNumber: v.versionNumber,
        content: v.content,
        source: v.source,
        createdAt: v.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/letters/:letterId/versions - Create a new version snapshot
 *
 * Called on auto-save to preserve version history.
 */
router.post('/letters/:letterId/versions', async (req, res, next) => {
  try {
    const { letterId } = req.params;

    // Verify letter exists
    const letter = await getLetterById(letterId);
    if (!letter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    // Validate body
    const parseResult = versionBodySchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Invalid request body', details: parseResult.error.errors });
      return;
    }
    const { fieldType, content, source } = parseResult.data;

    // Get the next version number
    const existingVersions = await db.query.letterVersions.findMany({
      where: and(
        eq(letterVersions.letterId, letterId),
        eq(letterVersions.fieldType, fieldType)
      ),
      orderBy: (v, { desc }) => [desc(v.versionNumber)],
      limit: 1,
    });

    const nextVersionNumber = existingVersions.length > 0
      ? existingVersions[0].versionNumber + 1
      : 1;

    // Create the version
    const [newVersion] = await db.insert(letterVersions).values({
      letterId,
      fieldType,
      versionNumber: nextVersionNumber,
      content: typeof content === 'string' ? { text: content } : content,
      source,
    }).returning();

    req.log.debug({ letterId, fieldType, versionNumber: nextVersionNumber }, 'Version created');

    // Cleanup old versions (keep last 48 hours)
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    await db.delete(letterVersions).where(
      and(
        eq(letterVersions.letterId, letterId),
        eq(letterVersions.fieldType, fieldType),
        sql`${letterVersions.createdAt} < ${cutoff}`,
        // Always keep at least version 1 (AI original)
        sql`${letterVersions.versionNumber} > 1`
      )
    );

    res.json({
      versionNumber: newVersion.versionNumber,
      createdAt: newVersion.createdAt.toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/letters/:letterId/versions/:versionNumber/restore - Restore a previous version
 *
 * Copies the content from the specified version back to the letter.
 */
router.post('/letters/:letterId/versions/:versionNumber/restore', async (req, res, next) => {
  try {
    const { letterId, versionNumber } = req.params;
    const fieldType = req.query.fieldType as string;

    if (!fieldType || !['transcript', 'metadata'].includes(fieldType)) {
      res.status(400).json({ error: 'fieldType query param required (transcript or metadata)' });
      return;
    }

    // Verify letter exists
    const letter = await getLetterById(letterId);
    if (!letter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    // Find the version to restore
    const version = await db.query.letterVersions.findFirst({
      where: and(
        eq(letterVersions.letterId, letterId),
        eq(letterVersions.fieldType, fieldType),
        eq(letterVersions.versionNumber, parseInt(versionNumber, 10))
      ),
    });

    if (!version) {
      res.status(404).json({ error: 'Version not found' });
      return;
    }

    // Restore the content
    const content = version.content as Record<string, unknown>;

    if (fieldType === 'transcript') {
      await db.update(letters).set({
        transcriptionText: (content.text as string) || '',
        transcriptStatus: 'EDITED',
        updatedAt: new Date(),
      }).where(eq(letters.id, letterId));
    } else {
      // Restore metadata fields
      await db.update(letters).set({
        sender: (content.sender as string) || null,
        recipient: (content.recipient as string) || null,
        locationWritten: (content.locationWritten as string) || null,
        hook: (content.hook as string) || null,
        summary: (content.summary as string) || null,
        metadataContentStatus: 'EDITED',
        updatedAt: new Date(),
      }).where(eq(letters.id, letterId));
    }

    req.log.info({ letterId, fieldType, restoredVersion: versionNumber }, 'Version restored');

    // Fetch and return updated letter with related items
    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(404).json({ error: 'Letter not found after update' });
      return;
    }

    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// TWO-TRACK VERIFICATION ENDPOINTS (New workflow system)
// ============================================================================

/**
 * POST /admin/letters/:letterId/verify-transcript - Mark transcript as verified
 *
 * This is an explicit user action to say "I've reviewed this transcript and it's correct."
 * Does NOT auto-transition - user must explicitly verify.
 */
router.post('/letters/:letterId/verify-transcript', async (req, res, next) => {
  try {
    const { letterId } = req.params;

    const existingLetter = await getLetterById(letterId);
    if (!existingLetter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    // Update transcript status to VERIFIED
    await db.update(letters).set({
      transcriptStatus: 'VERIFIED',
      transcriptVerifiedAt: new Date(),
      transcriptVerifiedBy: 'admin', // TODO: Use actual user when auth is implemented
      updatedAt: new Date(),
    }).where(eq(letters.id, letterId));

    req.log.info({ letterId, previousStatus: existingLetter.transcriptStatus }, 'Transcript verified');

    // Fetch and return updated letter with related items
    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(404).json({ error: 'Letter not found after update' });
      return;
    }

    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/letters/:letterId/unverify-transcript - Reset transcript verification
 *
 * Moves transcript from VERIFIED back to EDITED (allowing re-verification).
 */
router.post('/letters/:letterId/unverify-transcript', async (req, res, next) => {
  try {
    const { letterId } = req.params;

    const existingLetter = await getLetterById(letterId);
    if (!existingLetter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    if (existingLetter.transcriptStatus !== 'VERIFIED') {
      res.status(400).json({
        error: 'Transcript is not verified',
        currentStatus: existingLetter.transcriptStatus,
      });
      return;
    }

    // Reset to EDITED status
    await db.update(letters).set({
      transcriptStatus: 'EDITED',
      transcriptVerifiedAt: null,
      transcriptVerifiedBy: null,
      updatedAt: new Date(),
    }).where(eq(letters.id, letterId));

    req.log.info({ letterId }, 'Transcript verification removed');

    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(404).json({ error: 'Letter not found after update' });
      return;
    }

    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/letters/:letterId/verify-metadata - Mark metadata as verified
 *
 * This is an explicit user action to say "I've reviewed this metadata and it's correct."
 */
router.post('/letters/:letterId/verify-metadata', async (req, res, next) => {
  try {
    const { letterId } = req.params;

    const existingLetter = await getLetterById(letterId);
    if (!existingLetter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    // Update metadata status to VERIFIED
    await db.update(letters).set({
      metadataContentStatus: 'VERIFIED',
      metadataVerifiedAt: new Date(),
      metadataVerifiedBy: 'admin', // TODO: Use actual user when auth is implemented
      // Also mark as reviewed for legacy compatibility
      reviewedAt: new Date(),
      reviewedBy: 'admin',
      updatedAt: new Date(),
    }).where(eq(letters.id, letterId));

    req.log.info({ letterId, previousStatus: existingLetter.metadataContentStatus }, 'Metadata verified');

    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(404).json({ error: 'Letter not found after update' });
      return;
    }

    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/letters/:letterId/unverify-metadata - Reset metadata verification
 *
 * Moves metadata from VERIFIED back to EDITED (allowing re-verification).
 */
router.post('/letters/:letterId/unverify-metadata', async (req, res, next) => {
  try {
    const { letterId } = req.params;

    const existingLetter = await getLetterById(letterId);
    if (!existingLetter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    if (existingLetter.metadataContentStatus !== 'VERIFIED') {
      res.status(400).json({
        error: 'Metadata is not verified',
        currentStatus: existingLetter.metadataContentStatus,
      });
      return;
    }

    // Reset to EDITED status
    await db.update(letters).set({
      metadataContentStatus: 'EDITED',
      metadataVerifiedAt: null,
      metadataVerifiedBy: null,
      updatedAt: new Date(),
    }).where(eq(letters.id, letterId));

    req.log.info({ letterId }, 'Metadata verification removed');

    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(404).json({ error: 'Letter not found after update' });
      return;
    }

    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/letters/:letterId/regenerate-transcription - Re-transcribe a letter
 *
 * Regenerates the main letter transcription and optionally extra content.
 * This is a synchronous operation that runs the transcription pipeline directly.
 *
 * Query params:
 *   includeExtras: boolean - Also re-transcribe extra content (T, C, E types)
 */
router.post('/letters/:letterId/regenerate-transcription', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const includeExtras = req.query.includeExtras === 'true';

    // Fetch the letter
    const letter = await db.query.letters.findFirst({
      where: and(eq(letters.id, letterId), isNull(letters.deletedAt)),
      with: {
        collection: true,
        pages: { orderBy: (p, { asc }) => [asc(p.pageNumber)] },
      },
    });

    if (!letter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    // Only allow regeneration for type='L' letters
    if (letter.type !== 'L') {
      res.status(400).json({ error: 'Can only regenerate transcription for letter type (L)' });
      return;
    }

    req.log.info({ letterId, includeExtras }, 'Starting transcription regeneration');

    // Reset transcription-related fields to allow re-transcription
    await db.update(letters).set({
      workflow: 'UPLOADED',
      transcriptionStatus: 'PENDING',
      transcriptionError: null,
      transcriptionAttemptCount: 0,
      // Reset transcript status but don't touch verified status - user intentionally regenerating
      transcriptStatus: 'EMPTY',
      transcriptVerifiedAt: null,
      transcriptVerifiedBy: null,
      updatedAt: new Date(),
    }).where(eq(letters.id, letterId));

    // Run the transcription pipeline synchronously
    await runTranscription(letterId);

    // After transcription, update status to AI_DRAFT
    await db.update(letters).set({
      transcriptStatus: 'AI_DRAFT',
      updatedAt: new Date(),
    }).where(eq(letters.id, letterId));

    let extrasTranscribed = 0;

    // Optionally re-transcribe extra content
    if (includeExtras) {
      // Fetch related items (T, C, E types with same date/sequence)
      const relatedItems = await db.query.letters.findMany({
        where: and(
          eq(letters.collectionId, letter.collectionId),
          eq(letters.dateRaw, letter.dateRaw),
          eq(letters.typeSequence, letter.typeSequence),
          inArray(letters.type, ['T', 'C', 'E']),
          isNull(letters.deletedAt)
        ),
        with: {
          pages: { orderBy: (p, { asc }) => [asc(p.pageNumber)] },
        },
        orderBy: (l, { asc }) => [asc(l.type)],
      });

      if (relatedItems.length > 0) {
        const typeCounters: Record<string, number> = {};
        const transcriptions: { type: string; index: number; text: string }[] = [];

        for (const item of relatedItems) {
          const docType = getDocumentTypeFromCode(item.type);
          typeCounters[item.type] = (typeCounters[item.type] || 0) + 1;
          const typeIndex = typeCounters[item.type];

          for (const page of item.pages) {
            const { getAbsoluteStoragePath } = await import('../../services/storage.js');
            const filePath = getAbsoluteStoragePath(page.storagePath);

            const checkResult = await checkExtraContentForText({
              filePath,
              documentType: docType,
            });

            if (!checkResult.hasTranscribableText) continue;

            const transcription = await transcribeExtraContent({
              filePath,
              documentType: docType,
              context: {
                collectionCode: letter.collection.collectionCode,
                dateRaw: letter.dateRaw,
              },
            });

            if (transcription.text.trim()) {
              transcriptions.push({
                type: docType,
                index: typeIndex,
                text: transcription.text.trim(),
              });
              extrasTranscribed++;
            }
          }
        }

        // Combine transcriptions with headers
        let combinedExtraContent = '';
        if (transcriptions.length > 0) {
          combinedExtraContent = transcriptions
            .map((t) => {
              const header = `--- ${t.type.charAt(0).toUpperCase() + t.type.slice(1)} ${t.index} ---`;
              return `${header}\n\n${t.text}`;
            })
            .join('\n\n');
        }

        // Update letter with extra content
        await db.update(letters).set({
          extraContentTranscript: combinedExtraContent || null,
          extraContentStatus: combinedExtraContent ? 'AI_DRAFT' : 'EMPTY',
          extraContentVerifiedAt: null,
          extraContentVerifiedBy: null,
          updatedAt: new Date(),
        }).where(eq(letters.id, letterId));
      }
    }

    req.log.info({ letterId, includeExtras, extrasTranscribed }, 'Transcription regeneration completed');

    // Fetch and return updated letter with related items
    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(404).json({ error: 'Letter not found after update' });
      return;
    }

    res.json({
      letter: letterDTO,
      regenerated: {
        mainTranscript: true,
        extras: includeExtras,
        extrasCount: extrasTranscribed,
      },
    });
  } catch (error) {
    req.log.error({ err: error }, 'Transcription regeneration failed');
    next(error);
  }
});

/**
 * POST /admin/letters/:letterId/transcribe-letter - Transcribe only the letter content
 *
 * This is for manual transcription of just the letter pages (type='L').
 * Does NOT transcribe extra content (T, C, E types).
 * Used when a user wants to re-transcribe just the letter without affecting extras.
 */
router.post('/letters/:letterId/transcribe-letter', async (req, res, next) => {
  try {
    const { letterId } = req.params;

    // Fetch the letter
    const letter = await db.query.letters.findFirst({
      where: and(eq(letters.id, letterId), isNull(letters.deletedAt)),
      with: {
        collection: true,
        pages: { orderBy: (p, { asc }) => [asc(p.pageNumber)] },
      },
    });

    if (!letter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    // Only allow for type='L' letters
    if (letter.type !== 'L') {
      res.status(400).json({ error: 'Can only transcribe letter type (L)' });
      return;
    }

    req.log.info({ letterId }, 'Starting letter-only transcription');

    // Reset transcription-related fields to allow re-transcription
    await db.update(letters).set({
      workflow: 'UPLOADED',
      transcriptionStatus: 'PENDING',
      transcriptionError: null,
      transcriptionAttemptCount: 0,
      transcriptStatus: 'EMPTY',
      transcriptVerifiedAt: null,
      transcriptVerifiedBy: null,
      updatedAt: new Date(),
    }).where(eq(letters.id, letterId));

    // Run transcription on letter pages only (using transcribeImage directly)
    const { transcribeImage } = await import('../../ai/openai.js');
    const { getAbsoluteStoragePath } = await import('../../services/storage.js');

    const pages = letter.pages;
    if (pages.length === 0) {
      res.status(400).json({ error: 'Letter has no pages to transcribe' });
      return;
    }

    const pageTranscriptions: string[] = [];

    for (const page of pages) {
      const absolutePath = getAbsoluteStoragePath(page.storagePath);

      const result = await transcribeImage({
        filePath: absolutePath,
        context: {
          collectionCode: letter.collection.collectionCode,
          dateRaw: letter.dateRaw,
          pageNumber: page.pageNumber,
          totalPages: pages.length,
        },
      });

      pageTranscriptions.push(result.text);
    }

    // Combine transcriptions with page separators
    let combinedTranscription: string;
    if (pageTranscriptions.length === 1) {
      combinedTranscription = pageTranscriptions[0];
    } else {
      combinedTranscription = pageTranscriptions
        .map((text, i) => `--- Page ${i + 1} ---\n\n${text}`)
        .join('\n\n');
    }

    // Update letter with transcription (letter only, no extras)
    await db.update(letters).set({
      transcriptionText: combinedTranscription,
      transcriptionStatus: 'SUCCESS',
      transcriptionError: null,
      workflow: 'TRANSCRIBED',
      transcriptStatus: 'AI_DRAFT',
      updatedAt: new Date(),
    }).where(eq(letters.id, letterId));

    req.log.info({ letterId, pageCount: pages.length }, 'Letter-only transcription completed');

    // Fetch and return updated letter with related items
    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(404).json({ error: 'Letter not found after update' });
      return;
    }

    res.json({
      letter: letterDTO,
      transcribed: {
        pageCount: pages.length,
        textLength: combinedTranscription.length,
      },
    });
  } catch (error) {
    req.log.error({ err: error }, 'Letter-only transcription failed');
    next(error);
  }
});

// ============================================================================
// EXTRA CONTENT TRANSCRIPTION ENDPOINTS
// ============================================================================

/**
 * Map letter type codes to human-readable document types
 */
function getDocumentTypeFromCode(type: string): string {
  switch (type) {
    case 'T':
      return 'telegram';
    case 'C':
      return 'cover/envelope';
    case 'E':
      return 'ephemera';
    case 'N':
      return 'card';
    case 'P':
      return 'photo';
    default:
      return 'document';
  }
}

/**
 * POST /admin/letters/:letterId/transcribe-extras - Transcribe extra content for a letter
 *
 * Finds all related items (T, C, E types) and transcribes them.
 * Uses GPT-4o-mini to check if each has transcribable text first.
 * Combines all transcriptions into a single block with separators.
 */
router.post('/letters/:letterId/transcribe-extras', async (req, res, next) => {
  try {
    const { letterId } = req.params;

    // Fetch the letter and its related items
    const letter = await db.query.letters.findFirst({
      where: and(eq(letters.id, letterId), isNull(letters.deletedAt)),
      with: {
        collection: true,
        pages: { orderBy: (p, { asc }) => [asc(p.pageNumber)] },
      },
    });

    if (!letter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    // Fetch related items (T, C, E types with same date/sequence)
    const relatedItems = await db.query.letters.findMany({
      where: and(
        eq(letters.collectionId, letter.collectionId),
        eq(letters.dateRaw, letter.dateRaw),
        eq(letters.typeSequence, letter.typeSequence),
        inArray(letters.type, ['T', 'C', 'E']), // Only transcribable extra types
        isNull(letters.deletedAt)
      ),
      with: {
        pages: { orderBy: (p, { asc }) => [asc(p.pageNumber)] },
      },
      orderBy: (l, { asc }) => [asc(l.type)], // Consistent ordering
    });

    if (relatedItems.length === 0) {
      // No extra content to transcribe
      await db.update(letters).set({
        extraContentStatus: 'EMPTY',
        extraContentTranscript: null,
        updatedAt: new Date(),
      }).where(eq(letters.id, letterId));

      res.json({
        message: 'No extra content found to transcribe',
        extraContentStatus: 'EMPTY',
        transcribedCount: 0,
      });
      return;
    }

    req.log.info(
      { letterId, relatedCount: relatedItems.length, types: relatedItems.map(r => r.type) },
      'Starting extra content transcription'
    );

    // Group items by type and count them for numbering
    const typeCounters: Record<string, number> = {};
    const transcriptions: { type: string; index: number; text: string }[] = [];

    for (const item of relatedItems) {
      const docType = getDocumentTypeFromCode(item.type);

      // Count items of this type for numbering
      typeCounters[item.type] = (typeCounters[item.type] || 0) + 1;
      const typeIndex = typeCounters[item.type];

      // Process each page of this item
      for (const page of item.pages) {
        // Get the absolute file path for this page
        const { getAbsoluteStoragePath } = await import('../../services/storage.js');
        const filePath = getAbsoluteStoragePath(page.storagePath);

        // Check if this page has transcribable text
        const checkResult = await checkExtraContentForText({
          filePath,
          documentType: docType,
        });

        if (!checkResult.hasTranscribableText) {
          req.log.debug(
            { pageId: page.id, type: item.type, reason: checkResult.reason },
            'Skipping page - no transcribable text'
          );
          continue;
        }

        // Transcribe this page
        const transcription = await transcribeExtraContent({
          filePath,
          documentType: docType,
          context: {
            collectionCode: letter.collection.collectionCode,
            dateRaw: letter.dateRaw,
          },
        });

        if (transcription.text && transcription.text.trim()) {
          transcriptions.push({
            type: item.type,
            index: typeIndex,
            text: transcription.text.trim(),
          });
        }
      }
    }

    // Combine transcriptions with separators
    let combinedTranscript = '';
    if (transcriptions.length > 0) {
      // Count total items per type to determine if we need numbering
      const typeTotals: Record<string, number> = {};
      for (const item of relatedItems) {
        typeTotals[item.type] = (typeTotals[item.type] || 0) + 1;
      }

      // Build combined transcript
      const parts: string[] = [];
      for (const t of transcriptions) {
        const docTypeName = getDocumentTypeFromCode(t.type);
        // Capitalize first letter
        const displayName = docTypeName.charAt(0).toUpperCase() + docTypeName.slice(1);

        // Add number suffix only if there are multiple of this type
        const label = typeTotals[t.type] > 1
          ? `--- ${displayName} ${t.index} ---`
          : `--- ${displayName} ---`;

        parts.push(`${label}\n\n${t.text}`);
      }

      combinedTranscript = parts.join('\n\n');
    }

    // Update the letter with the combined transcript
    const newStatus = combinedTranscript ? 'AI_DRAFT' : 'EMPTY';
    await db.update(letters).set({
      extraContentTranscript: combinedTranscript || null,
      extraContentStatus: newStatus,
      updatedAt: new Date(),
    }).where(eq(letters.id, letterId));

    req.log.info(
      { letterId, transcribedCount: transcriptions.length, status: newStatus },
      'Extra content transcription completed'
    );

    // Fetch and return updated letter with related items
    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(404).json({ error: 'Letter not found after update' });
      return;
    }

    res.json({
      letter: letterDTO,
      transcribedCount: transcriptions.length,
      extraContentStatus: newStatus,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /admin/letters/:letterId/extra-content - Update extra content transcription
 */
router.put('/letters/:letterId/extra-content', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const { extraContentTranscript } = req.body;

    const existingLetter = await getLetterById(letterId);
    if (!existingLetter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    // Determine new status based on edit
    let newStatus = existingLetter.extraContentStatus;
    if (existingLetter.extraContentStatus === 'AI_DRAFT') {
      newStatus = 'EDITED';
    }

    await db.update(letters).set({
      extraContentTranscript: extraContentTranscript || null,
      extraContentStatus: newStatus,
      updatedAt: new Date(),
    }).where(eq(letters.id, letterId));

    req.log.debug({ letterId, previousStatus: existingLetter.extraContentStatus, newStatus }, 'Extra content updated');

    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(404).json({ error: 'Letter not found after update' });
      return;
    }

    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/letters/:letterId/verify-extra-content - Mark extra content as verified
 */
router.post('/letters/:letterId/verify-extra-content', async (req, res, next) => {
  try {
    const { letterId } = req.params;

    const existingLetter = await getLetterById(letterId);
    if (!existingLetter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    await db.update(letters).set({
      extraContentStatus: 'VERIFIED',
      extraContentVerifiedAt: new Date(),
      extraContentVerifiedBy: 'admin', // TODO: Use actual user when auth is implemented
      updatedAt: new Date(),
    }).where(eq(letters.id, letterId));

    req.log.info({ letterId, previousStatus: existingLetter.extraContentStatus }, 'Extra content verified');

    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(404).json({ error: 'Letter not found after update' });
      return;
    }

    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/letters/:letterId/unverify-extra-content - Reset extra content verification
 */
router.post('/letters/:letterId/unverify-extra-content', async (req, res, next) => {
  try {
    const { letterId } = req.params;

    const existingLetter = await getLetterById(letterId);
    if (!existingLetter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    if (existingLetter.extraContentStatus !== 'VERIFIED') {
      res.status(400).json({
        error: 'Extra content is not verified',
        currentStatus: existingLetter.extraContentStatus,
      });
      return;
    }

    await db.update(letters).set({
      extraContentStatus: 'EDITED',
      extraContentVerifiedAt: null,
      extraContentVerifiedBy: null,
      updatedAt: new Date(),
    }).where(eq(letters.id, letterId));

    req.log.info({ letterId }, 'Extra content verification removed');

    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(404).json({ error: 'Letter not found after update' });
      return;
    }

    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /admin/letters/:letterId/ai-notes - Update AI notes
 */
router.put('/letters/:letterId/ai-notes', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const { aiNotes } = req.body;

    const existingLetter = await getLetterById(letterId);
    if (!existingLetter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    await db.update(letters).set({
      aiNotes: aiNotes || null,
      updatedAt: new Date(),
    }).where(eq(letters.id, letterId));

    req.log.debug({ letterId }, 'AI notes updated');

    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(404).json({ error: 'Letter not found after update' });
      return;
    }

    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// LINKED ENTITY EDITING ENDPOINTS
// ============================================================================

const updateLinkedPersonSchema = z.object({
  canonicalName: z.string().min(1, 'Name is required'),
});

/**
 * PUT /admin/letters/:letterId/linked-persons/:linkId - Update a linked person's canonical name
 */
router.put('/letters/:letterId/linked-persons/:linkId', async (req, res, next) => {
  try {
    const { letterId, linkId } = req.params;

    const parseResult = updateLinkedPersonSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Invalid request body', details: parseResult.error.errors });
      return;
    }

    const { canonicalName } = parseResult.data;

    // Verify the link exists and belongs to this letter
    const link = await db.query.letterPersons.findFirst({
      where: and(
        eq(letterPersons.id, linkId),
        eq(letterPersons.letterId, letterId)
      ),
      with: { person: true },
    });

    if (!link) {
      res.status(404).json({ error: 'Linked person not found' });
      return;
    }

    // Update the canonical person's name
    await db.update(canonicalPersons).set({
      canonicalName,
      updatedAt: new Date(),
    }).where(eq(canonicalPersons.id, link.personId));

    req.log.info({ letterId, linkId, personId: link.personId, newName: canonicalName }, 'Linked person name updated');

    // Return updated letter
    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(404).json({ error: 'Letter not found after update' });
      return;
    }

    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

const updateLinkedPlaceSchema = z.object({
  canonicalName: z.string().min(1, 'Name is required'),
});

/**
 * PUT /admin/letters/:letterId/linked-places/:linkId - Update a linked place's canonical name
 */
router.put('/letters/:letterId/linked-places/:linkId', async (req, res, next) => {
  try {
    const { letterId, linkId } = req.params;

    const parseResult = updateLinkedPlaceSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Invalid request body', details: parseResult.error.errors });
      return;
    }

    const { canonicalName } = parseResult.data;

    // Verify the link exists and belongs to this letter
    const link = await db.query.letterPlaces.findFirst({
      where: and(
        eq(letterPlaces.id, linkId),
        eq(letterPlaces.letterId, letterId)
      ),
      with: { place: true },
    });

    if (!link) {
      res.status(404).json({ error: 'Linked place not found' });
      return;
    }

    // Update the canonical place's name
    await db.update(canonicalPlaces).set({
      canonicalName,
      updatedAt: new Date(),
    }).where(eq(canonicalPlaces.id, link.placeId));

    req.log.info({ letterId, linkId, placeId: link.placeId, newName: canonicalName }, 'Linked place name updated');

    // Return updated letter
    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(404).json({ error: 'Letter not found after update' });
      return;
    }

    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// ADD LINKED ENTITIES
// ============================================================================

const addLinkedPersonSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  role: z.enum(['sender', 'recipient', 'mentioned']),
});

/**
 * POST /admin/letters/:letterId/linked-persons - Add a linked person to a letter
 *
 * Creates or finds a canonical person and links them to this letter.
 */
router.post('/letters/:letterId/linked-persons', async (req, res, next) => {
  try {
    const { letterId } = req.params;

    // Verify letter exists
    const letter = await db.query.letters.findFirst({
      where: eq(letters.id, letterId),
    });

    if (!letter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    const parseResult = addLinkedPersonSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Invalid request body', details: parseResult.error.errors });
      return;
    }

    const { name, role } = parseResult.data;

    // Check if a canonical person with this exact name already exists
    let person = await db.query.canonicalPersons.findFirst({
      where: eq(canonicalPersons.canonicalName, name),
    });

    // If not found, create a new canonical person
    if (!person) {
      const [newPerson] = await db.insert(canonicalPersons).values({
        canonicalName: name,
      }).returning();
      person = newPerson;
      req.log.info({ letterId, personId: person.id, name }, 'Created new canonical person');
    }

    // Check if this person is already linked to this letter with this role
    const existingLink = await db.query.letterPersons.findFirst({
      where: and(
        eq(letterPersons.letterId, letterId),
        eq(letterPersons.personId, person.id),
        eq(letterPersons.role, role)
      ),
    });

    if (existingLink) {
      res.status(400).json({ error: 'Person already linked with this role' });
      return;
    }

    // Create the link
    await db.insert(letterPersons).values({
      letterId,
      personId: person.id,
      role,
      nameAsWritten: name,
      confidence: 100, // Manual link = high confidence
    });

    req.log.info({ letterId, personId: person.id, name, role }, 'Linked person to letter');

    // Return updated letter
    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(404).json({ error: 'Letter not found after update' });
      return;
    }

    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

const addLinkedPlaceSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  role: z.enum(['written_from', 'mentioned', 'destination']),
});

/**
 * POST /admin/letters/:letterId/linked-places - Add a linked place to a letter
 *
 * Creates or finds a canonical place and links them to this letter.
 */
router.post('/letters/:letterId/linked-places', async (req, res, next) => {
  try {
    const { letterId } = req.params;

    // Verify letter exists
    const letter = await db.query.letters.findFirst({
      where: eq(letters.id, letterId),
    });

    if (!letter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    const parseResult = addLinkedPlaceSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Invalid request body', details: parseResult.error.errors });
      return;
    }

    const { name, role } = parseResult.data;

    // Check if a canonical place with this exact name already exists
    let place = await db.query.canonicalPlaces.findFirst({
      where: eq(canonicalPlaces.canonicalName, name),
    });

    // If not found, create a new canonical place
    if (!place) {
      const [newPlace] = await db.insert(canonicalPlaces).values({
        canonicalName: name,
        placeType: 'other', // Default type
      }).returning();
      place = newPlace;
      req.log.info({ letterId, placeId: place.id, name }, 'Created new canonical place');
    }

    // Check if this place is already linked to this letter with this role
    const existingLink = await db.query.letterPlaces.findFirst({
      where: and(
        eq(letterPlaces.letterId, letterId),
        eq(letterPlaces.placeId, place.id),
        eq(letterPlaces.role, role)
      ),
    });

    if (existingLink) {
      res.status(400).json({ error: 'Place already linked with this role' });
      return;
    }

    // Create the link
    await db.insert(letterPlaces).values({
      letterId,
      placeId: place.id,
      role,
      nameAsWritten: name,
      confidence: 100, // Manual link = high confidence
    });

    req.log.info({ letterId, placeId: place.id, name, role }, 'Linked place to letter');

    // Return updated letter
    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(404).json({ error: 'Letter not found after update' });
      return;
    }

    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /admin/letters/:letterId/linked-persons/:linkId - Remove a linked person from a letter
 */
router.delete('/letters/:letterId/linked-persons/:linkId', async (req, res, next) => {
  try {
    const { letterId, linkId } = req.params;

    // Verify the link exists and belongs to this letter
    const link = await db.query.letterPersons.findFirst({
      where: and(
        eq(letterPersons.id, linkId),
        eq(letterPersons.letterId, letterId)
      ),
    });

    if (!link) {
      res.status(404).json({ error: 'Linked person not found' });
      return;
    }

    // Delete the link
    await db.delete(letterPersons).where(eq(letterPersons.id, linkId));

    req.log.info({ letterId, linkId }, 'Removed linked person from letter');

    // Return updated letter
    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(404).json({ error: 'Letter not found after update' });
      return;
    }

    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /admin/letters/:letterId/linked-places/:linkId - Remove a linked place from a letter
 */
router.delete('/letters/:letterId/linked-places/:linkId', async (req, res, next) => {
  try {
    const { letterId, linkId } = req.params;

    // Verify the link exists and belongs to this letter
    const link = await db.query.letterPlaces.findFirst({
      where: and(
        eq(letterPlaces.id, linkId),
        eq(letterPlaces.letterId, letterId)
      ),
    });

    if (!link) {
      res.status(404).json({ error: 'Linked place not found' });
      return;
    }

    // Delete the link
    await db.delete(letterPlaces).where(eq(letterPlaces.id, linkId));

    req.log.info({ letterId, linkId }, 'Removed linked place from letter');

    // Return updated letter
    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(404).json({ error: 'Letter not found after update' });
      return;
    }

    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// METADATA RE-SYNC ENDPOINTS
// ============================================================================

const resyncSchema = z.object({
  oldSender: z.string().nullable(),
  newSender: z.string().nullable(),
  oldRecipient: z.string().nullable(),
  newRecipient: z.string().nullable(),
});

/**
 * POST /admin/letters/:letterId/resync-check - Full metadata audit (decision only)
 *
 * Uses GPT-4o-mini to audit all metadata for consistency issues.
 * Does NOT actually update anything - just returns the decision.
 *
 * Checks:
 * - Summary uses actual names (not "the sender/recipient")
 * - Hook uses actual names
 * - Sender is linked as a person
 * - Recipient is linked as a person
 * - Relationship type is set
 */
router.post('/letters/:letterId/resync-check', async (req, res, next) => {
  try {
    const { letterId } = req.params;

    // Verify letter exists and fetch with linked persons
    const letter = await db.query.letters.findFirst({
      where: eq(letters.id, letterId),
      with: {
        collection: true,
        pages: { orderBy: (p, { asc: asc2 }) => [asc2(p.pageNumber)] },
        persons: {
          with: {
            person: true,
          },
        },
      },
    });

    if (!letter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    // Validate request body (optional change info)
    const parseResult = resyncSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Invalid request body', details: parseResult.error.errors });
      return;
    }
    const { oldSender, newSender, oldRecipient, newRecipient } = parseResult.data;

    req.log.debug(
      {
        letterId,
        sender: newSender || letter.sender,
        recipient: newRecipient || letter.recipient,
      },
      'Metadata audit requested'
    );

    // Build linked persons info
    const linkedPersons: LinkedPersonInfo[] = (letter.persons || []).map(lp => ({
      canonicalName: lp.person?.canonicalName || '',
      role: lp.role as 'sender' | 'recipient' | 'mentioned',
    }));

    // Extract quote contexts from metadataV2Json
    const metadataV2 = letter.metadataV2Json as {
      notable_quotes?: Array<{ text: string; context: string; position: 'opening' | 'middle' | 'closing' }>;
    } | null;
    const quoteContexts = metadataV2?.notable_quotes || [];

    // Build full audit context
    const auditContext: MetadataAuditContext = {
      sender: newSender || letter.sender || null,
      recipient: newRecipient || letter.recipient || null,
      date: letter.extractedDate || null,
      summary: letter.summary || null,
      hook: letter.hook || null,
      relationshipType: letter.senderRecipientRelationship || null,
      linkedPersons,
      quoteContexts,
    };

    // Build change info if there was a change
    const change = (oldSender !== newSender || oldRecipient !== newRecipient)
      ? { oldSender, newSender, oldRecipient, newRecipient }
      : undefined;

    // Call the audit function (fast model)
    const decision = await auditMetadata(auditContext, change);

    const needsResync =
      decision.shouldUpdateSummary ||
      decision.shouldUpdateHook ||
      decision.shouldCreateSenderPerson ||
      decision.shouldCreateRecipientPerson ||
      decision.shouldUpdateRelationship ||
      decision.shouldUpdateQuoteContexts;

    req.log.debug(
      {
        letterId,
        needsResync,
        issueCount: decision.issues.length,
        reason: decision.reason,
      },
      'Metadata audit completed'
    );

    res.json({
      needsResync,
      decision,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/letters/:letterId/resync - Full metadata sync
 *
 * Uses a two-model approach:
 * 1. GPT-5-mini audits all metadata for issues
 * 2. Main model regenerates/fixes the affected fields
 *
 * Can fix:
 * - Summary using generic terms instead of first names
 * - Hook using generic terms instead of first names
 * - Quote contexts using pronouns instead of first names
 * - Missing linked persons for sender/recipient (uses full names)
 * - Missing relationship type
 */
router.post('/letters/:letterId/resync', async (req, res, next) => {
  try {
    const { letterId } = req.params;

    // Verify letter exists and fetch with linked persons
    const letter = await db.query.letters.findFirst({
      where: eq(letters.id, letterId),
      with: {
        collection: true,
        pages: { orderBy: (p, { asc: asc2 }) => [asc2(p.pageNumber)] },
        persons: {
          with: {
            person: true,
          },
        },
      },
    });

    if (!letter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    // Validate request body (optional change info)
    const parseResult = resyncSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Invalid request body', details: parseResult.error.errors });
      return;
    }
    const { oldSender, newSender, oldRecipient, newRecipient } = parseResult.data;

    req.log.info(
      {
        letterId,
        sender: newSender || letter.sender,
        recipient: newRecipient || letter.recipient,
      },
      'Metadata sync requested'
    );

    // Build linked persons info
    const linkedPersons: LinkedPersonInfo[] = (letter.persons || []).map(lp => ({
      canonicalName: lp.person?.canonicalName || '',
      role: lp.role as 'sender' | 'recipient' | 'mentioned',
    }));

    // Extract quote contexts from metadataV2Json
    const existingMetadataV2 = letter.metadataV2Json as Record<string, unknown> | null;
    const quoteContexts = (existingMetadataV2?.notable_quotes || []) as Array<{
      text: string;
      context: string;
      position: 'opening' | 'middle' | 'closing';
    }>;

    // Build full audit context
    const auditContext: MetadataAuditContext = {
      sender: newSender || letter.sender || null,
      recipient: newRecipient || letter.recipient || null,
      date: letter.extractedDate || null,
      summary: letter.summary || null,
      hook: letter.hook || null,
      relationshipType: letter.senderRecipientRelationship || null,
      linkedPersons,
      quoteContexts,
    };

    // Build change info if there was a change
    const change = (oldSender !== newSender || oldRecipient !== newRecipient)
      ? { oldSender, newSender, oldRecipient, newRecipient }
      : undefined;

    // Get transcript
    const transcript = letter.transcriptionText || '';

    // Perform full resync using AI
    const result = await resyncMetadata({
      transcript,
      context: auditContext,
      change,
    });

    // If something was updated, save it
    if (result.wasUpdated) {
      const dbUpdates: Record<string, unknown> = {
        updatedAt: new Date(),
      };

      if (result.summary) {
        dbUpdates.summary = result.summary;
      }
      if (result.hook) {
        dbUpdates.hook = result.hook;
      }
      if (result.relationshipType) {
        // Normalize AI-generated relationship type to match database enum
        const normalizedRelationship = normalizeRelationshipType(result.relationshipType);
        if (normalizedRelationship) {
          dbUpdates.senderRecipientRelationship = normalizedRelationship;
        }
      }
      if (result.updatedQuoteContexts) {
        // Update quote contexts in metadataV2Json
        dbUpdates.metadataV2Json = {
          ...(existingMetadataV2 || {}),
          notable_quotes: result.updatedQuoteContexts,
        };
      }

      await db.update(letters).set(dbUpdates).where(eq(letters.id, letterId));

      // Create linked persons if needed
      if (result.senderPerson) {
        // Find or create canonical person
        let senderPerson = await db.query.canonicalPersons.findFirst({
          where: ilike(canonicalPersons.canonicalName, result.senderPerson.name),
        });

        if (!senderPerson) {
          const [newPerson] = await db.insert(canonicalPersons).values({
            canonicalName: result.senderPerson.name,
          }).returning();
          senderPerson = newPerson;
        }

        // Check if already linked
        const existingLink = await db.query.letterPersons.findFirst({
          where: and(
            eq(letterPersons.letterId, letterId),
            eq(letterPersons.personId, senderPerson.id),
            eq(letterPersons.role, 'sender')
          ),
        });

        if (!existingLink) {
          await db.insert(letterPersons).values({
            letterId,
            personId: senderPerson.id,
            role: 'sender',
            confidence: 100,
          });
        }
      }

      if (result.recipientPerson) {
        // Find or create canonical person
        let recipientPerson = await db.query.canonicalPersons.findFirst({
          where: ilike(canonicalPersons.canonicalName, result.recipientPerson.name),
        });

        if (!recipientPerson) {
          const [newPerson] = await db.insert(canonicalPersons).values({
            canonicalName: result.recipientPerson.name,
          }).returning();
          recipientPerson = newPerson;
        }

        // Check if already linked
        const existingLink = await db.query.letterPersons.findFirst({
          where: and(
            eq(letterPersons.letterId, letterId),
            eq(letterPersons.personId, recipientPerson.id),
            eq(letterPersons.role, 'recipient')
          ),
        });

        if (!existingLink) {
          await db.insert(letterPersons).values({
            letterId,
            personId: recipientPerson.id,
            role: 'recipient',
            confidence: 100,
          });
        }
      }

      req.log.info(
        {
          letterId,
          updatedSummary: Boolean(result.summary),
          updatedHook: Boolean(result.hook),
          createdSenderPerson: Boolean(result.senderPerson),
          createdRecipientPerson: Boolean(result.recipientPerson),
          updatedRelationship: Boolean(result.relationshipType),
          updatedQuoteContexts: Boolean(result.updatedQuoteContexts),
          decision: result.decision.reason,
        },
        'Metadata sync completed'
      );
    } else {
      req.log.info({ letterId, reason: result.decision.reason }, 'Metadata sync: no updates needed');
    }

    // Fetch and return updated letter with related items and entities
    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId, true);
    if (!letterDTO) {
      res.status(404).json({ error: 'Letter not found after update' });
      return;
    }

    res.json({
      letter: letterDTO,
      resync: {
        wasUpdated: result.wasUpdated,
        updatedFields: {
          summary: Boolean(result.summary),
          hook: Boolean(result.hook),
          senderPerson: Boolean(result.senderPerson),
          recipientPerson: Boolean(result.recipientPerson),
          relationshipType: Boolean(result.relationshipType),
          quoteContexts: Boolean(result.updatedQuoteContexts),
        },
        decision: result.decision,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /admin/letters/:letterId - Soft delete a letter
 */
router.delete('/letters/:letterId', async (req, res, next) => {
  try {
    const { letterId } = req.params;

    // Check letter exists
    const existingLetter = await getLetterById(letterId);
    if (!existingLetter) {
      req.log.warn({ letterId }, 'Delete requested for non-existent letter');
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    // Soft delete
    await db.update(letters).set({
      deletedAt: new Date(),
      deletedBy: 'admin', // TODO: Use actual user when auth is implemented
      updatedAt: new Date(),
    }).where(eq(letters.id, letterId));

    req.log.info({ letterId }, 'Letter soft deleted');
    res.json({ message: 'Letter deleted successfully', letterId });
  } catch (error) {
    next(error);
  }
});

export default router;
