import type { Dispatch, SetStateAction } from "react";
import { useMemo } from "react";
import { DEFAULT_DASHBOARD_SORT } from "./constants";
import type { ClientSortField, ServerSortField, SortColumn, SortDirection } from "./types";
import { isServerSortField } from "./utils";

interface DashboardSortControlProps {
  sortColumns: SortColumn[];
  setSortColumns: Dispatch<SetStateAction<SortColumn[]>>;
}

export default function DashboardSortControl({
  sortColumns,
  setSortColumns,
}: DashboardSortControlProps) {
  const clientSortColumns = useMemo(
    () => sortColumns.filter((column): column is SortColumn & { field: ClientSortField } => !isServerSortField(column.field)),
    [sortColumns],
  );

  const primarySortValue = useMemo(() => {
    const serverSort = [...sortColumns].reverse().find((column) => isServerSortField(column.field));
    if (!serverSort) return `${DEFAULT_DASHBOARD_SORT.field}:${DEFAULT_DASHBOARD_SORT.direction}`;
    return `${serverSort.field}:${serverSort.direction}`;
  }, [sortColumns]);

  const handlePrimarySortChange = (value: string) => {
    const [field, direction] = value.split(":") as [ServerSortField, SortDirection];
    setSortColumns((previous) => [
      ...previous.filter((column) => !isServerSortField(column.field)),
      { field, direction },
    ]);
  };

  const handleClearPageSorts = () => {
    setSortColumns((previous) => previous.filter((column) => isServerSortField(column.field)));
  };

  const pageSortSummary = clientSortColumns
    .map((column) => `${getClientSortLabel(column.field)} ${column.direction === "asc" ? "↑" : "↓"}`)
    .join(", ");

  return (
    <div className="dashboard-sort-stack">
      <label className="dashboard-sort-control">
        <span>Primary sort</span>
        <select
          value={primarySortValue}
          onChange={(event) => handlePrimarySortChange(event.target.value)}
          title="Sorts the full filtered result set."
        >
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
      {clientSortColumns.length > 0 && (
        <div className="dashboard-page-sort-note">
          <span title="Column count sorts apply only to the currently loaded page.">
            Page sort: {pageSortSummary}
          </span>
          <button type="button" onClick={handleClearPageSorts}>
            Clear
          </button>
        </div>
      )}
    </div>
  );
}

function getClientSortLabel(field: ClientSortField): string {
  switch (field) {
    case "letters":
      return "Letters";
    case "extras":
      return "Extras";
    case "photos":
      return "Photos";
  }
}
