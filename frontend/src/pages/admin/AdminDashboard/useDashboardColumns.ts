import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ALL_COLUMNS,
  COLUMN_STORAGE_KEY,
  DEFAULT_COLUMN_ORDER,
  DEFAULT_VISIBLE_COLUMNS,
} from './constants';
import type { ColumnDef, ColumnId } from './types';

interface SavedColumnsState {
  visible: ColumnId[];
  known: ColumnId[];
  order?: ColumnId[];
}

function normalizeColumnOrder(savedOrder?: ColumnId[]): ColumnId[] {
  const allColumnIds = new Set(DEFAULT_COLUMN_ORDER);
  const normalized = (savedOrder ?? [])
    .filter((id): id is ColumnId => allColumnIds.has(id));
  const savedSet = new Set(normalized);
  return [
    ...normalized,
    ...DEFAULT_COLUMN_ORDER.filter((id) => !savedSet.has(id)),
  ];
}

function loadColumnState(): { visibleColumns: Set<ColumnId>; columnOrder: ColumnId[] } {
  try {
    const saved = localStorage.getItem(COLUMN_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as ColumnId[] | SavedColumnsState;
      let visible: ColumnId[];
      let known: ColumnId[];
      let order: ColumnId[] | undefined;

      if (Array.isArray(parsed)) {
        visible = parsed;
        known = parsed;
        order = parsed;
      } else {
        visible = parsed.visible ?? [];
        known = parsed.known ?? [];
        order = parsed.order;
      }

      const savedSet = new Set(visible);
      const knownSet = new Set(known);

      for (const column of ALL_COLUMNS) {
        if (column.defaultVisible && !knownSet.has(column.id)) {
          savedSet.add(column.id);
        }
      }

      return {
        visibleColumns: savedSet,
        columnOrder: normalizeColumnOrder(order),
      };
    }
  } catch (error) {
    console.warn('Failed to load column settings:', error);
  }

  return {
    visibleColumns: DEFAULT_VISIBLE_COLUMNS,
    columnOrder: DEFAULT_COLUMN_ORDER,
  };
}

export function useDashboardColumns() {
  const initialColumnState = useRef(loadColumnState());
  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnId>>(
    initialColumnState.current.visibleColumns,
  );
  const [columnOrder, setColumnOrder] = useState<ColumnId[]>(
    initialColumnState.current.columnOrder,
  );
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const columnMenuRef = useRef<HTMLTableCellElement>(null);

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

  useEffect(() => {
    if (!showColumnMenu) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (columnMenuRef.current && !columnMenuRef.current.contains(event.target as Node)) {
        setShowColumnMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showColumnMenu]);

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

  const resetColumnOrder = useCallback(() => {
    setColumnOrder(DEFAULT_COLUMN_ORDER);
  }, []);

  const toggleColumnMenu = useCallback(() => {
    setShowColumnMenu((previous) => !previous);
  }, []);

  const columnById = new Map(ALL_COLUMNS.map((column) => [column.id, column]));
  const orderedColumns = columnOrder
    .map((id) => columnById.get(id))
    .filter((column): column is ColumnDef => Boolean(column));

  return {
    visibleColumns,
    setVisibleColumns,
    columnOrder,
    setColumnOrder,
    orderedColumns,
    showColumnMenu,
    setShowColumnMenu,
    columnMenuRef,
    toggleColumnVisibility,
    moveColumn,
    resetColumnOrder,
    toggleColumnMenu,
  };
}
