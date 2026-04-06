import { useCallback, useState } from 'react';
import type { ExtendedSortField, SortColumn } from './types';
import { isServerSortField } from './utils';

export function useDashboardSort(initialSortColumns: SortColumn[] = []) {
  const [sortColumns, setSortColumns] = useState<SortColumn[]>(initialSortColumns);

  const handleSort = useCallback((field: ExtendedSortField) => {
    setSortColumns((previous) => {
      const existingIndex = previous.findIndex((column) => column.field === field);

      if (existingIndex === -1) {
        // When adding a new server-sort field, remove other server-sort fields
        // so the new one becomes the active server sort (API only supports one)
        const isServer = isServerSortField(field);
        const base = isServer
          ? previous.filter((col) => !isServerSortField(col.field))
          : previous;
        return [...base, { field, direction: 'asc' }];
      }

      const existing = previous[existingIndex];
      if (existing.direction === 'asc') {
        const next = [...previous];
        next[existingIndex] = { field, direction: 'desc' };
        return next;
      }

      return previous.filter((column) => column.field !== field);
    });
  }, []);

  const getSortInfo = useCallback((field: ExtendedSortField) => {
    const index = sortColumns.findIndex((column) => column.field === field);
    if (index === -1) {
      return null;
    }

    return {
      direction: sortColumns[index].direction,
      priority: index + 1,
      total: sortColumns.length,
    };
  }, [sortColumns]);

  return {
    sortColumns,
    setSortColumns,
    handleSort,
    getSortInfo,
  };
}
