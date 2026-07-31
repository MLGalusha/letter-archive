import { appendFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BenchmarkValidationError } from '../../layout/store.js';
import {
  TranscriptAlignmentArtifactChangedError,
  type TranscriptAlignmentStore,
} from '../store.js';
import type {
  TranscriptAlignmentReviewDocument,
  TranscriptAlignmentUnassignedReason,
} from '../schemas.js';
import {
  ALIGNMENT_RUN_ID,
  createStoreFixture,
  IMAGE_SHA,
  LETTER_KEY,
  NATIVE_SEGMENT_ID,
  PAGE_KEY,
  SEGMENT_ID,
  TRANSCRIPT_ID,
} from './test-fixtures.js';

describe('TranscriptAlignmentStore', () => {
  let temporaryDirectory: string | null = null;

  afterEach(async () => {
    if (temporaryDirectory) {
      await rm(temporaryDirectory, { recursive: true, force: true });
      temporaryDirectory = null;
    }
  });

  async function fixture(options: {
    layoutArtifactFormat?: 'normalized' | 'native';
    nativeLayoutSourceSha?: string;
    recognitionLayoutSha?: string;
    unlocatedCandidate?: boolean;
    unassignedReason?: TranscriptAlignmentUnassignedReason;
  } = {}) {
    temporaryDirectory = await mkdtemp(
      join(tmpdir(), 'transcript-alignment-store-'),
    );
    return createStoreFixture(temporaryDirectory, options);
  }

  async function artifactSha256(store: TranscriptAlignmentStore) {
    return (
      await store.getAlignmentPage(ALIGNMENT_RUN_ID, PAGE_KEY)
    ).artifactSha256;
  }

  it('lists only sanitized run and letter summaries', async () => {
    const store = await fixture();

    const response = await store.listAlignmentRuns();

    expect(response).toMatchObject({
      schemaVersion: 1,
      runs: [{
        runId: ALIGNMENT_RUN_ID,
        letterCount: 1,
        pageCount: 1,
        mappingCount: 1,
        statusCounts: {
          accepted: 1,
          ambiguous: 0,
          unlocated: 0,
        },
        letters: [{
          letterKey: LETTER_KEY,
          pageKeys: [PAGE_KEY],
          unassignedMappingCount: 0,
        }],
      }],
      invalidRuns: [],
    });
    expect(JSON.stringify(response)).not.toContain('/private/');
  });

  it('joins frozen transcript, OCR, and validated layout geometry by checksum', async () => {
    const store = await fixture();

    const response = await store.getAlignmentPage(
      ALIGNMENT_RUN_ID,
      PAGE_KEY,
    );

    expect(response).toMatchObject({
      page: {
        pageKey: PAGE_KEY,
        letterKey: LETTER_KEY,
        image: {
          url: `/images/layout-benchmark/runs/layout-run-a/pages/${PAGE_KEY}/prepared`,
          width: 100,
          height: 200,
          sha256: IMAGE_SHA,
        },
      },
      transcriptSource: {
        tier: 'modern-confirmed',
        label: 'Confirmed transcript',
      },
      summary: {
        mappingCount: 1,
        skippedSegmentCount: 0,
        unassignedMappingCount: 0,
      },
      segments: [{
        id: SEGMENT_ID,
        recognizedText: 'Dear frlend,',
        recognitionConfidence: 0.7,
      }],
      items: [{
        id: TRANSCRIPT_ID,
        sourceLineNumber: 1,
        transcriptText: 'Dear friend,',
        mapping: {
          status: 'accepted',
          segmentIds: [SEGMENT_ID],
        },
      }],
    });
    expect(JSON.stringify(response)).not.toContain('/private/');
  });

  it('projects an explicit unassigned reason onto its review segment', async () => {
    const store = await fixture({
      unlocatedCandidate: true,
      unassignedReason: 'transcript-mismatch',
    });

    const response = await store.getAlignmentPage(
      ALIGNMENT_RUN_ID,
      PAGE_KEY,
    );

    expect(response.segments).toEqual([
      expect.objectContaining({
        id: SEGMENT_ID,
        unassignedReason: 'transcript-mismatch',
      }),
    ]);
    expect(response.skippedSegmentIds).toEqual([SEGMENT_ID]);
  });

  it('rejects recognition geometry that is not bound to the validated layout', async () => {
    const store = await fixture({
      recognitionLayoutSha: 'a'.repeat(64),
    });

    await expect(store.getAlignmentPage(
      ALIGNMENT_RUN_ID,
      PAGE_KEY,
    )).rejects.toBeInstanceOf(BenchmarkValidationError);
  });

  it('loads the exact native Kraken PageLayout referenced by recognition', async () => {
    const store = await fixture({
      layoutArtifactFormat: 'native',
    });

    const response = await store.getAlignmentPage(
      ALIGNMENT_RUN_ID,
      PAGE_KEY,
    );

    expect(response).toMatchObject({
      page: {
        pageKey: PAGE_KEY,
        image: {
          width: 100,
          height: 200,
          sha256: IMAGE_SHA,
        },
      },
      segments: [{
        id: NATIVE_SEGMENT_ID,
        boundary: [
          { x: 10, y: 20 },
          { x: 90, y: 20 },
          { x: 90, y: 40 },
          { x: 10, y: 40 },
        ],
        baseline: [
          { x: 10, y: 35 },
          { x: 90, y: 35 },
        ],
        orientationDegrees: 0,
        readingOrderIndex: 0,
        recognizedText: 'Dear frlend,',
      }],
      items: [{
        mapping: {
          segmentIds: [NATIVE_SEGMENT_ID],
        },
      }],
    });
  });

  it('rejects a hash-bound native artifact sourced from another page', async () => {
    const store = await fixture({
      layoutArtifactFormat: 'native',
      nativeLayoutSourceSha: 'f'.repeat(64),
    });

    await expect(store.getAlignmentPage(
      ALIGNMENT_RUN_ID,
      PAGE_KEY,
    )).rejects.toBeInstanceOf(BenchmarkValidationError);
  });

  it('atomically persists reviewer measurements and returns matching progress', async () => {
    const store = await fixture();

    const saved = await store.saveAlignmentReview(
      ALIGNMENT_RUN_ID,
      PAGE_KEY,
      TRANSCRIPT_ID,
      'reviewer-1',
      {
        expectedArtifactSha256: await artifactSha256(store),
        verdict: 'incorrect',
        correctSegmentIds: [],
        failureModes: ['wrong-line'],
        activeSeconds: 12.5,
        repairActions: 2,
      },
    );
    const page = await store.getAlignmentPage(
      ALIGNMENT_RUN_ID,
      PAGE_KEY,
      'reviewer-1',
    );

    expect(saved).toMatchObject({
      review: {
        verdict: 'incorrect',
        correctSegmentIds: [],
        failureModes: ['wrong-line'],
        activeSeconds: 12.5,
        repairActions: 2,
      },
      progress: {
        reviewedCount: 1,
        totalCount: 1,
        percent: 100,
      },
    });
    expect(page.items[0].review).toMatchObject(saved.review);
    expect(page.summary.reviewProgress).toEqual(saved.progress);
  });

  it('uses the candidate mapping as truth when a correct verdict omits segments', async () => {
    const store = await fixture();

    const saved = await store.saveAlignmentReview(
      ALIGNMENT_RUN_ID,
      PAGE_KEY,
      TRANSCRIPT_ID,
      'reviewer-1',
      {
        expectedArtifactSha256: await artifactSha256(store),
        verdict: 'correct',
      },
    );

    expect(saved.review).toMatchObject({
      verdict: 'correct',
      correctSegmentIds: [SEGMENT_ID],
    });
  });

  it('aggregates only the authenticated reviewer current-artifact reviews', async () => {
    const store = await fixture();
    await store.saveAlignmentReview(
      ALIGNMENT_RUN_ID,
      PAGE_KEY,
      TRANSCRIPT_ID,
      'reviewer-1',
      {
        expectedArtifactSha256: await artifactSha256(store),
        verdict: 'correct',
        activeSeconds: 7,
        repairActions: 1,
      },
    );

    const reviewerScorecard = await store.getAlignmentScorecard(
      ALIGNMENT_RUN_ID,
      'reviewer-1',
    );
    const otherReviewerScorecard = await store.getAlignmentScorecard(
      ALIGNMENT_RUN_ID,
      'reviewer-2',
    );

    expect(reviewerScorecard).toMatchObject({
      mappings: {
        total: 1,
        reviewed: 1,
        determinate: 1,
        correct: 1,
        exactAccuracy: 1,
      },
      autoAccepted: {
        proposedCount: 1,
        reviewedCount: 1,
        precision: 1,
        coverage: 1,
      },
      effort: {
        activeSeconds: {
          total: 7,
          perReviewedPage: 7,
          perReviewedLine: 7,
        },
        repairActions: {
          total: 1,
          perReviewedPage: 1,
          perReviewedLine: 1,
        },
      },
    });
    expect(otherReviewerScorecard).toMatchObject({
      mappings: {
        total: 1,
        reviewed: 0,
        exactAccuracy: null,
      },
      autoAccepted: {
        reviewedCount: 0,
        precision: null,
      },
    });
  });

  it('rejects a corrected segment assignment outside the reviewed page', async () => {
    const store = await fixture();

    await expect(store.saveAlignmentReview(
      ALIGNMENT_RUN_ID,
      PAGE_KEY,
      TRANSCRIPT_ID,
      'reviewer-1',
      {
        expectedArtifactSha256: await artifactSha256(store),
        verdict: 'incorrect',
        correctSegmentIds: [`${PAGE_KEY}-line-9999`],
      },
    )).rejects.toBeInstanceOf(BenchmarkValidationError);
  });

  it('enforces verdict and corrected-segment consistency', async () => {
    const store = await fixture();
    const expectedArtifactSha256 = await artifactSha256(store);

    await expect(store.saveAlignmentReview(
      ALIGNMENT_RUN_ID,
      PAGE_KEY,
      TRANSCRIPT_ID,
      'reviewer-1',
      {
        expectedArtifactSha256,
        verdict: 'correct',
        correctSegmentIds: [],
      },
    )).rejects.toBeInstanceOf(BenchmarkValidationError);
    await expect(store.saveAlignmentReview(
      ALIGNMENT_RUN_ID,
      PAGE_KEY,
      TRANSCRIPT_ID,
      'reviewer-1',
      {
        expectedArtifactSha256,
        verdict: 'unsure',
        correctSegmentIds: [],
      },
    )).rejects.toBeInstanceOf(BenchmarkValidationError);
    await expect(store.saveAlignmentReview(
      ALIGNMENT_RUN_ID,
      PAGE_KEY,
      TRANSCRIPT_ID,
      'reviewer-1',
      {
        expectedArtifactSha256,
        verdict: 'incorrect',
        correctSegmentIds: [SEGMENT_ID],
      },
    )).rejects.toBeInstanceOf(BenchmarkValidationError);

    const notOnPage = await store.saveAlignmentReview(
      ALIGNMENT_RUN_ID,
      PAGE_KEY,
      TRANSCRIPT_ID,
      'reviewer-1',
      {
        expectedArtifactSha256,
        verdict: 'incorrect',
        correctSegmentIds: [],
      },
    );
    expect(notOnPage.review).toMatchObject({
      verdict: 'incorrect',
      correctSegmentIds: [],
    });
  });

  it('requires missed-line to mark an empty candidate incorrect without geometry', async () => {
    const store = await fixture({ unlocatedCandidate: true });
    const expectedArtifactSha256 = await artifactSha256(store);

    await expect(store.saveAlignmentReview(
      ALIGNMENT_RUN_ID,
      PAGE_KEY,
      TRANSCRIPT_ID,
      'reviewer-1',
      {
        expectedArtifactSha256,
        verdict: 'incorrect',
        correctSegmentIds: [],
      },
    )).rejects.toBeInstanceOf(BenchmarkValidationError);

    const saved = await store.saveAlignmentReview(
      ALIGNMENT_RUN_ID,
      PAGE_KEY,
      TRANSCRIPT_ID,
      'reviewer-1',
      {
        expectedArtifactSha256,
        verdict: 'incorrect',
        correctSegmentIds: [],
        failureModes: ['missed-line'],
      },
    );
    expect(saved.review).toMatchObject({
      verdict: 'incorrect',
      correctSegmentIds: [],
      failureModes: ['missed-line'],
    });
  });

  it('serializes concurrent writes to one reviewer page document', async () => {
    const store = await fixture();
    const expectedArtifactSha256 = await artifactSha256(store);
    const internals = store as unknown as {
      writeReviewDocument(
        document: TranscriptAlignmentReviewDocument,
      ): Promise<void>;
    };
    const originalWrite = internals.writeReviewDocument.bind(store);
    let writeCount = 0;
    let signalFirstWriteEntered!: () => void;
    let releaseFirstWrite!: () => void;
    const firstWriteEntered = new Promise<void>((resolveEntered) => {
      signalFirstWriteEntered = resolveEntered;
    });
    const firstWriteRelease = new Promise<void>((resolveRelease) => {
      releaseFirstWrite = resolveRelease;
    });
    internals.writeReviewDocument = async (document) => {
      writeCount += 1;
      if (writeCount === 1) {
        signalFirstWriteEntered();
        await firstWriteRelease;
      }
      await originalWrite(document);
    };

    const firstSave = store.saveAlignmentReview(
      ALIGNMENT_RUN_ID,
      PAGE_KEY,
      TRANSCRIPT_ID,
      'reviewer-1',
      {
        expectedArtifactSha256,
        verdict: 'correct',
      },
    );
    await firstWriteEntered;
    const secondSave = store.saveAlignmentReview(
      ALIGNMENT_RUN_ID,
      PAGE_KEY,
      TRANSCRIPT_ID,
      'reviewer-1',
      {
        expectedArtifactSha256,
        verdict: 'incorrect',
        failureModes: ['wrong-line'],
      },
    );
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
    expect(writeCount).toBe(1);
    releaseFirstWrite();
    await Promise.all([firstSave, secondSave]);

    const page = await store.getAlignmentPage(
      ALIGNMENT_RUN_ID,
      PAGE_KEY,
      'reviewer-1',
    );
    expect(writeCount).toBe(2);
    expect(page.items[0].review).toMatchObject({
      verdict: 'incorrect',
      failureModes: ['wrong-line'],
    });
  });

  it('rejects an old-screen verdict if the artifact changes before save', async () => {
    const store = await fixture();
    const expectedArtifactSha256 = await artifactSha256(store);
    await appendFile(
      join(
        temporaryDirectory!,
        'test-results',
        'alignments',
        ALIGNMENT_RUN_ID,
        LETTER_KEY,
        'alignment.v1.json',
      ),
      ' \n',
      'utf8',
    );

    await expect(store.saveAlignmentReview(
      ALIGNMENT_RUN_ID,
      PAGE_KEY,
      TRANSCRIPT_ID,
      'reviewer-1',
      {
        expectedArtifactSha256,
        verdict: 'correct',
      },
    )).rejects.toMatchObject({
      statusCode: 409,
      code: 'ALIGNMENT_ARTIFACT_CHANGED',
    });

    const refreshedPage = await store.getAlignmentPage(
      ALIGNMENT_RUN_ID,
      PAGE_KEY,
      'reviewer-1',
    );
    expect(refreshedPage.artifactSha256).not.toBe(expectedArtifactSha256);
    expect(refreshedPage.items[0].review).toBeNull();
  });
});
