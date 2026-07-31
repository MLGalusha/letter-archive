import { describe, expect, it } from 'vitest';
import type { LayoutEvaluationDecisionInput } from '../../../../api/admin/layoutBenchmark';
import { createBlindAssignment } from '../blindAssignment';

const RUN_ONE = 'kraken6-full-001';
const RUN_TWO = 'eynollah-full-001';
const UNSWAPPED_PAGE = '014-18780127-L01-01';
const SWAPPED_PAGE = '014-18780127-L01-02';

function decision(): LayoutEvaluationDecisionInput {
  return {
    leftRunId: RUN_ONE,
    rightRunId: RUN_TWO,
    preference: 'left',
    assessments: {
      left: {
        flags: ['missed_line'],
        repairs: {
          missedLinesAdded: 2,
          falseLinesRemoved: 0,
          splitLinesJoined: 0,
          mergedLinesSplit: 0,
          orientationCorrections: 0,
          readingOrderCorrections: 0,
          regionCorrections: 0,
          other: 0,
          total: 2,
        },
      },
      right: {
        flags: ['wrong_orientation'],
        repairs: {
          missedLinesAdded: 0,
          falseLinesRemoved: 0,
          splitLinesJoined: 0,
          mergedLinesSplit: 0,
          orientationCorrections: 1,
          readingOrderCorrections: 0,
          regionCorrections: 0,
          other: 0,
          total: 1,
        },
      },
    },
    confidence: 4,
    notes: 'canonical note',
  };
}

describe('createBlindAssignment', () => {
  it('is stable for an unordered run pair and produces both presentation orders', () => {
    const unswapped = createBlindAssignment(UNSWAPPED_PAGE, RUN_ONE, RUN_TWO);
    const unswappedReversed = createBlindAssignment(UNSWAPPED_PAGE, RUN_TWO, RUN_ONE);
    const swapped = createBlindAssignment(SWAPPED_PAGE, RUN_ONE, RUN_TWO);

    expect(unswapped.aRunId).toBe(RUN_ONE);
    expect(unswapped.bRunId).toBe(RUN_TWO);
    expect(unswappedReversed.aRunId).toBe(unswapped.aRunId);
    expect(unswappedReversed.bRunId).toBe(unswapped.bRunId);
    expect(swapped.aRunId).toBe(RUN_TWO);
    expect(swapped.bRunId).toBe(RUN_ONE);
  });

  it('round-trips canonical decisions through a swapped presentation', () => {
    const assignment = createBlindAssignment(SWAPPED_PAGE, RUN_ONE, RUN_TWO);
    const canonical = decision();
    const presented = assignment.toPresentationDecision(canonical);

    expect(presented.leftRunId).toBe(RUN_TWO);
    expect(presented.rightRunId).toBe(RUN_ONE);
    expect(presented.preference).toBe('right');
    expect(presented.assessments.left.flags).toEqual(['wrong_orientation']);
    expect(presented.assessments.right.flags).toEqual(['missed_line']);
    expect(assignment.toCanonicalDecision(presented)).toEqual(canonical);
  });
});
