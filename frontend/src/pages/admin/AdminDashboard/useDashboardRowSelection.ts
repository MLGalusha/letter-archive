import { useCallback, useEffect, useState, type Dispatch, type MouseEvent, type SetStateAction } from "react";

interface IdentifiableRow {
  id: string;
}

type DragMode = "select" | "deselect";

export interface RowSelectionToggleOptions {
  shiftKey?: boolean;
}

interface UseDashboardRowSelectionOptions<T extends IdentifiableRow> {
  rows: T[];
  selectedIds: Set<string>;
  setSelectedIds: Dispatch<SetStateAction<Set<string>>>;
  setAllFilteredSelected: (value: boolean) => void;
  toggleSelection: (id: string) => void;
}

export function useDashboardRowSelection<T extends IdentifiableRow>({
  rows,
  selectedIds,
  setSelectedIds,
  setAllFilteredSelected,
  toggleSelection,
}: UseDashboardRowSelectionOptions<T>) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartIndex, setDragStartIndex] = useState<number | null>(null);
  const [dragMode, setDragMode] = useState<DragMode | null>(null);
  const [draggedIds, setDraggedIds] = useState<Set<string>>(new Set());
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null);
  const [hasDragMoved, setHasDragMoved] = useState(false);

  const handleCheckboxChange = useCallback((letterId: string, index: number, options?: RowSelectionToggleOptions) => {
    if (options?.shiftKey && lastClickedIndex !== null) {
      const start = Math.min(lastClickedIndex, index);
      const end = Math.max(lastClickedIndex, index);
      const nextSelected = new Set(selectedIds);

      for (let i = start; i <= end; i += 1) {
        nextSelected.add(rows[i].id);
      }

      setSelectedIds(nextSelected);
      setAllFilteredSelected(false);
    } else {
      toggleSelection(letterId);
    }

    setLastClickedIndex(index);
  }, [
    lastClickedIndex,
    rows,
    selectedIds,
    setAllFilteredSelected,
    setSelectedIds,
    toggleSelection,
  ]);

  const handleRowMouseDown = useCallback((index: number, event: MouseEvent) => {
    if (event.button !== 0) return;
    const tagName = (event.target as HTMLElement).tagName;
    if (tagName === "INPUT" || tagName === "BUTTON") return;

    const letterId = rows[index].id;
    const mode: DragMode = selectedIds.has(letterId) ? "deselect" : "select";

    setIsDragging(true);
    setDragStartIndex(index);
    setDragMode(mode);
    setDraggedIds(new Set([letterId]));
    setHasDragMoved(false);
    event.preventDefault();
  }, [rows, selectedIds]);

  const handleRowMouseEnter = useCallback((index: number) => {
    if (!isDragging || dragStartIndex === null || dragMode === null) return;

    if (!hasDragMoved) {
      setHasDragMoved(true);
    }

    const start = Math.min(dragStartIndex, index);
    const end = Math.max(dragStartIndex, index);

    const rangeIds = new Set<string>();
    for (let i = start; i <= end; i += 1) {
      rangeIds.add(rows[i].id);
    }

    const nextSelected = new Set(selectedIds);

    draggedIds.forEach((id) => {
      if (!rangeIds.has(id)) {
        if (dragMode === "select") {
          nextSelected.delete(id);
        } else {
          nextSelected.add(id);
        }
      }
    });

    rangeIds.forEach((id) => {
      if (dragMode === "select") {
        nextSelected.add(id);
      } else {
        nextSelected.delete(id);
      }
    });

    setDraggedIds(rangeIds);
    setSelectedIds(nextSelected);
    setAllFilteredSelected(false);
  }, [
    dragMode,
    dragStartIndex,
    draggedIds,
    hasDragMoved,
    isDragging,
    rows,
    selectedIds,
    setAllFilteredSelected,
    setSelectedIds,
  ]);

  const handleMouseUp = useCallback(() => {
    if (isDragging) {
      setIsDragging(false);
      setDragStartIndex(null);
      setDragMode(null);
      setDraggedIds(new Set());
    }
  }, [isDragging]);

  useEffect(() => {
    document.addEventListener("mouseup", handleMouseUp);
    return () => document.removeEventListener("mouseup", handleMouseUp);
  }, [handleMouseUp]);

  return {
    hasDragMoved,
    handleCheckboxChange,
    handleRowMouseDown,
    handleRowMouseEnter,
  };
}
