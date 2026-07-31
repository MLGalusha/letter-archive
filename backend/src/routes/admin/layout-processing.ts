import { Router } from 'express';
import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db, letterPages, letters } from '../../db/index.js';
import {
  normalizeLineSegments,
  pageGeometryChecksum,
  pageLineSegmentsChecksum,
} from '../../schemas/page-geometry.js';
import { pageLayoutChecksumSchema } from '../../schemas/page-layout-v2.js';
import { AppError } from '../../utils/response-helpers.js';

const router = Router();

const rotationQueueQuerySchema = z.object({
  pageId: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
}).strict();

/**
 * Pages eligible for an operator-run layout pass.
 *
 * A source checksum is mandatory because both the detector envelope and the
 * eventual database update are fenced to these exact bytes. Existing mutable
 * review geometry does not disqualify a page: the native layout is stored as
 * separate immutable evidence and the existing review projection is preserved.
 */
router.get('/queue', async (_req, res, next) => {
  try {
    const rows = await db
      .select({
        pageId: letterPages.id,
        letterId: letters.id,
        pageNumber: letterPages.pageNumber,
        dateRaw: letters.dateRaw,
        primarySourceRevision: letters.primarySourceRevision,
        sourceChecksum: letterPages.checksumSha256,
      })
      .from(letterPages)
      .innerJoin(letters, eq(letterPages.letterId, letters.id))
      .where(and(
        eq(letters.type, 'L'),
        isNull(letterPages.pageLayout),
        isNotNull(letterPages.checksumSha256),
      ))
      .orderBy(
        asc(letters.dateRaw),
        asc(letters.typeSequence),
        asc(letterPages.pageNumber),
        asc(letterPages.id),
      );

    const pages = rows.map((row) => {
      if (!row.sourceChecksum) {
        throw new AppError(
          500,
          `Layout queue returned page ${row.pageId} without a source checksum`,
        );
      }
      return {
        pageId: row.pageId,
        letterId: row.letterId,
        pageNumber: row.pageNumber,
        dateRaw: row.dateRaw,
        primarySourceRevision: row.primarySourceRevision,
        sourceChecksum: row.sourceChecksum,
      };
    });

    res.json({ pages, total: pages.length });
  } catch (error) {
    next(error);
  }
});

/**
 * Pages eligible for an operator-run sideways-text recovery pass.
 *
 * Unlike the native-layout queue, a page remains eligible after native layout
 * evidence exists. Rotation recovery is proposed against the exact current
 * editable projection and is fenced by both its source and geometry identities.
 */
router.get('/rotation-queue', async (req, res, next) => {
  try {
    const query = rotationQueueQuerySchema.parse(req.query);
    const orderedRows = db
      .select({
        pageId: letterPages.id,
        letterId: letters.id,
        pageNumber: letterPages.pageNumber,
        dateRaw: letters.dateRaw,
        primarySourceRevision: letters.primarySourceRevision,
        sourceChecksum: letterPages.checksumSha256,
        lineSegments: letterPages.lineSegments,
        geometryRevision: letterPages.geometryRevision,
        storedGeometryChecksumSha256:
          letterPages.geometryChecksumSha256,
      })
      .from(letterPages)
      .innerJoin(letters, eq(letterPages.letterId, letters.id))
      .where(and(
        eq(letters.type, 'L'),
        isNotNull(letterPages.checksumSha256),
        isNotNull(letterPages.lineSegments),
        ...(query.pageId
          ? [eq(letterPages.id, query.pageId)]
          : []),
      ))
      .orderBy(
        asc(letters.dateRaw),
        asc(letters.typeSequence),
        asc(letterPages.pageNumber),
        asc(letterPages.id),
      );
    const rows = query.limit === undefined
      ? await orderedRows
      : await orderedRows.limit(query.limit);

    const pages = rows.flatMap((row) => {
      // The database predicate provides the normal exclusion path. Keeping
      // this defensive guard ensures an unexpected/mock row never becomes an
      // unfenced local work item.
      const sourceChecksum = pageLayoutChecksumSchema.safeParse(
        row.sourceChecksum,
      );
      if (!sourceChecksum.success) {
        if (
          row.sourceChecksum !== null
          && row.sourceChecksum !== undefined
        ) {
          throw new AppError(
            500,
            `Rotation queue found invalid source checksum for page ${row.pageId}`,
          );
        }
        return [];
      }
      if (
        row.lineSegments === null
        || row.lineSegments === undefined
      ) {
        return [];
      }

      let lineSegments;
      try {
        lineSegments = normalizeLineSegments(row.lineSegments);
      } catch {
        throw new AppError(
          500,
          `Rotation queue found invalid editable line segments for page ${row.pageId}`,
        );
      }
      const geometryChecksumSha256 = pageGeometryChecksum(lineSegments);
      if (
        row.geometryRevision > 0
        && row.storedGeometryChecksumSha256 === null
      ) {
        throw new AppError(
          500,
          `Rotation queue found incomplete geometry identity for page ${row.pageId}: `
            + 'a versioned geometry revision is missing its stored checksum',
        );
      }
      if (
        row.storedGeometryChecksumSha256 !== null
        && row.storedGeometryChecksumSha256 !== geometryChecksumSha256
      ) {
        throw new AppError(
          500,
          `Rotation queue found corrupt geometry for page ${row.pageId}: `
            + 'stored geometry checksum does not match editable line segments',
        );
      }

      return [{
        pageId: row.pageId,
        letterId: row.letterId,
        pageNumber: row.pageNumber,
        dateRaw: row.dateRaw,
        primarySourceRevision: row.primarySourceRevision,
        sourceChecksum: sourceChecksum.data,
        geometryRevision: row.geometryRevision,
        geometryChecksumSha256,
        lineSegmentsChecksumSha256:
          pageLineSegmentsChecksum(lineSegments),
      }];
    });

    res.json({ pages, total: pages.length });
  } catch (error) {
    next(error);
  }
});

export default router;
