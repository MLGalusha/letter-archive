import { useCallback, useMemo, useState } from 'react';

interface IdentifiableRow {
  id: string;
}

export function useDashboardSelection<T extends IdentifiableRow>(rows: T[]) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [allFilteredSelected, setAllFilteredSelected] = useState(false);

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    setAllFilteredSelected(false);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setAllFilteredSelected(false);
  }, []);

  const allPageSelected = useMemo(
    () => rows.length > 0 && rows.every((row) => selectedIds.has(row.id)),
    [rows, selectedIds],
  );

  const handleSelectAllPage = useCallback(() => {
    if (allPageSelected) {
      clearSelection();
      return;
    }

    setSelectedIds((previous) => {
      const next = new Set(previous);
      for (const row of rows) {
        next.add(row.id);
      }
      return next;
    });
    setAllFilteredSelected(false);
  }, [allPageSelected, clearSelection, rows]);

  const selectAllFiltered = useCallback((ids: string[]) => {
    setSelectedIds(new Set(ids));
    setAllFilteredSelected(true);
  }, []);

  return {
    selectedIds,
    setSelectedIds,
    allFilteredSelected,
    setAllFilteredSelected,
    toggleSelection,
    clearSelection,
    allPageSelected,
    handleSelectAllPage,
    selectAllFiltered,
  };
}
