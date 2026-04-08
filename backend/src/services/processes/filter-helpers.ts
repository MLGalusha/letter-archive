import { eq, and, inArray, sql, or, ilike, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db, letters, collections } from '../../db/index.js';

// ============================================================================
// Shared filter schema and query-builder for batch processes.
// ============================================================================
//
// Every batch process (transcription, metadata, entity extraction) accepts
// the same cross-cutting filters — collection, visibility, date range, etc.
// Rather than duplicating the schema and query-builder across three process
// configs, we hoist them here.

export const processingFilterSchema = z.object({
  collectionCode: z.string().optional(),
  visibility: z.enum(['PUBLISHED', 'HIDDEN']).optional(),
  search: z.string().optional(),
  year: z.coerce.number().min(1800).max(2100).optional(),
  month: z.coerce.number().min(1).max(12).optional(),
  day: z.coerce.number().min(1).max(31).optional(),
  dateFrom: z.string().regex(/^\d{8}$/).optional(),
  dateTo: z.string().regex(/^\d{8}$/).optional(),
});

export type ProcessingFilterOptions = z.infer<typeof processingFilterSchema>;

/**
 * Extend a base set of SQL conditions with the filter options. Returns
 * `collectionNotFound = true` if the filter references a collection code
 * that doesn't exist (caller should short-circuit to an empty result).
 */
export async function buildProcessingConditions(
  options: ProcessingFilterOptions,
  baseConditions: SQL[]
): Promise<{ conditions: SQL[]; collectionNotFound: boolean }> {
  const conditions: SQL[] = [...baseConditions];

  if (options.collectionCode) {
    const escapedCode = options.collectionCode.replace(/%/g, '\\%').replace(/_/g, '\\_');
    const matchingCollections = await db.query.collections.findMany({
      where: ilike(collections.collectionCode, `%${escapedCode}`),
    });
    if (matchingCollections.length > 0) {
      const collectionIds = matchingCollections.map(c => c.id);
      conditions.push(inArray(letters.collectionId, collectionIds));
    } else {
      return { conditions: [], collectionNotFound: true };
    }
  }

  if (options.visibility) {
    conditions.push(eq(letters.visibility, options.visibility));
  }

  if (options.search && options.search.trim()) {
    const escaped = options.search.trim().replace(/%/g, '\\%').replace(/_/g, '\\_');
    const searchTerm = `%${escaped}%`;
    const searchCond = or(
      ilike(letters.sender, searchTerm),
      ilike(letters.recipient, searchTerm),
      ilike(letters.summary, searchTerm),
      ilike(letters.hook, searchTerm)
    );
    if (searchCond) conditions.push(searchCond);
  }

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

  if (options.dateFrom && !options.year && !options.month && !options.day) {
    conditions.push(sql`REPLACE(${letters.dateRaw}, 'X', '0') >= ${options.dateFrom}`);
  }
  if (options.dateTo && !options.year && !options.month && !options.day) {
    conditions.push(sql`REPLACE(${letters.dateRaw}, 'X', '9') <= ${options.dateTo}`);
  }

  return { conditions, collectionNotFound: false };
}

/** Combine an array of conditions with AND, tolerating an empty array. */
export function allOf(conditions: SQL[]): SQL | undefined {
  if (conditions.length === 0) return undefined;
  if (conditions.length === 1) return conditions[0];
  return and(...conditions);
}
