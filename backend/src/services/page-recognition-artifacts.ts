import { and, desc, eq } from 'drizzle-orm';
import {
  db,
  letterPages,
  letters,
  pageRecognitionArtifacts,
  type PageRecognitionArtifactRow,
} from '../db/index.js';
import {
  pageGeometryChecksum,
  pageLineSegmentsChecksum,
  normalizeLineSegments,
} from '../schemas/page-geometry.js';
import {
  effectiveRecognitionDirection,
  pageRecognitionArtifactChecksum,
  pageRecognitionArtifactSchema,
  recognitionSha256Schema,
  segmentRecognitionGeometryChecksum,
  type PageRecognitionArtifact,
} from '../schemas/page-recognition.js';
import { canonicalJsonChecksum } from './page-layout-checksum.js';
import {
  alignmentSegmentInputChecksum,
} from './transcript-alignment/alignment-input-identity.js';
import { z } from 'zod';

const currentProfileRecognitionLookupSchema = z.object({
  pageId: z.string().uuid(),
  primarySourceRevision: z.number().int().nonnegative(),
  sourceChecksumSha256: recognitionSha256Schema,
  geometryRevision: z.number().int().nonnegative(),
  geometryChecksumSha256: recognitionSha256Schema,
  lineSegmentsChecksumSha256: recognitionSha256Schema,
  alignmentSegmentInputChecksumSha256: recognitionSha256Schema,
  profileChecksumSha256: recognitionSha256Schema,
}).strict();

const CURRENT_PAGE_RECOGNITION_SCHEMA_VERSION = 2;

const compatibleProfileRecognitionLookupSchema = z.object({
  pageId: z.string().uuid(),
  primarySourceRevision: z.number().int().nonnegative(),
  sourceChecksumSha256: recognitionSha256Schema,
  profileChecksumSha256: recognitionSha256Schema,
}).strict();

export type CurrentProfileRecognitionLookup = z.infer<
  typeof currentProfileRecognitionLookupSchema
>;
export type CompatibleProfileRecognitionLookup = z.infer<
  typeof compatibleProfileRecognitionLookupSchema
>;

export interface StoredPageRecognitionArtifact {
  id: string;
  artifactChecksumSha256: string;
  artifact: PageRecognitionArtifact;
  persistedAt: Date;
}

export type InsertPageRecognitionArtifactResult =
  | {
    kind: 'inserted' | 'existing';
    value: StoredPageRecognitionArtifact;
  }
  | {
    kind: 'source-mismatch';
    reason:
      | 'page-not-found'
      | 'owner-not-found'
      | 'source-revision'
      | 'source-checksum'
      | 'geometry-revision'
      | 'geometry-checksum'
      | 'line-segments-checksum';
  };

export class RecognitionArtifactBatchSourceMismatchError extends Error {
  constructor(
    readonly pageId: string,
    readonly reason: Extract<
      InsertPageRecognitionArtifactResult,
      { kind: 'source-mismatch' }
    >['reason'],
  ) {
    super(
      `Page ${pageId} changed during recognition import (${reason})`,
    );
    this.name = 'RecognitionArtifactBatchSourceMismatchError';
  }
}

function rowToStoredArtifact(
  row: PageRecognitionArtifactRow,
): StoredPageRecognitionArtifact {
  const artifact = pageRecognitionArtifactSchema.parse(row.artifact);
  const artifactChecksumSha256 = pageRecognitionArtifactChecksum(artifact);
  if (artifactChecksumSha256 !== row.artifactChecksumSha256) {
    throw new Error(
      `Stored recognition artifact checksum mismatch: ${row.id}`,
    );
  }

  return {
    id: row.id,
    artifactChecksumSha256,
    artifact,
    persistedAt: row.persistedAt,
  };
}

function assertExactRecordGeometry(
  artifact: PageRecognitionArtifact,
  lineSegments: ReturnType<typeof normalizeLineSegments>,
): void {
  const segmentsById = new Map(
    lineSegments.map((segment) => [segment.id, segment]),
  );
  for (const record of artifact.records) {
    const segment = segmentsById.get(record.segmentId);
    if (!segment) {
      throw new Error(
        `Recognition record references an absent segment: ${record.segmentId}`,
      );
    }
    if (
      segmentRecognitionGeometryChecksum(segment)
      !== record.segmentGeometryChecksumSha256
    ) {
      throw new Error(
        `Recognition record geometry checksum is stale: ${record.segmentId}`,
      );
    }
    if (
      effectiveRecognitionDirection(segment)
      !== record.textDirection
    ) {
      throw new Error(
        `Recognition record text direction is stale: ${record.segmentId}`,
      );
    }
  }
}

function assertArtifactEvidenceIntegrity(
  artifact: PageRecognitionArtifact,
  lineSegments: ReturnType<typeof normalizeLineSegments>,
): void {
  const alignmentInputChecksumSha256 =
    alignmentSegmentInputChecksum(lineSegments);
  if (
    artifact.source.alignmentSegmentInputChecksumSha256
    !== alignmentInputChecksumSha256
  ) {
    throw new Error(
      'Recognition artifact alignment input checksum is stale',
    );
  }

  const configChecksumSha256 = canonicalJsonChecksum(
    artifact.evidence.inference,
  );
  if (artifact.profile.configChecksumSha256 !== configChecksumSha256) {
    throw new Error(
      'Recognition artifact config checksum does not match inference',
    );
  }

  const profileChecksumSha256 = canonicalJsonChecksum({
    engine: artifact.profile.engine,
    engineVersion: artifact.profile.engineVersion,
    modelName: artifact.profile.modelName,
    modelChecksumSha256: artifact.profile.modelChecksumSha256,
    inference: artifact.evidence.inference,
  });
  if (artifact.profile.profileChecksumSha256 !== profileChecksumSha256) {
    throw new Error(
      'Recognition artifact profile checksum does not match evidence',
    );
  }

  if (
    artifact.evidence.raster.width
      !== artifact.evidence.normalization.normalized.width
    || artifact.evidence.raster.height
      !== artifact.evidence.normalization.normalized.height
  ) {
    throw new Error(
      'Recognition artifact normalized dimensions do not match raster',
    );
  }
}

export function createPageRecognitionArtifactRepository(
  database: typeof db = db,
) {
  type Transaction = Parameters<
    Parameters<typeof database.transaction>[0]
  >[0];

  const insert = async (
    input: unknown,
    transaction?: Transaction,
  ): Promise<InsertPageRecognitionArtifactResult> => {
    const artifact = pageRecognitionArtifactSchema.parse(input);
    const artifactChecksumSha256 =
      pageRecognitionArtifactChecksum(artifact);
    const operation = async (
      tx: Transaction,
    ): Promise<InsertPageRecognitionArtifactResult> => {
      // Lock the letter owner before a page row in every write path. This
      // stable lock order keeps concurrent single-page and batch imports from
      // deadlocking one another.
      const pagePointer = await tx.query.letterPages.findFirst({
        where: eq(letterPages.id, artifact.pageId),
        columns: { letterId: true },
      });
      if (!pagePointer) {
        return { kind: 'source-mismatch', reason: 'page-not-found' };
      }
      const owner = await tx
        .select({
          id: letters.id,
          primarySourceRevision: letters.primarySourceRevision,
        })
        .from(letters)
        .where(eq(letters.id, pagePointer.letterId))
        .for('update');
      if (owner.length !== 1) {
        return { kind: 'source-mismatch', reason: 'owner-not-found' };
      }
      if (
        owner[0].primarySourceRevision
        !== artifact.source.primarySourceRevision
      ) {
        return { kind: 'source-mismatch', reason: 'source-revision' };
      }

      const lockedPages = await tx
        .select({
          checksumSha256: letterPages.checksumSha256,
          geometryRevision: letterPages.geometryRevision,
          geometryChecksumSha256: letterPages.geometryChecksumSha256,
          lineSegments: letterPages.lineSegments,
        })
        .from(letterPages)
        .where(eq(letterPages.id, artifact.pageId))
        .for('update');
      const page = lockedPages[0];
      if (!page) {
        return { kind: 'source-mismatch', reason: 'page-not-found' };
      }
      if (page.checksumSha256 !== artifact.source.sourceChecksumSha256) {
        return { kind: 'source-mismatch', reason: 'source-checksum' };
      }
      if (page.geometryRevision !== artifact.source.geometryRevision) {
        return { kind: 'source-mismatch', reason: 'geometry-revision' };
      }

      const lineSegments = normalizeLineSegments(page.lineSegments);
      const geometryChecksumSha256 = page.geometryChecksumSha256
        ?? pageGeometryChecksum(lineSegments);
      if (
        geometryChecksumSha256
        !== artifact.source.geometryChecksumSha256
      ) {
        return { kind: 'source-mismatch', reason: 'geometry-checksum' };
      }
      if (
        pageLineSegmentsChecksum(lineSegments)
        !== artifact.source.lineSegmentsChecksumSha256
      ) {
        return {
          kind: 'source-mismatch',
          reason: 'line-segments-checksum',
        };
      }
      assertArtifactEvidenceIntegrity(artifact, lineSegments);
      assertExactRecordGeometry(artifact, lineSegments);

      const values = {
          pageId: artifact.pageId,
          artifactChecksumSha256,
          schemaVersion: artifact.schemaVersion,
          primarySourceRevision: artifact.source.primarySourceRevision,
          sourceChecksumSha256: artifact.source.sourceChecksumSha256,
          geometryRevision: artifact.source.geometryRevision,
          geometryChecksumSha256: artifact.source.geometryChecksumSha256,
          lineSegmentsChecksumSha256:
            artifact.source.lineSegmentsChecksumSha256,
          alignmentSegmentInputChecksumSha256:
            artifact.source.alignmentSegmentInputChecksumSha256,
          profileChecksumSha256: artifact.profile.profileChecksumSha256,
          engine: artifact.profile.engine,
          engineVersion: artifact.profile.engineVersion,
          modelName: artifact.profile.modelName,
          modelChecksumSha256: artifact.profile.modelChecksumSha256,
          configChecksumSha256: artifact.profile.configChecksumSha256,
          state: artifact.state,
          artifact,
          createdAt: new Date(artifact.createdAt),
      };
      const inserted = await tx
          .insert(pageRecognitionArtifacts)
          .values(values)
          .onConflictDoNothing({
            target: pageRecognitionArtifacts.artifactChecksumSha256,
          })
          .returning();
      if (inserted[0]) {
        return {
          kind: 'inserted',
          value: rowToStoredArtifact(inserted[0]),
        };
      }

      const existing = await tx.query.pageRecognitionArtifacts.findFirst({
        where: eq(
          pageRecognitionArtifacts.artifactChecksumSha256,
          artifactChecksumSha256,
        ),
      });
      if (!existing) {
        throw new Error(
          'Recognition artifact conflict did not resolve to a stored row',
        );
      }
      return {
        kind: 'existing',
        value: rowToStoredArtifact(existing),
      };
    };
    return transaction
      ? operation(transaction)
      : database.transaction(operation);
  };

  return {
    insert,

    async insertBatch(
      inputs: readonly unknown[],
    ): Promise<InsertPageRecognitionArtifactResult[]> {
      const artifacts = inputs.map((input) => (
        pageRecognitionArtifactSchema.parse(input)
      ));
      return database.transaction(async (tx) => {
        const results: InsertPageRecognitionArtifactResult[] = [];
        for (const artifact of artifacts) {
          const result = await insert(artifact, tx);
          if (result.kind === 'source-mismatch') {
            throw new RecognitionArtifactBatchSourceMismatchError(
              artifact.pageId,
              result.reason,
            );
          }
          results.push(result);
        }
        return results;
      });
    },

    async loadCurrentProfile(
      input: CurrentProfileRecognitionLookup,
    ): Promise<StoredPageRecognitionArtifact[]> {
      const lookup = currentProfileRecognitionLookupSchema.parse(input);
      const rows = await database.query.pageRecognitionArtifacts.findMany({
        where: and(
          eq(
            pageRecognitionArtifacts.schemaVersion,
            CURRENT_PAGE_RECOGNITION_SCHEMA_VERSION,
          ),
          eq(pageRecognitionArtifacts.pageId, lookup.pageId),
          eq(
            pageRecognitionArtifacts.primarySourceRevision,
            lookup.primarySourceRevision,
          ),
          eq(
            pageRecognitionArtifacts.sourceChecksumSha256,
            lookup.sourceChecksumSha256,
          ),
          eq(
            pageRecognitionArtifacts.geometryRevision,
            lookup.geometryRevision,
          ),
          eq(
            pageRecognitionArtifacts.geometryChecksumSha256,
            lookup.geometryChecksumSha256,
          ),
          eq(
            pageRecognitionArtifacts.lineSegmentsChecksumSha256,
            lookup.lineSegmentsChecksumSha256,
          ),
          eq(
            pageRecognitionArtifacts.alignmentSegmentInputChecksumSha256,
            lookup.alignmentSegmentInputChecksumSha256,
          ),
          eq(
            pageRecognitionArtifacts.profileChecksumSha256,
            lookup.profileChecksumSha256,
          ),
        ),
        orderBy: [
          desc(pageRecognitionArtifacts.createdAt),
          desc(pageRecognitionArtifacts.persistedAt),
          desc(pageRecognitionArtifacts.id),
        ],
      });
      return rows.map(rowToStoredArtifact);
    },

    /**
     * Loads prior projections from the same immutable page source and
     * recognition profile. Callers must still validate each record against the
     * current segment geometry before reuse.
     */
    async loadCompatibleProfile(
      input: CompatibleProfileRecognitionLookup,
    ): Promise<StoredPageRecognitionArtifact[]> {
      const lookup = compatibleProfileRecognitionLookupSchema.parse(input);
      const rows = await database.query.pageRecognitionArtifacts.findMany({
        where: and(
          eq(
            pageRecognitionArtifacts.schemaVersion,
            CURRENT_PAGE_RECOGNITION_SCHEMA_VERSION,
          ),
          eq(pageRecognitionArtifacts.pageId, lookup.pageId),
          eq(
            pageRecognitionArtifacts.primarySourceRevision,
            lookup.primarySourceRevision,
          ),
          eq(
            pageRecognitionArtifacts.sourceChecksumSha256,
            lookup.sourceChecksumSha256,
          ),
          eq(
            pageRecognitionArtifacts.profileChecksumSha256,
            lookup.profileChecksumSha256,
          ),
        ),
        orderBy: [
          desc(pageRecognitionArtifacts.createdAt),
          desc(pageRecognitionArtifacts.persistedAt),
          desc(pageRecognitionArtifacts.id),
        ],
      });
      return rows.map(rowToStoredArtifact);
    },
  };
}

const repository = createPageRecognitionArtifactRepository();

export function insertPageRecognitionArtifact(input: unknown) {
  return repository.insert(input);
}

export function insertPageRecognitionArtifactBatch(
  inputs: readonly unknown[],
) {
  return repository.insertBatch(inputs);
}

export function loadCurrentProfilePageRecognitionArtifacts(
  input: CurrentProfileRecognitionLookup,
) {
  return repository.loadCurrentProfile(input);
}

export function loadCompatibleProfilePageRecognitionArtifacts(
  input: CompatibleProfileRecognitionLookup,
) {
  return repository.loadCompatibleProfile(input);
}
