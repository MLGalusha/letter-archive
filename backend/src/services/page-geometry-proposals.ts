import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  db,
  letterPages,
  letters,
  pageGeometryProposals,
  type PageGeometryProposalRow,
} from '../db/index.js';
import {
  normalizeLineSegments,
  pageGeometryChecksum,
  pageLineSegmentsChecksum,
} from '../schemas/page-geometry.js';
import {
  pageGeometryProposalArtifactChecksum,
  pageGeometryProposalV1Schema,
  type PageGeometryProposalV1,
  type RotationRecoveryCandidateSegment,
} from '../schemas/page-geometry-proposal.js';
import {
  pageLayoutChecksumSchema,
  pageLayoutRotationProfileSchema,
  pageLayoutV2Schema,
  type PageLayoutV2,
} from '../schemas/page-layout-v2.js';
import { pageLayoutToLineSegments } from './page-layout.js';

const actorIdSchema = z.string().trim().min(1).max(512);

const pageGeometryProposalIdentitySchema = z.object({
  primarySourceRevision: z.number().int().nonnegative(),
  sourceChecksumSha256: pageLayoutChecksumSchema,
  baseGeometryRevision: z.number().int().nonnegative(),
  baseGeometryChecksumSha256: pageLayoutChecksumSchema,
  baseLineSegmentsChecksumSha256: pageLayoutChecksumSchema,
}).strict();

export type PageGeometryProposalIdentity = z.infer<
  typeof pageGeometryProposalIdentitySchema
>;

export interface StoredPageGeometryProposal {
  id: string;
  artifactChecksumSha256: string;
  artifact: PageGeometryProposalV1;
  createdBy: string;
  createdAt: Date;
}

export type BuildPageGeometryProposalResult =
  | {
    kind: 'proposal';
    artifact: PageGeometryProposalV1;
    artifactChecksumSha256: string;
  }
  | {
    kind: 'no-candidates';
  }
  | {
    kind: 'source-conflict';
  };

export type SavePageGeometryProposalResult =
  | {
    kind: 'saved' | 'already-exists';
    value: StoredPageGeometryProposal;
  }
  | {
    kind:
      | 'no-candidates'
      | 'not-found'
      | 'source-conflict'
      | 'geometry-conflict'
      | 'projection-conflict';
  };

export type GetCurrentPageGeometryProposalResult =
  | {
    kind: 'found';
    value: StoredPageGeometryProposal;
  }
  | {
    kind: 'none';
  }
  | {
    kind: 'not-found';
  }
  | {
    kind: 'corrupt-current-geometry';
  }
  | {
    kind: 'corrupt-current-source';
  };

export interface SavePageGeometryProposalInput {
  layout: PageLayoutV2;
  expected: PageGeometryProposalIdentity;
  actorId: string;
}

function geometryOnlyCandidate(
  segment: ReturnType<typeof pageLayoutToLineSegments>[number],
): RotationRecoveryCandidateSegment {
  return {
    id: segment.id!,
    line: segment.line,
    geometryType: segment.geometryType!,
    ...(segment.providerId ? { providerId: segment.providerId } : {}),
    ...(segment.providerTextDirection
      ? { providerTextDirection: segment.providerTextDirection }
      : {}),
    rotationEvidence: segment.rotationEvidence!,
    ...(segment.baseline ? { baseline: segment.baseline } : {}),
    bbox: segment.bbox,
    ...(segment.bboxSource ? { bboxSource: segment.bboxSource } : {}),
    geometryProvenance: segment.geometryProvenance!,
    ocrText: '',
    ...(segment.boundary ? { boundary: segment.boundary } : {}),
  };
}

/**
 * Builds a content-addressed geometry-only proposal from a complete detector
 * document. Existing body lines are deliberately filtered out and are never
 * copied into the proposal artifact.
 */
export function buildPageGeometryProposal(
  layoutInput: PageLayoutV2,
  expectedInput: PageGeometryProposalIdentity,
): BuildPageGeometryProposalResult {
  const layout = pageLayoutV2Schema.parse(layoutInput);
  const expected = pageGeometryProposalIdentitySchema.parse(expectedInput);
  const layoutSourceChecksumSha256 = (
    layout.image.source?.checksumSha256
    ?? layout.image.checksumSha256
  );
  if (layoutSourceChecksumSha256 !== expected.sourceChecksumSha256) {
    return { kind: 'source-conflict' };
  }

  const rotationProfile = pageLayoutRotationProfileSchema.parse(
    layout.provenance.config.parameters?.rotationProfile,
  );
  const candidateIds = new Set(
    layout.lines
      .filter((line) => (
        line.rotationEvidence?.readingOrderSource
        === 'unresolved-rotated-proposal'
      ))
      .map((line) => line.id),
  );
  const candidates = pageLayoutToLineSegments(layout)
    .filter((segment) => segment.id && candidateIds.has(segment.id))
    .map(geometryOnlyCandidate);

  if (candidates.length === 0) {
    if (
      rotationProfile.selectionSummary.appendedRotatedLineCount
      !== candidates.length
    ) {
      throw new Error(
        'Rotation profile candidate count does not match the adapted layout',
      );
    }
    return { kind: 'no-candidates' };
  }

  const artifact = pageGeometryProposalV1Schema.parse({
    schemaVersion: 1,
    kind: 'rotation-recovery',
    pageId: layout.pageId,
    source: {
      ...expected,
      image: layout.image,
    },
    provenance: layout.provenance,
    rotationProfile,
    run: {
      id: layout.runId,
    },
    candidates,
  });
  return {
    kind: 'proposal',
    artifact,
    artifactChecksumSha256:
      pageGeometryProposalArtifactChecksum(artifact),
  };
}

function rowToStoredProposal(
  row: PageGeometryProposalRow,
): StoredPageGeometryProposal {
  const artifact = pageGeometryProposalV1Schema.parse(row.artifact);
  const artifactChecksumSha256 =
    pageGeometryProposalArtifactChecksum(artifact);
  if (artifactChecksumSha256 !== row.artifactChecksumSha256) {
    throw new Error(
      `Stored page geometry proposal checksum mismatch: ${row.id}`,
    );
  }
  const artifactSourceChecksumSha256 = (
    artifact.source.image.source?.checksumSha256
    ?? artifact.source.image.checksumSha256
  );
  if (
    artifact.pageId !== row.pageId
    || artifact.schemaVersion !== row.schemaVersion
    || artifact.kind !== row.kind
    || artifact.source.primarySourceRevision
      !== row.primarySourceRevision
    || artifact.source.sourceChecksumSha256
      !== row.sourceChecksumSha256
    || artifact.source.baseGeometryRevision
      !== row.baseGeometryRevision
    || artifact.source.baseGeometryChecksumSha256
      !== row.baseGeometryChecksumSha256
    || artifact.source.baseLineSegmentsChecksumSha256
      !== row.baseLineSegmentsChecksumSha256
    || artifact.run.id !== row.runId
    || artifactSourceChecksumSha256
      !== artifact.source.sourceChecksumSha256
  ) {
    throw new Error(
      `Stored page geometry proposal identity mismatch: ${row.id}`,
    );
  }

  return {
    id: row.id,
    artifactChecksumSha256,
    artifact,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

export function createPageGeometryProposalRepository(
  database: typeof db = db,
) {
  return {
    async getCurrent(
      pageIdInput: string,
    ): Promise<GetCurrentPageGeometryProposalResult> {
      const pageId = z.string().uuid().parse(pageIdInput);
      return database.transaction(async (tx) => {
        const pagePointer = await tx.query.letterPages.findFirst({
          where: eq(letterPages.id, pageId),
          columns: { letterId: true },
        });
        if (!pagePointer) return { kind: 'not-found' };

        // Keep the same owner -> page lock order as every geometry write. The
        // transaction is read-only at the application layer, but these locks
        // make the identity and proposal lookup one stable observation.
        const ownerRows = await tx
          .select({
            id: letters.id,
            primarySourceRevision: letters.primarySourceRevision,
          })
          .from(letters)
          .where(eq(letters.id, pagePointer.letterId))
          .for('update');
        const owner = ownerRows[0];
        if (!owner) return { kind: 'not-found' };

        const pageRows = await tx
          .select({
            letterId: letterPages.letterId,
            checksumSha256: letterPages.checksumSha256,
            geometryRevision: letterPages.geometryRevision,
            geometryChecksumSha256: letterPages.geometryChecksumSha256,
            lineSegments: letterPages.lineSegments,
          })
          .from(letterPages)
          .where(eq(letterPages.id, pageId))
          .for('update');
        const page = pageRows[0];
        if (!page) return { kind: 'not-found' };
        if (page.letterId !== pagePointer.letterId) {
          return { kind: 'none' };
        }

        let lineSegments;
        try {
          lineSegments = normalizeLineSegments(page.lineSegments);
        } catch {
          return { kind: 'corrupt-current-geometry' };
        }
        const baseGeometryChecksumSha256 =
          pageGeometryChecksum(lineSegments);
        if (
          (
            page.geometryRevision > 0
            && page.geometryChecksumSha256 === null
          )
          || (
            page.geometryChecksumSha256 !== null
            && page.geometryChecksumSha256
              !== baseGeometryChecksumSha256
          )
        ) {
          return { kind: 'corrupt-current-geometry' };
        }
        if (!page.checksumSha256) return { kind: 'none' };
        const currentSourceChecksum = pageLayoutChecksumSchema.safeParse(
          page.checksumSha256,
        );
        if (!currentSourceChecksum.success) {
          return { kind: 'corrupt-current-source' };
        }

        const currentIdentity: PageGeometryProposalIdentity = {
          primarySourceRevision: owner.primarySourceRevision,
          sourceChecksumSha256: currentSourceChecksum.data,
          baseGeometryRevision: page.geometryRevision,
          baseGeometryChecksumSha256,
          baseLineSegmentsChecksumSha256:
            pageLineSegmentsChecksum(lineSegments),
        };
        const row = await tx.query.pageGeometryProposals.findFirst({
          where: and(
            eq(pageGeometryProposals.pageId, pageId),
            eq(
              pageGeometryProposals.primarySourceRevision,
              currentIdentity.primarySourceRevision,
            ),
            eq(
              pageGeometryProposals.sourceChecksumSha256,
              currentIdentity.sourceChecksumSha256,
            ),
            eq(
              pageGeometryProposals.baseGeometryRevision,
              currentIdentity.baseGeometryRevision,
            ),
            eq(
              pageGeometryProposals.baseGeometryChecksumSha256,
              currentIdentity.baseGeometryChecksumSha256,
            ),
            eq(
              pageGeometryProposals.baseLineSegmentsChecksumSha256,
              currentIdentity.baseLineSegmentsChecksumSha256,
            ),
          ),
          orderBy: [
            desc(pageGeometryProposals.createdAt),
            desc(pageGeometryProposals.id),
          ],
        });
        if (!row) return { kind: 'none' };

        const value = rowToStoredProposal(row);
        if (
          value.artifact.pageId !== pageId
          || value.artifact.source.primarySourceRevision
            !== currentIdentity.primarySourceRevision
          || value.artifact.source.sourceChecksumSha256
            !== currentIdentity.sourceChecksumSha256
          || value.artifact.source.baseGeometryRevision
            !== currentIdentity.baseGeometryRevision
          || value.artifact.source.baseGeometryChecksumSha256
            !== currentIdentity.baseGeometryChecksumSha256
          || value.artifact.source.baseLineSegmentsChecksumSha256
            !== currentIdentity.baseLineSegmentsChecksumSha256
        ) {
          throw new Error(
            `Current page geometry proposal identity mismatch: ${row.id}`,
          );
        }
        return { kind: 'found', value };
      });
    },

    async save(
      input: SavePageGeometryProposalInput,
    ): Promise<SavePageGeometryProposalResult> {
      const expected = pageGeometryProposalIdentitySchema.parse(
        input.expected,
      );
      const actorId = actorIdSchema.parse(input.actorId);
      const layout = pageLayoutV2Schema.parse(input.layout);
      const built = buildPageGeometryProposal(layout, expected);
      if (built.kind === 'source-conflict') return built;

      return database.transaction(async (tx) => {
        // A content-addressed retry may arrive after the page has changed if
        // the original HTTP response was lost. Returning the immutable row is
        // still safe: it does not promote or rewrite current geometry.
        if (built.kind === 'proposal') {
          const existing = await tx.query.pageGeometryProposals.findFirst({
            where: eq(
              pageGeometryProposals.artifactChecksumSha256,
              built.artifactChecksumSha256,
            ),
          });
          if (existing) {
            return {
              kind: 'already-exists',
              value: rowToStoredProposal(existing),
            };
          }
        }

        // Resolve the owner without a lock, then always lock owner before page.
        // This matches the repository-wide write lock order.
        const pagePointer = await tx.query.letterPages.findFirst({
          where: eq(letterPages.id, layout.pageId),
          columns: { letterId: true },
        });
        if (!pagePointer) return { kind: 'not-found' };

        const ownerRows = await tx
          .select({
            id: letters.id,
            primarySourceRevision: letters.primarySourceRevision,
          })
          .from(letters)
          .where(eq(letters.id, pagePointer.letterId))
          .for('update');
        const owner = ownerRows[0];
        if (!owner) return { kind: 'not-found' };
        if (
          owner.primarySourceRevision
          !== expected.primarySourceRevision
        ) {
          return { kind: 'source-conflict' };
        }

        const pageRows = await tx
          .select({
            letterId: letterPages.letterId,
            checksumSha256: letterPages.checksumSha256,
            geometryRevision: letterPages.geometryRevision,
            geometryChecksumSha256: letterPages.geometryChecksumSha256,
            lineSegments: letterPages.lineSegments,
          })
          .from(letterPages)
          .where(eq(letterPages.id, layout.pageId))
          .for('update');
        const page = pageRows[0];
        if (!page) return { kind: 'not-found' };
        if (page.letterId !== pagePointer.letterId) {
          return { kind: 'source-conflict' };
        }
        if (page.checksumSha256 !== expected.sourceChecksumSha256) {
          return { kind: 'source-conflict' };
        }
        if (page.geometryRevision !== expected.baseGeometryRevision) {
          return { kind: 'geometry-conflict' };
        }

        let lineSegments;
        try {
          lineSegments = normalizeLineSegments(page.lineSegments);
        } catch {
          return { kind: 'geometry-conflict' };
        }
        const currentGeometryChecksumSha256 =
          pageGeometryChecksum(lineSegments);
        const missingStoredGeometryChecksum = (
          page.geometryRevision > 0
          && page.geometryChecksumSha256 === null
        );
        const storedGeometryChecksumIsCorrupted = (
          page.geometryChecksumSha256 !== null
          && page.geometryChecksumSha256
            !== currentGeometryChecksumSha256
        );
        if (
          missingStoredGeometryChecksum
          || storedGeometryChecksumIsCorrupted
          || currentGeometryChecksumSha256
            !== expected.baseGeometryChecksumSha256
        ) {
          return { kind: 'geometry-conflict' };
        }
        if (
          pageLineSegmentsChecksum(lineSegments)
          !== expected.baseLineSegmentsChecksumSha256
        ) {
          return { kind: 'projection-conflict' };
        }

        if (built.kind === 'no-candidates') return built;

        const inserted = await tx
          .insert(pageGeometryProposals)
          .values({
            pageId: built.artifact.pageId,
            artifactChecksumSha256: built.artifactChecksumSha256,
            schemaVersion: built.artifact.schemaVersion,
            kind: built.artifact.kind,
            primarySourceRevision:
              built.artifact.source.primarySourceRevision,
            sourceChecksumSha256:
              built.artifact.source.sourceChecksumSha256,
            baseGeometryRevision:
              built.artifact.source.baseGeometryRevision,
            baseGeometryChecksumSha256:
              built.artifact.source.baseGeometryChecksumSha256,
            baseLineSegmentsChecksumSha256:
              built.artifact.source.baseLineSegmentsChecksumSha256,
            runId: built.artifact.run.id,
            artifact: built.artifact,
            createdBy: actorId,
          })
          .onConflictDoNothing({
            target: pageGeometryProposals.artifactChecksumSha256,
          })
          .returning();
        if (inserted[0]) {
          return {
            kind: 'saved',
            value: rowToStoredProposal(inserted[0]),
          };
        }

        const existing = await tx.query.pageGeometryProposals.findFirst({
          where: eq(
            pageGeometryProposals.artifactChecksumSha256,
            built.artifactChecksumSha256,
          ),
        });
        if (!existing) {
          throw new Error(
            'Page geometry proposal conflict did not resolve to a stored row',
          );
        }
        return {
          kind: 'already-exists',
          value: rowToStoredProposal(existing),
        };
      });
    },
  };
}
