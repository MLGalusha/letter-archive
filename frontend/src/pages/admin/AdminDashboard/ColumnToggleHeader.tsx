import { useState } from "react";
import type { DragEvent, KeyboardEvent, RefObject } from "react";
import { Icon } from "../../../components/common/Icon";
import type { ColumnDef, ColumnId } from "./types";

interface ColumnToggleHeaderProps {
  orderedColumns: ColumnDef[];
  visibleColumns: Set<ColumnId>;
  showColumnMenu: boolean;
  onToggleColumnMenu: () => void;
  onToggleColumn: (id: ColumnId) => void;
  onMoveColumn: (id: ColumnId, direction: -1 | 1) => void;
  onReorderColumn: (id: ColumnId, targetIndex: number) => void;
  onResetColumnOrder: () => void;
  columnMenuRef: RefObject<HTMLTableCellElement | null>;
}

export default function ColumnToggleHeader({
  orderedColumns,
  visibleColumns,
  showColumnMenu,
  onToggleColumnMenu,
  onToggleColumn,
  onMoveColumn,
  onReorderColumn,
  onResetColumnOrder,
  columnMenuRef,
}: ColumnToggleHeaderProps) {
  const [draggedColumn, setDraggedColumn] = useState<ColumnId | null>(null);
  const [dropTargetColumn, setDropTargetColumn] = useState<ColumnId | null>(null);

  const handleDragStart = (event: DragEvent<HTMLButtonElement>, columnId: ColumnId) => {
    setDraggedColumn(columnId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", columnId);

    const row = event.currentTarget.closest(".column-toggle-item");
    if (row instanceof HTMLElement) {
      event.dataTransfer.setDragImage(row, 16, 16);
    }
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>, columnId: ColumnId) => {
    if (!draggedColumn || draggedColumn === columnId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTargetColumn(columnId);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>, targetColumn: ColumnId) => {
    event.preventDefault();
    const sourceColumn = (event.dataTransfer.getData("text/plain") || draggedColumn) as ColumnId | null;
    if (!sourceColumn || sourceColumn === targetColumn) return;

    const targetIndex = orderedColumns.findIndex((column) => column.id === targetColumn);
    if (targetIndex >= 0) {
      onReorderColumn(sourceColumn, targetIndex);
    }
    setDraggedColumn(null);
    setDropTargetColumn(null);
  };

  const handleDragEnd = () => {
    setDraggedColumn(null);
    setDropTargetColumn(null);
  };

  const handleReorderKeyDown = (event: KeyboardEvent<HTMLButtonElement>, column: ColumnDef) => {
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      onMoveColumn(column.id, -1);
    }
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      onMoveColumn(column.id, 1);
    }
  };

  return (
    <th className="checkbox-header" ref={columnMenuRef}>
      <button
        className={`column-toggle-btn ${showColumnMenu ? "active" : ""}`}
        onClick={onToggleColumnMenu}
        aria-label="Configure columns"
        aria-expanded={showColumnMenu}
        aria-haspopup="menu"
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
            <div
              key={col.id}
              className={`column-toggle-item ${draggedColumn === col.id ? "is-dragging" : ""} ${dropTargetColumn === col.id ? "is-drop-target" : ""}`}
              onDragOver={(event) => handleDragOver(event, col.id)}
              onDrop={(event) => handleDrop(event, col.id)}
              onDragEnd={handleDragEnd}
            >
              <button
                type="button"
                className="column-order-handle"
                draggable={orderedColumns.length > 1}
                onDragStart={(event) => handleDragStart(event, col.id)}
                onDragEnd={handleDragEnd}
                onKeyDown={(event) => handleReorderKeyDown(event, col)}
                aria-label={`Drag to reorder ${col.label}. Use arrow keys to move.`}
                title="Drag to reorder. Arrow keys also move this column."
                disabled={orderedColumns.length < 2 || (index === 0 && orderedColumns.length === 1)}
              >
                <Icon name="grip-vertical" size={15} />
              </button>
              <label>
                <input
                  type="checkbox"
                  checked={visibleColumns.has(col.id)}
                  onChange={() => onToggleColumn(col.id)}
                />
                <span>{col.label}</span>
              </label>
            </div>
          ))}
        </div>
      )}
    </th>
  );
}
