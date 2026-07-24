import {
  useCallback,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';

interface IdentifiableRow {
  id: string;
  primarySourceRevision?: number;
}

interface DashboardSelectionState {
  ids: Set<string>;
  sourceRevisions: Map<string, number>;
}

export function useDashboardSelection<T extends IdentifiableRow>(rows: T[]) {
  const [selection, setSelection] = useState<DashboardSelectionState>(() => ({
    ids: new Set(),
    sourceRevisions: new Map(),
  }));
  const [allFilteredSelected, setAllFilteredSelected] = useState(false);
  const selectedIds = selection.ids;
  const selectedSourceRevisions = selection.sourceRevisions;

  const setSelectedIds = useCallback<Dispatch<SetStateAction<Set<string>>>>(
    (action) => {
      setSelection((previous) => {
        const ids = typeof action === 'function'
          ? action(previous.ids)
          : action;
        const sourceRevisions = new Map(previous.sourceRevisions);

        for (const letterId of sourceRevisions.keys()) {
          if (!ids.has(letterId)) sourceRevisions.delete(letterId);
        }
        for (const row of rows) {
          if (
            ids.has(row.id)
            && !previous.ids.has(row.id)
            && typeof row.primarySourceRevision === 'number'
          ) {
            sourceRevisions.set(row.id, row.primarySourceRevision);
          }
        }

        return { ids, sourceRevisions };
      });
    },
    [rows],
  );

  const toggleSelection = useCallback((id: string) => {
    setSelection((previous) => {
      const next = new Set(previous.ids);
      const sourceRevisions = new Map(previous.sourceRevisions);
      const selecting = !next.has(id);
      if (selecting) next.add(id);
      else next.delete(id);

      if (!selecting) {
        sourceRevisions.delete(id);
      } else {
        const row = rows.find((candidate) => candidate.id === id);
        if (typeof row?.primarySourceRevision === 'number') {
          sourceRevisions.set(id, row.primarySourceRevision);
        }
      }

      return { ids: next, sourceRevisions };
    });
    setAllFilteredSelected(false);
  }, [rows]);

  const clearSelection = useCallback(() => {
    setSelection({
      ids: new Set(),
      sourceRevisions: new Map(),
    });
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

    setSelection((previous) => {
      const next = new Set(previous.ids);
      const sourceRevisions = new Map(previous.sourceRevisions);
      for (const row of rows) {
        next.add(row.id);
        if (
          typeof row.primarySourceRevision === 'number'
          && !sourceRevisions.has(row.id)
        ) {
          sourceRevisions.set(row.id, row.primarySourceRevision);
        }
      }
      return { ids: next, sourceRevisions };
    });
    setAllFilteredSelected(false);
  }, [allPageSelected, clearSelection, rows]);

  const selectAllFiltered = useCallback((ids: string[]) => {
    const idSet = new Set(ids);
    setSelection({
      ids: idSet,
      sourceRevisions: new Map(rows.flatMap((row) => (
        idSet.has(row.id) && typeof row.primarySourceRevision === 'number'
          ? [[row.id, row.primarySourceRevision] as const]
          : []
      ))),
    });
    setAllFilteredSelected(true);
  }, [rows]);

  const selectedSources = useMemo(() => Array.from(selectedIds).flatMap(
    (letterId) => {
      const primarySourceRevision = selectedSourceRevisions.get(letterId);
      return primarySourceRevision === undefined
        ? []
        : [{ letterId, primarySourceRevision }];
    },
  ), [selectedIds, selectedSourceRevisions]);

  return {
    selectedIds,
    selectedSources,
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
