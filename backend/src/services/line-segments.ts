import { and, eq, isNull } from 'drizzle-orm';
import {
  db,
  letterPages,
  letters,
  pageGeometryReviewEvents,
  pageGeometryRevisions,
} from '../db/index.js';
import {
  geometryChangeSummary,
  geometrySnapshot,
  normalizeLineSegments,
  pageGeometryChecksum,
  pageLineSegmentsChecksum,
  validateGeometryProvenanceTransition,
  type PageGeometryEnvelope,
} from '../schemas/page-geometry.js';
import type { LineSegment } from '../schemas/line-segment.js';
import type { PageSourceExpectation } from './page-source-bound-write.js';

export type { PageSourceExpectation } from './page-source-bound-write.js';
export type { LineSegment } from '../schemas/line-segment.js';
export type { PageGeometryEnvelope } from '../schemas/page-geometry.js';

export interface PageGeometryExpectation extends PageSourceExpectation {
  expectedGeometryRevision: number;
  expectedLineSegmentsChecksumSha256: string;
}

export interface PageGeometryApprovalExpectation extends PageSourceExpectation {
  expectedGeometryRevision: number;
  expectedGeometryChecksumSha256: string;
}

export type PageGeometryMutationResult =
  | { kind: 'saved'; envelope: PageGeometryEnvelope }
  | { kind: 'not-found' }
  | { kind: 'source-conflict' }
  | { kind: 'geometry-conflict' }
  | { kind: 'projection-conflict' }
  | { kind: 'invalid-transition'; issues: string[] };

interface GeometryPageRow {
  id: string;
  letterId: string;
  checksumSha256: string | null;
  pageLayoutChecksumSha256: string | null;
  lineSegments: unknown;
  geometryRevision: number;
  geometryChecksumSha256: string | null;
  segmentTrustState: string;
  approvedGeometryRevision: number | null;
  approvedGeometryChecksumSha256: string | null;
  geometryApprovedBy: string | null;
  geometryApprovedAt: Date | null;
}

class StoredGeometryIntegrityError extends Error {
  constructor() {
    super('Stored geometry checksum does not match its mutable projection');
  }
}

const geometryPageSelection = {
  id: letterPages.id,
  letterId: letterPages.letterId,
  checksumSha256: letterPages.checksumSha256,
  pageLayoutChecksumSha256: letterPages.pageLayoutChecksumSha256,
  lineSegments: letterPages.lineSegments,
  geometryRevision: letterPages.geometryRevision,
  geometryChecksumSha256: letterPages.geometryChecksumSha256,
  segmentTrustState: letterPages.segmentTrustState,
  approvedGeometryRevision: letterPages.approvedGeometryRevision,
  approvedGeometryChecksumSha256:
    letterPages.approvedGeometryChecksumSha256,
  geometryApprovedBy: letterPages.geometryApprovedBy,
  geometryApprovedAt: letterPages.geometryApprovedAt,
};

function sourceChecksumCondition(expected: string | null) {
  return expected === null
    ? isNull(letterPages.checksumSha256)
    : eq(letterPages.checksumSha256, expected);
}

function asDateIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function pageGeometryEnvelopeFromRow(
  page: Omit<GeometryPageRow, 'id' | 'letterId' | 'pageLayoutChecksumSha256' | 'checksumSha256'>,
): PageGeometryEnvelope {
  const lineSegments = normalizeLineSegments(page.lineSegments ?? []);
  const checksum = pageGeometryChecksum(lineSegments);
  if (
    page.geometryChecksumSha256 !== null
    && page.geometryChecksumSha256 !== undefined
    && page.geometryChecksumSha256 !== checksum
  ) {
    throw new StoredGeometryIntegrityError();
  }
  const approvalIsCurrent = (
    page.segmentTrustState === 'trusted'
    && page.approvedGeometryRevision === page.geometryRevision
    && page.approvedGeometryChecksumSha256 === checksum
    && Boolean(page.geometryApprovedBy)
    && Boolean(page.geometryApprovedAt)
  );
  return {
    lineSegments,
    geometryRevision: page.geometryRevision ?? 0,
    // Recomputing makes legacy revision-zero rows immediately safe to edit
    // without requiring a lossy SQL rewrite of their JSON.
    geometryChecksumSha256: checksum,
    lineSegmentsChecksumSha256: pageLineSegmentsChecksum(lineSegments),
    reviewState: approvalIsCurrent
      ? {
        trustState: 'trusted',
        approvedGeometryRevision: page.approvedGeometryRevision,
        approvedGeometryChecksumSha256:
          page.approvedGeometryChecksumSha256,
        approvedBy: page.geometryApprovedBy,
        approvedAt: asDateIso(page.geometryApprovedAt),
      }
      : {
        trustState: 'unverified',
        approvedGeometryRevision: null,
        approvedGeometryChecksumSha256: null,
        approvedBy: null,
        approvedAt: null,
      },
  };
}

export async function getPageGeometryEnvelope(
  pageId: string,
): Promise<PageGeometryEnvelope | null> {
  const page = await db.query.letterPages.findFirst({
    where: eq(letterPages.id, pageId),
    columns: {
      lineSegments: true,
      geometryRevision: true,
      geometryChecksumSha256: true,
      segmentTrustState: true,
      approvedGeometryRevision: true,
      approvedGeometryChecksumSha256: true,
      geometryApprovedBy: true,
      geometryApprovedAt: true,
    },
  });
  return page ? pageGeometryEnvelopeFromRow(page) : null;
}

function sourceMatches(
  page: Pick<GeometryPageRow, 'checksumSha256'>,
  actualPrimarySourceRevision: number,
  expected: PageSourceExpectation,
): boolean {
  return (
    page.checksumSha256 === expected.sourceChecksum
    && actualPrimarySourceRevision === expected.primarySourceRevision
  );
}

class RolledBackGeometryWrite extends Error {}

/**
 * Persists an editable projection and creates an immutable revision only when
 * actual geometry/provenance changed. Mapping, exclusion, and classification
 * edits remain review metadata and therefore do not falsely claim a human
 * geometry operation or invalidate a still-current shape approval.
 */
export async function savePageLineSegments(
  pageId: string,
  segments: LineSegment[],
  expected: PageGeometryExpectation,
  actorId: string,
): Promise<PageGeometryMutationResult> {
  const missingIds = segments
    .map((segment, index) => ({ segment, index }))
    .filter(({ segment }) => !segment.id)
    .map(({ index }) => `Segment at index ${index} is missing a stable ID`);
  if (missingIds.length > 0) {
    return { kind: 'invalid-transition', issues: missingIds };
  }
  const normalizedSegments = normalizeLineSegments(segments);

  try {
    return await db.transaction(async (tx): Promise<PageGeometryMutationResult> => {
      const [pageOwner] = await tx
        .select({ letterId: letterPages.letterId })
        .from(letterPages)
        .where(eq(letterPages.id, pageId));
      if (!pageOwner) return { kind: 'not-found' };

      const [owner] = await tx
        .select({
          id: letters.id,
          primarySourceRevision: letters.primarySourceRevision,
        })
        .from(letters)
        .where(eq(letters.id, pageOwner.letterId))
        .for('update');
      if (!owner) return { kind: 'not-found' };

      const [page] = await tx
        .select(geometryPageSelection)
        .from(letterPages)
        .where(eq(letterPages.id, pageId))
        .for('update') as GeometryPageRow[];
      if (!page) return { kind: 'not-found' };
      if (!sourceMatches(page, owner.primarySourceRevision, expected)) {
        return { kind: 'source-conflict' };
      }
      if (page.geometryRevision !== expected.expectedGeometryRevision) {
        return { kind: 'geometry-conflict' };
      }

      const currentSegments = normalizeLineSegments(page.lineSegments ?? []);
      const currentChecksum = pageGeometryChecksum(currentSegments);
      if (
        page.geometryChecksumSha256 !== null
        && page.geometryChecksumSha256 !== currentChecksum
      ) {
        throw new StoredGeometryIntegrityError();
      }
      const currentLineSegmentsChecksum = pageLineSegmentsChecksum(
        currentSegments,
      );
      if (
        currentLineSegmentsChecksum
          !== expected.expectedLineSegmentsChecksumSha256
      ) {
        return { kind: 'projection-conflict' };
      }
      const nextChecksum = pageGeometryChecksum(normalizedSegments);
      const geometryChanged = currentChecksum !== nextChecksum;
      const provenanceIssues = validateGeometryProvenanceTransition(
        currentSegments,
        normalizedSegments,
      );
      if (provenanceIssues.length > 0) {
        return {
          kind: 'invalid-transition',
          issues: provenanceIssues,
        };
      }
      const now = new Date();
      const nextRevision = geometryChanged
        ? page.geometryRevision + 1
        : page.geometryRevision;

      if (geometryChanged) {
        if (page.geometryRevision === 0) {
          await tx.insert(pageGeometryRevisions).values({
            pageId,
            revision: 0,
            primarySourceRevision: expected.primarySourceRevision,
            sourceChecksumSha256: expected.sourceChecksum,
            basePageLayoutChecksumSha256: page.pageLayoutChecksumSha256,
            geometryChecksumSha256: currentChecksum,
            geometrySnapshot: geometrySnapshot(currentSegments),
            changeSummary: geometryChangeSummary(
              currentSegments,
              currentSegments,
            ),
            createdBy: 'system:legacy-baseline',
            createdAt: now,
          }).onConflictDoNothing({
            target: [
              pageGeometryRevisions.pageId,
              pageGeometryRevisions.primarySourceRevision,
              pageGeometryRevisions.revision,
            ],
          });
        }
        await tx.insert(pageGeometryRevisions).values({
          pageId,
          revision: nextRevision,
          primarySourceRevision: expected.primarySourceRevision,
          sourceChecksumSha256: expected.sourceChecksum,
          basePageLayoutChecksumSha256: page.pageLayoutChecksumSha256,
          geometryChecksumSha256: nextChecksum,
          geometrySnapshot: geometrySnapshot(normalizedSegments),
          changeSummary: geometryChangeSummary(
            currentSegments,
            normalizedSegments,
          ),
          createdBy: actorId,
          createdAt: now,
        });
      }

      const [updated] = await tx
        .update(letterPages)
        .set({
          lineSegments: normalizedSegments,
          geometryRevision: nextRevision,
          geometryChecksumSha256: nextChecksum,
          ...(geometryChanged
            ? {
              segmentTrustState: 'unverified',
              approvedGeometryRevision: null,
              approvedGeometryChecksumSha256: null,
              geometryApprovedBy: null,
              geometryApprovedAt: null,
            }
            : {}),
          updatedAt: now,
        })
        .where(and(
          eq(letterPages.id, pageId),
          sourceChecksumCondition(expected.sourceChecksum),
          eq(letterPages.geometryRevision, expected.expectedGeometryRevision),
        ))
        .returning(geometryPageSelection) as GeometryPageRow[];
      if (!updated) {
        // Throwing is important: if the revision insert happened first, the
        // transaction must not leave an orphan history row.
        throw new RolledBackGeometryWrite();
      }
      return {
        kind: 'saved',
        envelope: pageGeometryEnvelopeFromRow(updated),
      };
    });
  } catch (error) {
    if (!(error instanceof RolledBackGeometryWrite)) throw error;
    const current = await db.query.letterPages.findFirst({
      where: eq(letterPages.id, pageId),
      columns: {
        checksumSha256: true,
        geometryRevision: true,
        lineSegments: true,
        letterId: true,
      },
      with: {
        letter: {
          columns: { primarySourceRevision: true },
        },
      },
    });
    if (!current) return { kind: 'not-found' };
    if (
      current.checksumSha256 !== expected.sourceChecksum
      || current.letter.primarySourceRevision
        !== expected.primarySourceRevision
    ) {
      return { kind: 'source-conflict' };
    }
    if (current.geometryRevision !== expected.expectedGeometryRevision) {
      return { kind: 'geometry-conflict' };
    }
    return pageLineSegmentsChecksum(current.lineSegments ?? [])
      !== expected.expectedLineSegmentsChecksumSha256
      ? { kind: 'projection-conflict' }
      : { kind: 'geometry-conflict' };
  }
}

export async function updatePageSegmentTrust(
  pageId: string,
  trustState: 'unverified' | 'trusted',
  expected: PageGeometryApprovalExpectation,
  actorId: string,
): Promise<PageGeometryMutationResult> {
  return db.transaction(async (tx): Promise<PageGeometryMutationResult> => {
    const [pageOwner] = await tx
      .select({ letterId: letterPages.letterId })
      .from(letterPages)
      .where(eq(letterPages.id, pageId));
    if (!pageOwner) return { kind: 'not-found' };
    const [owner] = await tx
      .select({
        id: letters.id,
        primarySourceRevision: letters.primarySourceRevision,
      })
      .from(letters)
      .where(eq(letters.id, pageOwner.letterId))
      .for('update');
    if (!owner) return { kind: 'not-found' };
    const [page] = await tx
      .select(geometryPageSelection)
      .from(letterPages)
      .where(eq(letterPages.id, pageId))
      .for('update') as GeometryPageRow[];
    if (!page) return { kind: 'not-found' };
    if (!sourceMatches(page, owner.primarySourceRevision, expected)) {
      return { kind: 'source-conflict' };
    }

    const envelope = pageGeometryEnvelopeFromRow(page);
    if (
      envelope.geometryRevision !== expected.expectedGeometryRevision
      || envelope.geometryChecksumSha256
        !== expected.expectedGeometryChecksumSha256
    ) {
      return { kind: 'geometry-conflict' };
    }

    const now = new Date();
    await tx.insert(pageGeometryReviewEvents).values({
      pageId,
      primarySourceRevision: expected.primarySourceRevision,
      sourceChecksumSha256: expected.sourceChecksum,
      geometryRevision: envelope.geometryRevision,
      geometryChecksumSha256: envelope.geometryChecksumSha256,
      decision: trustState,
      reviewedBy: actorId,
      reviewedAt: now,
    });
    const [updated] = await tx
      .update(letterPages)
      .set({
        geometryChecksumSha256: envelope.geometryChecksumSha256,
        segmentTrustState: trustState,
        ...(trustState === 'trusted'
          ? {
            approvedGeometryRevision: envelope.geometryRevision,
            approvedGeometryChecksumSha256:
              envelope.geometryChecksumSha256,
            geometryApprovedBy: actorId,
            geometryApprovedAt: now,
          }
          : {
            approvedGeometryRevision: null,
            approvedGeometryChecksumSha256: null,
            geometryApprovedBy: null,
            geometryApprovedAt: null,
          }),
        updatedAt: now,
      })
      .where(and(
        eq(letterPages.id, pageId),
        sourceChecksumCondition(expected.sourceChecksum),
        eq(letterPages.geometryRevision, expected.expectedGeometryRevision),
      ))
      .returning(geometryPageSelection) as GeometryPageRow[];
    // The page is locked; this can only lose to an out-of-band writer.
    if (!updated) {
      throw new RolledBackGeometryWrite();
    }
    return {
      kind: 'saved',
      envelope: pageGeometryEnvelopeFromRow(updated),
    };
  }).catch((error: unknown) => {
    if (error instanceof RolledBackGeometryWrite) {
      return { kind: 'geometry-conflict' } as const;
    }
    throw error;
  });
}

export interface LetterPageGeometryApprovalExpectation {
  pageId: string;
  sourceChecksum: string | null;
  expectedGeometryRevision: number;
  expectedGeometryChecksumSha256: string;
}

/**
 * Bulk approval is all-or-nothing: one stale page prevents every event and
 * projection update in the letter from committing.
 */
export async function updateLetterSegmentTrust(
  letterId: string,
  trustState: 'unverified' | 'trusted',
  expectedRevision: number,
  expectedPages: LetterPageGeometryApprovalExpectation[],
  actorId: string,
): Promise<boolean> {
  try {
    return await db.transaction(async (tx) => {
      const [letter] = await tx
        .select({ primarySourceRevision: letters.primarySourceRevision })
        .from(letters)
        .where(eq(letters.id, letterId))
        .for('update');
      if (letter?.primarySourceRevision !== expectedRevision) {
        throw new RolledBackGeometryWrite();
      }
      const pages = await tx
        .select(geometryPageSelection)
        .from(letterPages)
        .where(eq(letterPages.letterId, letterId))
        .for('update') as GeometryPageRow[];
      const expectedById = new Map(
        expectedPages.map((page) => [page.pageId, page]),
      );
      if (
        pages.length === 0
        || pages.length !== expectedById.size
        || pages.some((page) => {
          const expected = expectedById.get(page.id);
          if (!expected) return true;
          const envelope = pageGeometryEnvelopeFromRow(page);
          return (
            page.checksumSha256 !== expected.sourceChecksum
            || envelope.geometryRevision
              !== expected.expectedGeometryRevision
            || envelope.geometryChecksumSha256
              !== expected.expectedGeometryChecksumSha256
          );
        })
      ) {
        throw new RolledBackGeometryWrite();
      }

      const now = new Date();
      await tx.insert(pageGeometryReviewEvents).values(
        pages.map((page) => {
          const envelope = pageGeometryEnvelopeFromRow(page);
          return {
            pageId: page.id,
            primarySourceRevision: expectedRevision,
            sourceChecksumSha256: page.checksumSha256,
            geometryRevision: envelope.geometryRevision,
            geometryChecksumSha256: envelope.geometryChecksumSha256,
            decision: trustState,
            reviewedBy: actorId,
            reviewedAt: now,
          };
        }),
      );
      for (const page of pages) {
        const envelope = pageGeometryEnvelopeFromRow(page);
        const [updated] = await tx
          .update(letterPages)
          .set({
            geometryChecksumSha256: envelope.geometryChecksumSha256,
            segmentTrustState: trustState,
            ...(trustState === 'trusted'
              ? {
                approvedGeometryRevision: envelope.geometryRevision,
                approvedGeometryChecksumSha256:
                  envelope.geometryChecksumSha256,
                geometryApprovedBy: actorId,
                geometryApprovedAt: now,
              }
              : {
                approvedGeometryRevision: null,
                approvedGeometryChecksumSha256: null,
                geometryApprovedBy: null,
                geometryApprovedAt: null,
              }),
            updatedAt: now,
          })
          .where(and(
            eq(letterPages.id, page.id),
            sourceChecksumCondition(page.checksumSha256),
            eq(letterPages.geometryRevision, page.geometryRevision),
          ))
          .returning({ id: letterPages.id });
        if (!updated) throw new RolledBackGeometryWrite();
      }
      return true;
    });
  } catch (error) {
    if (error instanceof RolledBackGeometryWrite) return false;
    throw error;
  }
}
