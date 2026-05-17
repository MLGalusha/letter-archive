import type { ReactNode } from "react";
import type { ExtendedSortField, SortInfo } from "./types";

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

  return (
    <th
      data-column={dataColumn}
      className={`${className} sortable-header ${sortInfo ? "sorted" : ""}`.trim()}
      onClick={() => onSort(field)}
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
