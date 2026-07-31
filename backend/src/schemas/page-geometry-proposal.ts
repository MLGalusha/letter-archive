import { z } from 'zod';
import { lineSegmentSchema } from './line-segment.js';
import {
  pageLayoutChecksumSchema,
  pageLayoutImageSchema,
  pageLayoutProvenanceSchema,
  pageLayoutRotationProfileSchema,
} from './page-layout-v2.js';
import { canonicalJsonChecksum } from '../services/page-layout-checksum.js';

const proposalRunIdSchema = z.string().trim().min(1).max(512);

/**
 * Rotation recovery proposes geometry only. The shape deliberately remains a
 * LineSegment so promotion does not need a second geometry vocabulary, while
 * the refinement removes every review/transcript concern from machine output.
 */
export const rotationRecoveryCandidateSegmentSchema = lineSegmentSchema
  .superRefine((segment, context) => {
    if (!segment.id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['id'],
        message: 'Rotation proposals require a stable segment ID',
      });
    }
    if (!segment.geometryType) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['geometryType'],
        message: 'Rotation proposals require an explicit native geometry type',
      });
    }
    if (segment.line !== -1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['line'],
        message: 'Rotation proposals must remain outside canonical reading order',
      });
    }
    if (
      !segment.geometryProvenance
      || segment.geometryProvenance.source !== 'machine'
      || segment.geometryProvenance.operation !== 'detected'
      || segment.geometryProvenance.parentSegmentIds.length !== 0
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['geometryProvenance'],
        message: 'Rotation proposals must be machine detections with no parents',
      });
    }
    if (
      !segment.rotationEvidence
      || segment.rotationEvidence.representativeRotationDegrees === 0
      || segment.rotationEvidence.readingOrderSource
        !== 'unresolved-rotated-proposal'
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rotationEvidence'],
        message: 'Rotation proposals require unresolved nonzero rotation evidence',
      });
    }
    if (
      segment.providerTextDirection !== 'vertical-lr'
      && segment.providerTextDirection !== 'vertical-rl'
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['providerTextDirection'],
        message: 'Sideways recovery candidates require a vertical source direction',
      });
    }
    if (segment.ocrText !== '') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ocrText'],
        message: 'Geometry proposals must not contain recognition text',
      });
    }
    if (segment.baseline) {
      const distinctPoints = new Set(
        segment.baseline.map(([x, y]) => `${x},${y}`),
      );
      if (distinctPoints.size < 2) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['baseline'],
          message: 'A proposal baseline requires two distinct points',
        });
      }
    }
    if (segment.boundary) {
      const distinctPoints = new Set(
        segment.boundary.map(({ x, y }) => `${x},${y}`),
      );
      const twiceSignedArea = segment.boundary.reduce(
        (area, point, index) => {
          const next = segment.boundary![
            (index + 1) % segment.boundary!.length
          ];
          return area + (point.x * next.y) - (next.x * point.y);
        },
        0,
      );
      if (distinctPoints.size < 3 || twiceSignedArea === 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['boundary'],
          message: 'A proposal boundary must be a non-degenerate polygon',
        });
      }
    }
    for (const forbiddenField of [
      'excluded',
      'segmentClass',
      'isMapped',
      'mappedText',
      'words',
      'group',
      'regionIds',
      'providerOrdinal',
    ] as const) {
      if (segment[forbiddenField] !== undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [forbiddenField],
          message: `Geometry proposals must not contain ${forbiddenField}`,
        });
      }
    }
  });

export const pageGeometryProposalV1Schema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('rotation-recovery'),
  pageId: z.string().uuid(),
  source: z.object({
    primarySourceRevision: z.number().int().nonnegative(),
    sourceChecksumSha256: pageLayoutChecksumSchema,
    baseGeometryRevision: z.number().int().nonnegative(),
    baseGeometryChecksumSha256: pageLayoutChecksumSchema,
    baseLineSegmentsChecksumSha256: pageLayoutChecksumSchema,
    // Candidate coordinates live in the exact normalized raster used by
    // Kraken, not implicitly in the raw EXIF-oriented source bytes.
    image: pageLayoutImageSchema,
  }).strict(),
  provenance: pageLayoutProvenanceSchema,
  rotationProfile: pageLayoutRotationProfileSchema,
  run: z.object({
    id: proposalRunIdSchema,
  }).strict(),
  candidates: z.array(rotationRecoveryCandidateSegmentSchema).min(1),
}).strict().superRefine((artifact, context) => {
  if (
    artifact.provenance.producer.providerRunId !== undefined
    && artifact.provenance.producer.providerRunId !== artifact.run.id
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['provenance', 'producer', 'providerRunId'],
      message: 'Producer run ID must match the proposal run',
    });
  }
  const provenanceProfile = pageLayoutRotationProfileSchema.safeParse(
    artifact.provenance.config.parameters?.rotationProfile,
  );
  if (
    !provenanceProfile.success
    || canonicalJsonChecksum(provenanceProfile.data)
      !== canonicalJsonChecksum(artifact.rotationProfile)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['provenance', 'config', 'parameters', 'rotationProfile'],
      message: 'Config provenance must contain the exact rotation profile',
    });
  }
  if (
    artifact.rotationProfile.selectionSummary.appendedRotatedLineCount
    !== artifact.candidates.length
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['rotationProfile', 'selectionSummary', 'appendedRotatedLineCount'],
      message: 'Rotation profile appended count must match proposal candidates',
    });
  }
  const ids = new Set<string>();
  artifact.candidates.forEach((candidate, candidateIndex) => {
    const id = candidate.id;
    if (id && ids.has(id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['candidates', candidateIndex, 'id'],
        message: `Rotation proposal segment IDs must be unique: ${id}`,
      });
    }
    if (id) ids.add(id);

    const configuredRotations = new Set<number>(
      artifact.rotationProfile.rotationsDegrees,
    );
    const succeededRotations = new Set<number>(
      artifact.rotationProfile.passOutcomes
        .filter((outcome) => outcome.status === 'succeeded')
        .map((outcome) => outcome.rotationDegrees),
    );
    if (
      candidate.rotationEvidence?.sourceRotationsDegrees.some(
        (rotation) => !configuredRotations.has(rotation),
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['candidates', candidateIndex, 'rotationEvidence'],
        message: 'Candidate evidence references an unconfigured rotation pass',
      });
    }
    if (
      candidate.rotationEvidence?.sourceRotationsDegrees.some(
        (rotation) => !succeededRotations.has(rotation),
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['candidates', candidateIndex, 'rotationEvidence'],
        message: 'Candidate evidence may reference only succeeded passes',
      });
    }

    const { width, height } = artifact.source.image;
    const [xMin, yMin, xMax, yMax] = candidate.bbox;
    if (
      xMin > width
      || xMax > width
      || yMin > height
      || yMax > height
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['candidates', candidateIndex, 'bbox'],
        message: 'Candidate bounding box lies outside the original image',
      });
    }
    candidate.baseline?.forEach(([x, y], pointIndex) => {
      if (x > width || y > height) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['candidates', candidateIndex, 'baseline', pointIndex],
          message: 'Candidate baseline point lies outside the original image',
        });
      }
    });
    candidate.boundary?.forEach(({ x, y }, pointIndex) => {
      if (x > width || y > height) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['candidates', candidateIndex, 'boundary', pointIndex],
          message: 'Candidate boundary point lies outside the original image',
        });
      }
    });
  });
});

export type RotationRecoveryCandidateSegment = z.infer<
  typeof rotationRecoveryCandidateSegmentSchema
>;
export type PageGeometryProposalV1 = z.infer<
  typeof pageGeometryProposalV1Schema
>;

export function pageGeometryProposalArtifactChecksum(
  artifact: PageGeometryProposalV1,
): string {
  return canonicalJsonChecksum(pageGeometryProposalV1Schema.parse(artifact));
}

export function assertPageGeometryProposalArtifactChecksum(
  artifact: PageGeometryProposalV1,
  expectedChecksumSha256: string,
): void {
  const parsedChecksum = pageLayoutChecksumSchema.parse(expectedChecksumSha256);
  const actualChecksum = pageGeometryProposalArtifactChecksum(artifact);
  if (actualChecksum !== parsedChecksum) {
    throw new Error(
      `Page geometry proposal checksum mismatch: expected ${parsedChecksum}, `
      + `received ${actualChecksum}`,
    );
  }
}
