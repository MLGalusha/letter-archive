import { Router } from 'express';
import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm';
import { db, letterPages, letters } from '../../db/index.js';
import { AppError } from '../../utils/response-helpers.js';

const router = Router();

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

export default router;
