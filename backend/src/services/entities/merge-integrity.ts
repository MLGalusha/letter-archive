import { isDeepStrictEqual } from 'node:util';

interface RestoredRow {
  id: string;
}

/**
 * Undo is only successful when every row recorded by the merge snapshot was
 * restored. A missing or substituted row must abort the surrounding transaction.
 */
export function assertRestoredIds(
  label: string,
  expectedIds: readonly string[],
  restoredRows: readonly RestoredRow[],
): void {
  const restoredIds = new Set(restoredRows.map((row) => row.id));
  if (
    restoredRows.length !== expectedIds.length
    || expectedIds.some((id) => !restoredIds.has(id))
  ) {
    throw new Error(
      `Could not completely restore ${label}: expected ${expectedIds.length}, restored ${restoredRows.length}`,
    );
  }
}

export function assertSnapshotsUnchanged<T extends { id: string }>(
  label: string,
  expectedRows: readonly T[],
  currentRows: readonly T[],
): void {
  const byId = (rows: readonly T[]) => (
    [...rows].sort((left, right) => left.id.localeCompare(right.id))
  );

  if (
    !isDeepStrictEqual(
      byId(expectedRows),
      byId(currentRows),
    )
  ) {
    throw new Error(`${label} changed after the merge; undo was not applied`);
  }
}
