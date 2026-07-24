import { useCallback, useState } from 'react';
import { DEFAULT_DASHBOARD_SORT } from './constants';
import type { SortColumn } from './types';

export function useDashboardSort(initialSortColumns: SortColumn[] = []) {
  const [sortColumns, setSortColumns] = useState<SortColumn[]>(
    () => (
      initialSortColumns.length > 0
        ? initialSortColumns.map((column) => ({ ...column }))
        : [{ ...DEFAULT_DASHBOARD_SORT }]
    ),
  );

  const replaceSortColumns = useCallback((columns: readonly SortColumn[]) => {
    setSortColumns(columns.map((column) => ({ ...column })));
  }, []);

  return {
    sortColumns,
    setSortColumns,
    replaceSortColumns,
  };
}
