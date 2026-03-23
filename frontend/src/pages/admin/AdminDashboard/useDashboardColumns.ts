import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ALL_COLUMNS,
  COLUMN_STORAGE_KEY,
  DEFAULT_VISIBLE_COLUMNS,
} from './constants';
import type { ColumnId } from './types';

export function useDashboardColumns() {
  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnId>>(() => {
    try {
      const saved = localStorage.getItem(COLUMN_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        let visible: ColumnId[];
        let known: ColumnId[];

        if (Array.isArray(parsed)) {
          visible = parsed;
          known = parsed;
        } else {
          visible = parsed.visible ?? [];
          known = parsed.known ?? [];
        }

        const savedSet = new Set(visible);
        const knownSet = new Set(known);

        for (const column of ALL_COLUMNS) {
          if (column.defaultVisible && !knownSet.has(column.id)) {
            savedSet.add(column.id);
          }
        }

        return savedSet;
      }
    } catch (error) {
      console.warn('Failed to load column visibility:', error);
    }

    return DEFAULT_VISIBLE_COLUMNS;
  });
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const columnMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify({
        visible: Array.from(visibleColumns),
        known: ALL_COLUMNS.map((column) => column.id),
      }));
    } catch (error) {
      console.warn('Failed to save column visibility:', error);
    }
  }, [visibleColumns]);

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

  const toggleColumnMenu = useCallback(() => {
    setShowColumnMenu((previous) => !previous);
  }, []);

  return {
    visibleColumns,
    showColumnMenu,
    setShowColumnMenu,
    columnMenuRef,
    toggleColumnVisibility,
    toggleColumnMenu,
  };
}
