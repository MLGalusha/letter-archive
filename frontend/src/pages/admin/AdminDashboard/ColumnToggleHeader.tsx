import type { RefObject } from "react";
import { Icon } from "../../../components/common/Icon";
import type { ColumnDef, ColumnId } from "./types";

interface ColumnToggleHeaderProps {
  allColumns: Array<{ id: ColumnId; label: string }>;
  orderedColumns: ColumnDef[];
  visibleColumns: Set<ColumnId>;
  showColumnMenu: boolean;
  onToggleColumnMenu: () => void;
  onToggleColumn: (id: ColumnId) => void;
  onMoveColumn: (id: ColumnId, direction: -1 | 1) => void;
  onResetColumnOrder: () => void;
  columnMenuRef: RefObject<HTMLTableCellElement | null>;
}

export default function ColumnToggleHeader({
  allColumns,
  orderedColumns,
  visibleColumns,
  showColumnMenu,
  onToggleColumnMenu,
  onToggleColumn,
  onMoveColumn,
  onResetColumnOrder,
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
          <div className="column-toggle-header-row">
            <span>Columns</span>
            <button type="button" onClick={onResetColumnOrder}>
              Reset
            </button>
          </div>
          {orderedColumns.map((col, index) => (
            <div key={col.id} className="column-toggle-item">
              <label>
                <input
                  type="checkbox"
                  checked={visibleColumns.has(col.id)}
                  onChange={() => onToggleColumn(col.id)}
                />
                <span>{col.label}</span>
              </label>
              <div className="column-order-actions" aria-label={`Reorder ${col.label}`}>
                <button
                  type="button"
                  onClick={() => onMoveColumn(col.id, -1)}
                  disabled={index === 0}
                  aria-label={`Move ${col.label} left`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => onMoveColumn(col.id, 1)}
                  disabled={index === allColumns.length - 1}
                  aria-label={`Move ${col.label} right`}
                >
                  ↓
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </th>
  );
}
