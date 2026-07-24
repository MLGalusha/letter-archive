import { useCallback, useEffect, useState } from 'react';
import {
  ALL_COLUMNS,
  COLUMN_STORAGE_KEY,
  DEFAULT_COLUMN_ORDER,
} from './constants';
import { decodeDashboardColumnState } from './dashboardStoredStateModel';
import type { ColumnDef, ColumnId, DashboardViewState } from './types';

function loadColumnState(): { visibleColumns: Set<ColumnId>; columnOrder: ColumnId[] } {
  try {
    const saved = localStorage.getItem(COLUMN_STORAGE_KEY);
    const state = decodeDashboardColumnState(
      saved ? JSON.parse(saved) : undefined,
    );
    return {
      visibleColumns: new Set(state.visibleColumns),
      columnOrder: state.columnOrder,
    };
  } catch (error) {
    console.warn('Failed to load column settings:', error);
  }

  const defaults = decodeDashboardColumnState(undefined);
  return {
    visibleColumns: new Set(defaults.visibleColumns),
    columnOrder: defaults.columnOrder,
  };
}

export function useDashboardColumns() {
  const [initialColumnState] = useState(loadColumnState);
  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnId>>(
    initialColumnState.visibleColumns,
  );
  const [columnOrder, setColumnOrder] = useState<ColumnId[]>(
    initialColumnState.columnOrder,
  );

  useEffect(() => {
    try {
      localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify({
        visible: Array.from(visibleColumns),
        order: columnOrder,
        known: ALL_COLUMNS.map((column) => column.id),
      }));
    } catch (error) {
      console.warn('Failed to save column settings:', error);
    }
  }, [columnOrder, visibleColumns]);

  const toggleColumnVisibility = useCallback((columnId: ColumnId) => {
    setVisibleColumns((previous) => {
      const next = new Set(previous);
      if (next.has(columnId)) {
        next.delete(columnId);
      } else {
        next.add(columnId);
      }
      return next;
    });
  }, []);

  const moveColumn = useCallback((columnId: ColumnId, direction: -1 | 1) => {
    setColumnOrder((previous) => {
      const currentIndex = previous.indexOf(columnId);
      if (currentIndex === -1) return previous;
      const nextIndex = currentIndex + direction;
      if (nextIndex < 0 || nextIndex >= previous.length) return previous;

      const next = [...previous];
      const [column] = next.splice(currentIndex, 1);
      next.splice(nextIndex, 0, column);
      return next;
    });
  }, []);

  const reorderColumn = useCallback((columnId: ColumnId, targetIndex: number) => {
    setColumnOrder((previous) => {
      const currentIndex = previous.indexOf(columnId);
      if (currentIndex === -1 || targetIndex < 0 || targetIndex >= previous.length) {
        return previous;
      }

      const next = [...previous];
      const [column] = next.splice(currentIndex, 1);
      next.splice(targetIndex, 0, column);
      return next;
    });
  }, []);

  const replaceStoredColumns = useCallback((state: Pick<
    DashboardViewState,
    'visibleColumns' | 'columnOrder'
  >) => {
    setVisibleColumns(new Set(state.visibleColumns));
    setColumnOrder([...state.columnOrder]);
  }, []);

  const resetColumnOrder = useCallback(() => {
    setColumnOrder([...DEFAULT_COLUMN_ORDER]);
  }, []);

  const columnById = new Map(ALL_COLUMNS.map((column) => [column.id, column]));
  const orderedColumns = columnOrder
    .map((id) => columnById.get(id))
    .filter((column): column is ColumnDef => Boolean(column));

  return {
    visibleColumns,
    columnOrder,
    replaceStoredColumns,
    orderedColumns,
    toggleColumnVisibility,
    moveColumn,
    reorderColumn,
    resetColumnOrder,
  };
}
