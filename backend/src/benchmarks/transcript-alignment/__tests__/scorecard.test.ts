import { describe, expect, it } from 'vitest';
import type {
  TranscriptAlignmentPageResponse,
  TranscriptAlignmentSavedReview,
} from '../schemas.js';
import {
  buildTranscriptAlignmentScorecard,
  type TranscriptAlignmentScorecardPage,
} from '../scorecard.js';

type ReviewItem = TranscriptAlignmentPageResponse['items'][number];

function savedReview(
  verdict: TranscriptAlignmentSavedReview['verdict'],
  options: Partial<TranscriptAlignmentSavedReview> = {},
): TranscriptAlignmentSavedReview {
  return {
    verdict,
    correctSegmentIds: [],
    failureModes: [],
    activeSeconds: 0,
    repairActions: 0,
    updatedAt: '2026-07-29T12:00:00.000Z',
    ...options,
  };
}

function item(
  id: string,
  options: {
    status?: ReviewItem['mapping']['status'];
    operation?: ReviewItem['mapping']['operation'];
    segmentIds?: string[];
    alternatives?: string[][];
    review?: TranscriptAlignmentSavedReview | null;
  } = {},
): ReviewItem {
  const segmentIds = options.segmentIds ?? [`${id}-segment`];
  return {
    id,
    sourceLineNumber: 1,
    transcriptText: id,
    mapping: {
      status: options.status ?? 'ambiguous',
      operation: options.operation ?? 'match',
      segmentIds,
      similarity: 0.8,
      confidence: 0.75,
      alternatives: (options.alternatives ?? [segmentIds]).map(
        (alternativeSegmentIds) => ({
          segmentIds: alternativeSegmentIds,
          support: 0.5,
        }),
      ),
    },
    review: options.review ?? null,
  };
}

function page(
  pageKey: string,
  items: ReviewItem[],
): TranscriptAlignmentScorecardPage {
  return { pageKey, items };
}

describe('buildTranscriptAlignmentScorecard', () => {
  it('returns null—not zero—for every zero-denominator metric', () => {
    const scorecard = buildTranscriptAlignmentScorecard('run-a', []);

    expect(scorecard).toMatchObject({
      pageCount: 0,
      reviewedPageCount: 0,
      mappings: {
        total: 0,
        reviewed: 0,
        determinate: 0,
        unsure: 0,
        correct: 0,
        incorrect: 0,
        exactAccuracy: null,
      },
      autoAccepted: {
        proposedCount: 0,
        reviewedCount: 0,
        determinateReviewedCount: 0,
        correctReviewedCount: 0,
        precision: null,
        coverage: null,
      },
      alternatives: {
        eligibleIncorrectCount: 0,
        recalledCount: 0,
        topAlternativeRecall: null,
      },
      failureModes: {
        'wrong-line': 0,
        'missed-line': 0,
        'false-line': 0,
        split: 0,
        merge: 0,
        'wrong-order': 0,
        'neighboring-page': 0,
        'sideways-text': 0,
        'page-boundary': 0,
        other: 0,
      },
      segmentLinks: {
        evaluatedMappings: 0,
        truePositive: 0,
        falsePositive: 0,
        falseNegative: 0,
        precision: null,
        recall: null,
        f1: null,
      },
      effort: {
        activeSeconds: {
          total: 0,
          perReviewedPage: null,
          perReviewedLine: null,
        },
        repairActions: {
          total: 0,
          perReviewedPage: null,
          perReviewedLine: null,
        },
      },
    });
    expect(scorecard.operations.unlocated.exactAccuracy).toBeNull();
    expect(scorecard.operations.split.exactAccuracy).toBeNull();
    expect(scorecard.operations.merge.exactAccuracy).toBeNull();
  });

  it('measures exact accuracy, auto-accept quality, alternatives, and effort', () => {
    const scorecard = buildTranscriptAlignmentScorecard('run-a', [
      page('page-1', [
        item('line-1', {
          status: 'accepted',
          review: savedReview('correct', {
            correctSegmentIds: ['line-1-segment'],
            activeSeconds: 10,
          }),
        }),
        item('line-2', {
          status: 'accepted',
          operation: 'split',
          segmentIds: ['line-2-a', 'line-2-b'],
          alternatives: [
            ['line-2-a', 'line-2-b'],
            ['line-2-c'],
          ],
          review: savedReview('incorrect', {
            correctSegmentIds: ['line-2-c'],
            failureModes: ['split', 'wrong-line'],
            activeSeconds: 20,
            repairActions: 2,
          }),
        }),
        item('line-3', {
          operation: 'merge',
          review: savedReview('unsure', {
            failureModes: ['wrong-order'],
            activeSeconds: 5,
            repairActions: 1,
          }),
        }),
      ]),
      page('page-2', [
        item('line-4', {
          operation: 'unlocated-transcript',
          segmentIds: [],
          review: savedReview('incorrect', {
            correctSegmentIds: [],
            failureModes: ['missed-line'],
            activeSeconds: 15,
            repairActions: 1,
          }),
        }),
        item('line-5', {
          status: 'accepted',
        }),
      ]),
    ]);

    expect(scorecard).toEqual({
      schemaVersion: 1,
      runId: 'run-a',
      pageCount: 2,
      reviewedPageCount: 2,
      mappings: {
        total: 5,
        reviewed: 4,
        determinate: 3,
        unsure: 1,
        correct: 1,
        incorrect: 2,
        exactAccuracy: 0.333333,
      },
      autoAccepted: {
        proposedCount: 3,
        reviewedCount: 2,
        determinateReviewedCount: 2,
        correctReviewedCount: 1,
        precision: 0.5,
        coverage: 0.6,
      },
      alternatives: {
        eligibleIncorrectCount: 1,
        recalledCount: 1,
        topAlternativeRecall: 1,
      },
      failureModes: {
        'wrong-line': 1,
        'missed-line': 1,
        'false-line': 0,
        split: 1,
        merge: 0,
        'wrong-order': 1,
        'neighboring-page': 0,
        'sideways-text': 0,
        'page-boundary': 0,
        other: 0,
      },
      segmentLinks: {
        evaluatedMappings: 3,
        truePositive: 1,
        falsePositive: 2,
        falseNegative: 1,
        precision: 0.333333,
        recall: 0.5,
        f1: 0.4,
      },
      operations: {
        unlocated: {
          total: 1,
          reviewed: 1,
          determinate: 1,
          unsure: 0,
          correct: 0,
          incorrect: 1,
          exactAccuracy: 0,
        },
        split: {
          total: 1,
          reviewed: 1,
          determinate: 1,
          unsure: 0,
          correct: 0,
          incorrect: 1,
          exactAccuracy: 0,
        },
        merge: {
          total: 1,
          reviewed: 1,
          determinate: 0,
          unsure: 1,
          correct: 0,
          incorrect: 0,
          exactAccuracy: null,
        },
      },
      effort: {
        activeSeconds: {
          total: 50,
          perReviewedPage: 25,
          perReviewedLine: 12.5,
        },
        repairActions: {
          total: 4,
          perReviewedPage: 2,
          perReviewedLine: 1,
        },
      },
    });
  });

  it('compares corrected segment groups independent of ID order', () => {
    const scorecard = buildTranscriptAlignmentScorecard('run-a', [
      page('page-1', [
        item('line-1', {
          operation: 'split',
          alternatives: [['segment-b', 'segment-a']],
          review: savedReview('incorrect', {
            correctSegmentIds: ['segment-a', 'segment-b'],
          }),
        }),
      ]),
    ]);

    expect(scorecard.alternatives).toEqual({
      eligibleIncorrectCount: 1,
      recalledCount: 1,
      topAlternativeRecall: 1,
    });
  });

  it('keeps exact empty mappings measurable while link ratios stay null', () => {
    const scorecard = buildTranscriptAlignmentScorecard('run-a', [
      page('page-1', [
        item('line-1', {
          status: 'accepted',
          operation: 'unlocated-transcript',
          segmentIds: [],
          review: savedReview('correct', {
            correctSegmentIds: [],
          }),
        }),
      ]),
    ]);

    expect(scorecard.mappings).toMatchObject({
      determinate: 1,
      correct: 1,
      exactAccuracy: 1,
    });
    expect(scorecard.segmentLinks).toEqual({
      evaluatedMappings: 1,
      truePositive: 0,
      falsePositive: 0,
      falseNegative: 0,
      precision: null,
      recall: null,
      f1: null,
    });
  });
});
