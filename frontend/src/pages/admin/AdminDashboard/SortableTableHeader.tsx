import type { ReactNode } from "react";
import type { ExtendedSortField, SortInfo } from "./types";
import { isServerSortField } from "./utils";

interface SortableTableHeaderProps {
  field: ExtendedSortField;
  dataColumn?: string;
  className?: string;
  label: ReactNode;
  getSortInfo: (field: ExtendedSortField) => SortInfo | null;
  onSort: (field: ExtendedSortField) => void;
}

export default function SortableTableHeader({
  field,
  dataColumn,
  className = "",
  label,
  getSortInfo,
  onSort,
}: SortableTableHeaderProps) {
  const sortInfo = getSortInfo(field);
  const sortScope = isServerSortField(field)
    ? "Sorts the full filtered result set."
    : "Sorts the currently loaded page only.";

  return (
    <th
      data-column={dataColumn}
      className={`${className} sortable-header ${sortInfo ? "sorted" : ""}`.trim()}
      onClick={() => onSort(field)}
      title={sortScope}
      aria-sort={sortInfo ? (sortInfo.direction === "asc" ? "ascending" : "descending") : "none"}
    >
      <span className="header-content">
        {label}
        {sortInfo && (
          <span className="sort-indicator">
            <span className="sort-arrow">
              {sortInfo.direction === "asc" ? "↑" : "↓"}
            </span>
            {sortInfo.total > 1 && (
              <span className="sort-priority">{sortInfo.priority}</span>
            )}
          </span>
        )}
      </span>
    </th>
  );
}
