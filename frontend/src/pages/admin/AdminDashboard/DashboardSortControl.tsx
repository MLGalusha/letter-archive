import type { Dispatch, SetStateAction } from "react";
import { useMemo } from "react";
import { DEFAULT_DASHBOARD_SORT } from "./constants";
import type { ServerSortField, SortColumn } from "./types";
import { isServerSortField } from "./utils";

interface DashboardSortControlProps {
  sortColumns: SortColumn[];
  setSortColumns: Dispatch<SetStateAction<SortColumn[]>>;
}

export default function DashboardSortControl({
  sortColumns,
  setSortColumns,
}: DashboardSortControlProps) {
  const primarySortValue = useMemo(() => {
    const serverSort = [...sortColumns].reverse().find((column) => isServerSortField(column.field));
    if (!serverSort) return `${DEFAULT_DASHBOARD_SORT.field}:${DEFAULT_DASHBOARD_SORT.direction}`;
    return `${serverSort.field}:${serverSort.direction}`;
  }, [sortColumns]);

  const handlePrimarySortChange = (value: string) => {
    const [field, direction] = value.split(":") as [ServerSortField, "asc" | "desc"];
    setSortColumns((previous) => [
      ...previous.filter((column) => !isServerSortField(column.field)),
      { field, direction },
    ]);
  };

  return (
    <label className="dashboard-sort-control">
      <span>Sort</span>
      <select value={primarySortValue} onChange={(event) => handlePrimarySortChange(event.target.value)}>
        <option value="lastOpenedAt:desc">Last opened</option>
        <option value="letterDate:asc">Letter date oldest</option>
        <option value="letterDate:desc">Letter date newest</option>
        <option value="collection:asc">Collection</option>
        <option value="createdAt:desc">Created newest</option>
        <option value="sender:asc">Sender</option>
        <option value="recipient:asc">Recipient</option>
        <option value="visibility:asc">Visibility</option>
        <option value="flagged:desc">Flagged</option>
      </select>
    </label>
  );
}
