import type { RefObject } from "react";
import { Icon } from "../../../components/common/Icon";
import type { ColumnDef, ColumnId } from "./types";

interface ColumnToggleHeaderProps {
  allColumns: ColumnDef[];
  visibleColumns: Set<ColumnId>;
  showColumnMenu: boolean;
  onToggleColumnMenu: () => void;
  onToggleColumn: (id: ColumnId) => void;
  columnMenuRef: RefObject<HTMLTableCellElement | null>;
}

export default function ColumnToggleHeader({
  allColumns,
  visibleColumns,
  showColumnMenu,
  onToggleColumnMenu,
  onToggleColumn,
  columnMenuRef,
}: ColumnToggleHeaderProps) {
  return (
    <th className="checkbox-header" ref={columnMenuRef}>
      <button
        className={`column-toggle-btn ${showColumnMenu ? "active" : ""}`}
        onClick={onToggleColumnMenu}
        title="Toggle columns"
      >
        <Icon name="columns" size={14} />
      </button>
      {showColumnMenu && (
        <div className="column-toggle-dropdown column-toggle-left">
          {allColumns.map((col) => (
            <label key={col.id} className="column-toggle-item">
              <input
                type="checkbox"
                checked={visibleColumns.has(col.id)}
                onChange={() => onToggleColumn(col.id)}
              />
              {col.label}
            </label>
          ))}
        </div>
      )}
    </th>
  );
}
