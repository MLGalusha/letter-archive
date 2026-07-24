import type {
  BulkSource,
  BulkSourceSkip,
} from "../../../api/admin";

interface SourceBoundOutcome {
  requested: number;
  skipped: number;
  skipReasons: BulkSourceSkip[];
}

export function unobservedSourceSkips(
  selectedIds: Set<string>,
  selectedSources: BulkSource[],
): BulkSourceSkip[] {
  const observedIds = new Set(
    selectedSources.map(({ letterId }) => letterId),
  );
  return Array.from(selectedIds)
    .filter((letterId) => !observedIds.has(letterId))
    .map((letterId) => ({
      letterId,
      code: "SOURCE_NOT_OBSERVED" as const,
      reason: "Source version was not loaded; refresh and reselect",
    }));
}

export function includeUnobservedSelections<
  T extends SourceBoundOutcome,
>(
  outcome: T,
  selectedIds: Set<string>,
  selectedSources: BulkSource[],
): T {
  const unobserved = unobservedSourceSkips(selectedIds, selectedSources);
  return {
    ...outcome,
    requested: selectedIds.size,
    skipped: outcome.skipped + unobserved.length,
    skipReasons: [...outcome.skipReasons, ...unobserved],
  };
}

export function summarizeSourceSkips(reasons: BulkSourceSkip[]): string {
  const counts = new Map<string, number>();
  for (const { reason } of reasons) {
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([reason, count]) => (
      count > 1 ? `${reason} (${count} letters)` : reason
    ))
    .join(", ");
}
