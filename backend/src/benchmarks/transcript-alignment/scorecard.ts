import type {
  TranscriptAlignmentFailureMode,
  TranscriptAlignmentPageResponse,
} from './schemas.js';
import {
  TRANSCRIPT_ALIGNMENT_FAILURE_MODES,
} from './schemas.js';

type ReviewItem = TranscriptAlignmentPageResponse['items'][number];

export interface TranscriptAlignmentScorecardPage {
  pageKey: string;
  items: readonly ReviewItem[];
}

interface AccuracyBreakdown {
  total: number;
  reviewed: number;
  determinate: number;
  unsure: number;
  correct: number;
  incorrect: number;
  exactAccuracy: number | null;
}

export interface TranscriptAlignmentScorecard {
  schemaVersion: 1;
  runId: string;
  pageCount: number;
  reviewedPageCount: number;
  mappings: AccuracyBreakdown;
  autoAccepted: {
    proposedCount: number;
    reviewedCount: number;
    determinateReviewedCount: number;
    correctReviewedCount: number;
    precision: number | null;
    coverage: number | null;
  };
  alternatives: {
    eligibleIncorrectCount: number;
    recalledCount: number;
    topAlternativeRecall: number | null;
  };
  failureModes: Record<TranscriptAlignmentFailureMode, number>;
  segmentLinks: {
    evaluatedMappings: number;
    truePositive: number;
    falsePositive: number;
    falseNegative: number;
    precision: number | null;
    recall: number | null;
    f1: number | null;
  };
  operations: {
    unlocated: AccuracyBreakdown;
    split: AccuracyBreakdown;
    merge: AccuracyBreakdown;
  };
  effort: {
    activeSeconds: {
      total: number;
      perReviewedPage: number | null;
      perReviewedLine: number | null;
    };
    repairActions: {
      total: number;
      perReviewedPage: number | null;
      perReviewedLine: number | null;
    };
  };
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0
    ? Number((numerator / denominator).toFixed(6))
    : null;
}

function reviewed(items: readonly ReviewItem[]): ReviewItem[] {
  return items.filter((item) => item.review !== null);
}

function accuracyBreakdown(
  items: readonly ReviewItem[],
): AccuracyBreakdown {
  const reviewedItems = reviewed(items);
  const correct = reviewedItems.filter(
    ({ review }) => review?.verdict === 'correct',
  ).length;
  const incorrect = reviewedItems.filter(
    ({ review }) => review?.verdict === 'incorrect',
  ).length;
  const unsure = reviewedItems.filter(
    ({ review }) => review?.verdict === 'unsure',
  ).length;
  const determinate = correct + incorrect;
  return {
    total: items.length,
    reviewed: reviewedItems.length,
    determinate,
    unsure,
    correct,
    incorrect,
    exactAccuracy: ratio(correct, determinate),
  };
}

function sameSegmentIds(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) return false;
  const leftSorted = [...left].sort();
  const rightSorted = [...right].sort();
  return leftSorted.every((segmentId, index) => (
    segmentId === rightSorted[index]
  ));
}

export function buildTranscriptAlignmentScorecard(
  runId: string,
  pages: readonly TranscriptAlignmentScorecardPage[],
): TranscriptAlignmentScorecard {
  const items = pages.flatMap((page) => [...page.items]);
  const reviewedItems = reviewed(items);
  const reviewedPageCount = pages.filter((page) => (
    page.items.some((item) => item.review !== null)
  )).length;

  const autoAcceptedItems = items.filter(
    ({ mapping }) => mapping.status === 'accepted',
  );
  const reviewedAutoAcceptedItems = reviewed(autoAcceptedItems);
  const determinateAutoAcceptedItems = reviewedAutoAcceptedItems.filter(
    ({ review }) => review?.verdict !== 'unsure',
  );
  const correctAutoAcceptedCount = determinateAutoAcceptedItems.filter(
    ({ review }) => review?.verdict === 'correct',
  ).length;

  const alternativeEligibleItems = reviewedItems.filter((item) => (
    item.review?.verdict === 'incorrect'
    && item.review.correctSegmentIds.length > 0
  ));
  const recalledAlternativeCount = alternativeEligibleItems.filter((item) => (
    item.mapping.alternatives.some((alternative) => (
      sameSegmentIds(
        alternative.segmentIds,
        item.review?.correctSegmentIds ?? [],
      )
    ))
  )).length;

  const failureModes = Object.fromEntries(
    TRANSCRIPT_ALIGNMENT_FAILURE_MODES.map((failureMode) => [failureMode, 0]),
  ) as Record<TranscriptAlignmentFailureMode, number>;
  reviewedItems.forEach((item) => {
    item.review?.failureModes.forEach((failureMode) => {
      failureModes[failureMode] += 1;
    });
  });

  const determinateItems = reviewedItems.filter(
    ({ review }) => review?.verdict !== 'unsure',
  );
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  determinateItems.forEach((item) => {
    const proposed = new Set(item.mapping.segmentIds);
    const expected = new Set(item.review?.correctSegmentIds ?? []);
    proposed.forEach((segmentId) => {
      if (expected.has(segmentId)) truePositive += 1;
      else falsePositive += 1;
    });
    expected.forEach((segmentId) => {
      if (!proposed.has(segmentId)) falseNegative += 1;
    });
  });

  const activeSeconds = reviewedItems.reduce(
    (total, item) => total + (item.review?.activeSeconds ?? 0),
    0,
  );
  const repairActions = reviewedItems.reduce(
    (total, item) => total + (item.review?.repairActions ?? 0),
    0,
  );

  return {
    schemaVersion: 1,
    runId,
    pageCount: pages.length,
    reviewedPageCount,
    mappings: accuracyBreakdown(items),
    autoAccepted: {
      proposedCount: autoAcceptedItems.length,
      reviewedCount: reviewedAutoAcceptedItems.length,
      determinateReviewedCount: determinateAutoAcceptedItems.length,
      correctReviewedCount: correctAutoAcceptedCount,
      precision: ratio(
        correctAutoAcceptedCount,
        determinateAutoAcceptedItems.length,
      ),
      coverage: ratio(autoAcceptedItems.length, items.length),
    },
    alternatives: {
      eligibleIncorrectCount: alternativeEligibleItems.length,
      recalledCount: recalledAlternativeCount,
      topAlternativeRecall: ratio(
        recalledAlternativeCount,
        alternativeEligibleItems.length,
      ),
    },
    failureModes,
    segmentLinks: {
      evaluatedMappings: determinateItems.length,
      truePositive,
      falsePositive,
      falseNegative,
      precision: ratio(truePositive, truePositive + falsePositive),
      recall: ratio(truePositive, truePositive + falseNegative),
      f1: ratio(
        2 * truePositive,
        (2 * truePositive) + falsePositive + falseNegative,
      ),
    },
    operations: {
      unlocated: accuracyBreakdown(items.filter(
        ({ mapping }) => mapping.operation === 'unlocated-transcript',
      )),
      split: accuracyBreakdown(items.filter(
        ({ mapping }) => mapping.operation === 'split',
      )),
      merge: accuracyBreakdown(items.filter(
        ({ mapping }) => mapping.operation === 'merge',
      )),
    },
    effort: {
      activeSeconds: {
        total: activeSeconds,
        perReviewedPage: ratio(activeSeconds, reviewedPageCount),
        perReviewedLine: ratio(activeSeconds, reviewedItems.length),
      },
      repairActions: {
        total: repairActions,
        perReviewedPage: ratio(repairActions, reviewedPageCount),
        perReviewedLine: ratio(repairActions, reviewedItems.length),
      },
    },
  };
}
