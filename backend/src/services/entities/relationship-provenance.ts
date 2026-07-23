export const SYSTEM_BACKFILL_RELATIONSHIP_OWNER = 'system-backfill';

export interface MergeCollisionCandidate {
  id: string;
  confidence: number;
  entityExtractionRevision: number | null;
  confirmedBy: string | null;
  confirmedAt: Date | string | null;
}

export interface CommittedEntityExtraction {
  entityExtractionRevision: number;
  entityExtractionJson: unknown;
}

export function isCurrentlyTrustedMergeExtraction(
  candidate: MergeCollisionCandidate,
  committed: CommittedEntityExtraction | null,
): boolean {
  return (
    candidate.entityExtractionRevision !== null
    && committed?.entityExtractionJson != null
    && candidate.entityExtractionRevision === committed.entityExtractionRevision
  );
}

/**
 * Pick one authoritative collision payload without synthesizing a provenance
 * tuple from multiple rows. Exact ties intentionally retain the existing row.
 */
export function chooseEntityMergeCollisionWinner<T extends MergeCollisionCandidate>(
  existing: T,
  incoming: T,
  trust: {
    existingIsCurrentExtraction: boolean;
    incomingIsCurrentExtraction: boolean;
  },
): T {
  const rank = (candidate: T, isCurrentExtraction: boolean): number => {
    // confirmedBy alone (including system-backfill) is not human confirmation.
    if (candidate.confirmedAt != null) return 2;
    if (isCurrentExtraction) return 1;
    return 0;
  };

  const existingRank = rank(existing, trust.existingIsCurrentExtraction);
  const incomingRank = rank(incoming, trust.incomingIsCurrentExtraction);
  if (existingRank !== incomingRank) {
    return incomingRank > existingRank ? incoming : existing;
  }

  if (existing.confidence !== incoming.confidence) {
    return incoming.confidence > existing.confidence ? incoming : existing;
  }

  return existing;
}
