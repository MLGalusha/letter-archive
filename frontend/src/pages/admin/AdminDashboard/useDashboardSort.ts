import { useState } from 'react';
import { DEFAULT_DASHBOARD_SORT } from './constants';
import type { SortColumn } from './types';

export function useDashboardSort(initialSortColumns: SortColumn[] = []) {
  const [sortColumns, setSortColumns] = useState<SortColumn[]>(
    initialSortColumns.length > 0 ? initialSortColumns : [DEFAULT_DASHBOARD_SORT],
  );

  return {
    sortColumns,
    setSortColumns,
  };
}
