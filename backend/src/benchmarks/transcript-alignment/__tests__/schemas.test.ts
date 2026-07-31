import { describe, expect, it } from 'vitest';
import {
  transcriptAlignmentArtifactSchema,
  transcriptAlignmentMappingSchema,
  transcriptAlignmentReviewInputSchema,
  transcriptAlignmentSavedReviewSchema,
  transcriptAlignmentSnapshotSchema,
  transcriptRecognitionArtifactSchema,
} from '../schemas.js';
import {
  alignmentArtifactFixture,
  PAGE_KEY,
  SEGMENT_ID,
  snapshotFixture,
} from './test-fixtures.js';

describe('transcript-alignment artifact schemas', () => {
  it('accepts page-scoped runner fields and private additive snapshot fields', () => {
    expect(transcriptAlignmentArtifactSchema.parse(
      alignmentArtifactFixture(),
    ).mappings[0].pageKey).toBe(PAGE_KEY);
    expect(transcriptAlignmentSnapshotSchema.parse(snapshotFixture())).toMatchObject({
      letters: [{
        pages: [{ pageKey: PAGE_KEY }],
      }],
    });
  });

  it('defaults older alignment artifacts to no deferred or reasoned segments', () => {
    const parsed = transcriptAlignmentArtifactSchema.parse(
      alignmentArtifactFixture(),
    );

    expect(parsed.deferredSegmentIds).toEqual([]);
    expect(parsed.unassignedSegmentReasons).toEqual([]);
  });

  it('accepts explicit unassigned reasons and rejects ambiguous reason records', () => {
    const original = alignmentArtifactFixture();
    const reasonedArtifact = {
      ...original,
      skippedSegmentIds: [SEGMENT_ID],
      unassignedSegmentReasons: [{
        segmentId: SEGMENT_ID,
        reason: 'secondary-flow',
      }],
    };

    expect(
      transcriptAlignmentArtifactSchema.parse(reasonedArtifact)
        .unassignedSegmentReasons,
    ).toEqual([{
      segmentId: SEGMENT_ID,
      reason: 'secondary-flow',
    }]);

    expect(
      transcriptAlignmentArtifactSchema.parse({
        ...reasonedArtifact,
        unassignedSegmentReasons: [{
          segmentId: SEGMENT_ID,
          reason: 'non-transcribed-text',
        }],
      }).unassignedSegmentReasons,
    ).toEqual([{
      segmentId: SEGMENT_ID,
      reason: 'non-transcribed-text',
    }]);

    expect(transcriptAlignmentArtifactSchema.safeParse({
      ...reasonedArtifact,
      unassignedSegmentReasons: [
        ...reasonedArtifact.unassignedSegmentReasons,
        {
          segmentId: SEGMENT_ID,
          reason: 'alignment-uncertain',
        },
      ],
    }).success).toBe(false);

    expect(transcriptAlignmentArtifactSchema.safeParse({
      ...original,
      unassignedSegmentReasons: [{
        segmentId: SEGMENT_ID,
        reason: 'not-a-reason',
      }],
    }).success).toBe(false);

    expect(transcriptAlignmentArtifactSchema.safeParse({
      ...original,
      unassignedSegmentReasons: [{
        segmentId: SEGMENT_ID,
        reason: 'secondary-flow',
      }],
    }).success).toBe(false);
  });

  it('preserves four raw segment IDs in mappings, alternatives, and reviews', () => {
    const segmentIds = [
      `${PAGE_KEY}-line-0001`,
      `${PAGE_KEY}-line-0002`,
      `${PAGE_KEY}-line-0003`,
      `${PAGE_KEY}-line-0004`,
    ];
    const originalMapping = alignmentArtifactFixture().mappings[0];
    const mapping = transcriptAlignmentMappingSchema.parse({
      ...originalMapping,
      segmentIds,
      operation: 'split',
      alternatives: [{
        segmentIds,
        support: 0.8,
      }],
    });
    const review = transcriptAlignmentReviewInputSchema.parse({
      expectedArtifactSha256: 'a'.repeat(64),
      verdict: 'incorrect',
      correctSegmentIds: segmentIds,
    });

    expect(mapping.segmentIds).toEqual(segmentIds);
    expect(mapping.alternatives[0].segmentIds).toEqual(segmentIds);
    expect(review.correctSegmentIds).toEqual(segmentIds);
  });

  it('rejects duplicate transcript mappings', () => {
    const original = alignmentArtifactFixture();
    const artifact = {
      ...original,
      mappings: [
        ...original.mappings,
        structuredClone(original.mappings[0]),
      ],
    };

    expect(() => transcriptAlignmentArtifactSchema.parse(artifact)).toThrow(
      /unique/i,
    );
  });

  it('rejects duplicate recognition records', () => {
    const recognition = {
      schemaVersion: 1,
      kind: 'kraken-line-recognition',
      pageKey: PAGE_KEY,
      source: {
        layoutPath: '/private/layout.json',
        layoutSha256: '1'.repeat(64),
        imagePath: '/private/image.png',
        imageSha256: '2'.repeat(64),
      },
      model: {
        path: '/private/model.mlmodel',
        sha256: '3'.repeat(64),
        segmentationType: 'baselines',
      },
      summary: {
        inputLineCount: 2,
        recognizedLineCount: 2,
        nonemptyLineCount: 2,
      },
      records: [
        { segmentId: SEGMENT_ID, text: 'one', meanConfidence: 0.8 },
        { segmentId: SEGMENT_ID, text: 'two', meanConfidence: 0.7 },
      ],
    };

    expect(() => transcriptRecognitionArtifactSchema.parse(recognition)).toThrow(
      /unique/i,
    );
  });

  it('requires the page artifact checksum on every review write', () => {
    expect(transcriptAlignmentReviewInputSchema.safeParse({
      verdict: 'correct',
    }).success).toBe(false);
    expect(transcriptAlignmentReviewInputSchema.parse({
      expectedArtifactSha256: 'a'.repeat(64),
      verdict: 'correct',
    })).toMatchObject({
      expectedArtifactSha256: 'a'.repeat(64),
      verdict: 'correct',
      failureModes: [],
    });
  });

  it('defaults old review documents to no failure modes and rejects duplicates', () => {
    expect(transcriptAlignmentSavedReviewSchema.parse({
      verdict: 'incorrect',
      correctSegmentIds: [],
      activeSeconds: 1,
      repairActions: 0,
      updatedAt: '2026-07-29T12:00:00.000Z',
    }).failureModes).toEqual([]);

    expect(transcriptAlignmentReviewInputSchema.safeParse({
      expectedArtifactSha256: 'a'.repeat(64),
      verdict: 'incorrect',
      failureModes: ['split', 'split'],
    }).success).toBe(false);
    expect(transcriptAlignmentReviewInputSchema.safeParse({
      expectedArtifactSha256: 'a'.repeat(64),
      verdict: 'incorrect',
      failureModes: ['not-a-mode'],
    }).success).toBe(false);
    expect(transcriptAlignmentSavedReviewSchema.safeParse({
      verdict: 'incorrect',
      correctSegmentIds: [],
      failureModes: ['split', 'split'],
      activeSeconds: 1,
      repairActions: 0,
      updatedAt: '2026-07-29T12:00:00.000Z',
    }).success).toBe(false);

    expect(transcriptAlignmentReviewInputSchema.parse({
      expectedArtifactSha256: 'a'.repeat(64),
      verdict: 'incorrect',
      correctSegmentIds: [],
      failureModes: ['missed-line'],
    })).toMatchObject({
      verdict: 'incorrect',
      correctSegmentIds: [],
      failureModes: ['missed-line'],
    });
  });
});
