import type {
  LayoutEvaluationDecisionInput,
  LayoutRunAssessment,
} from '../../../api/admin/layoutBenchmark';

export type CanonicalRunSide = 'left' | 'right';

export interface BlindAssignment {
  aRunId: string;
  bRunId: string;
  aCanonicalSide: CanonicalRunSide;
  bCanonicalSide: CanonicalRunSide;
  swapped: boolean;
  toPresentationDecision: (
    canonical: LayoutEvaluationDecisionInput,
  ) => LayoutEvaluationDecisionInput;
  toCanonicalDecision: (
    presentation: LayoutEvaluationDecisionInput,
  ) => LayoutEvaluationDecisionInput;
}

function murmurHash3(value: string): number {
  let hash = 0x9747b28c;
  let offset = 0;

  for (; offset + 4 <= value.length; offset += 4) {
    let chunk = (
      (value.charCodeAt(offset) & 0xff)
      | ((value.charCodeAt(offset + 1) & 0xff) << 8)
      | ((value.charCodeAt(offset + 2) & 0xff) << 16)
      | ((value.charCodeAt(offset + 3) & 0xff) << 24)
    );
    chunk = Math.imul(chunk, 0xcc9e2d51);
    chunk = (chunk << 15) | (chunk >>> 17);
    chunk = Math.imul(chunk, 0x1b873593);
    hash ^= chunk;
    hash = (hash << 13) | (hash >>> 19);
    hash = (Math.imul(hash, 5) + 0xe6546b64) | 0;
  }

  let tail = 0;
  const remaining = value.length & 3;
  if (remaining === 3) {
    tail ^= (value.charCodeAt(offset + 2) & 0xff) << 16;
  }
  if (remaining >= 2) {
    tail ^= (value.charCodeAt(offset + 1) & 0xff) << 8;
  }
  if (remaining >= 1) {
    tail ^= value.charCodeAt(offset) & 0xff;
    tail = Math.imul(tail, 0xcc9e2d51);
    tail = (tail << 15) | (tail >>> 17);
    tail = Math.imul(tail, 0x1b873593);
    hash ^= tail;
  }

  hash ^= value.length;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

function cloneAssessment(assessment: LayoutRunAssessment): LayoutRunAssessment {
  return {
    flags: [...assessment.flags],
    repairs: { ...assessment.repairs },
  };
}

function flipPreference(
  preference: LayoutEvaluationDecisionInput['preference'],
): LayoutEvaluationDecisionInput['preference'] {
  if (preference === 'left') return 'right';
  if (preference === 'right') return 'left';
  return preference;
}

function reorientDecision(
  decision: LayoutEvaluationDecisionInput,
  leftRunId: string,
  rightRunId: string,
  swapSides: boolean,
): LayoutEvaluationDecisionInput {
  return {
    ...decision,
    leftRunId,
    rightRunId,
    preference: swapSides ? flipPreference(decision.preference) : decision.preference,
    assessments: swapSides
      ? {
          left: cloneAssessment(decision.assessments.right),
          right: cloneAssessment(decision.assessments.left),
        }
      : {
          left: cloneAssessment(decision.assessments.left),
          right: cloneAssessment(decision.assessments.right),
        },
  };
}

/**
 * Produces the presentation-only A/B order for one page and unordered run pair.
 *
 * The hash input and algorithm are deliberately versioned and deterministic.
 * Persisted evaluations remain in the caller's canonical left/right run order;
 * only the visible A/B presentation is permuted.
 */
export function createBlindAssignment(
  pageKey: string,
  canonicalLeftRunId: string,
  canonicalRightRunId: string,
): BlindAssignment {
  if (!pageKey || !canonicalLeftRunId || !canonicalRightRunId) {
    throw new Error('Blind assignment requires a page and two run IDs');
  }
  if (canonicalLeftRunId === canonicalRightRunId) {
    throw new Error('Blind assignment requires distinct run IDs');
  }

  const orderedRunIds = [canonicalLeftRunId, canonicalRightRunId].sort();
  const seed = [
    'layout-blind-v1',
    orderedRunIds[0],
    orderedRunIds[1],
    pageKey,
  ].join('\0');
  const aRunId = (murmurHash3(seed) & 1) === 0
    ? orderedRunIds[0]
    : orderedRunIds[1];
  const bRunId = aRunId === orderedRunIds[0] ? orderedRunIds[1] : orderedRunIds[0];
  const swapped = aRunId === canonicalRightRunId;

  return {
    aRunId,
    bRunId,
    aCanonicalSide: swapped ? 'right' : 'left',
    bCanonicalSide: swapped ? 'left' : 'right',
    swapped,
    toPresentationDecision: (canonical) => reorientDecision(
      canonical,
      aRunId,
      bRunId,
      swapped,
    ),
    toCanonicalDecision: (presentation) => reorientDecision(
      presentation,
      canonicalLeftRunId,
      canonicalRightRunId,
      swapped,
    ),
  };
}
