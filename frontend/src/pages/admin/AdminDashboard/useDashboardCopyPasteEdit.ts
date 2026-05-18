import { useCallback, useEffect, useMemo, useState } from "react";
import type { MouseEvent } from "react";
import { bulkUpdateFields } from "../../../api/admin";
import { useToast } from "../../../contexts/ToastContext";
import type { PendingChange } from "./types";
import type { RowSelectionToggleOptions } from "./useDashboardRowSelection";

type CopyPasteColumn = "sender" | "recipient";

interface SourceCell {
  letterId: string;
  column: CopyPasteColumn;
}

interface UseDashboardCopyPasteEditOptions {
  selectedIds: Set<string>;
  clearSelection: () => void;
  handleCheckboxChange: (letterId: string, index: number, options?: RowSelectionToggleOptions) => void;
  fetchLetters: () => Promise<void>;
}

export function useDashboardCopyPasteEdit({
  selectedIds,
  clearSelection,
  handleCheckboxChange,
  fetchLetters,
}: UseDashboardCopyPasteEditOptions) {
  const { showToast } = useToast();
  const [editToolbarOpen, setEditToolbarOpen] = useState(false);
  const [copyModeActive, setCopyModeActive] = useState(false);
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const [sourceCell, setSourceCell] = useState<SourceCell | null>(null);
  const [pendingChanges, setPendingChanges] = useState<Map<string, PendingChange>>(new Map());
  const [isSaving, setIsSaving] = useState(false);

  const editMode = useMemo(
    () => editToolbarOpen || copyModeActive || pendingChanges.size > 0,
    [copyModeActive, editToolbarOpen, pendingChanges.size],
  );

  useEffect(() => {
    if (selectedIds.size > 0 && !editToolbarOpen) {
      setEditToolbarOpen(true);
    }
  }, [selectedIds.size, editToolbarOpen]);

  const exitEditMode = useCallback(() => {
    clearSelection();
    setEditToolbarOpen(false);
    setPendingChanges(new Map());
    setCopyModeActive(false);
    setCopiedValue(null);
    setSourceCell(null);
  }, [clearSelection]);

  const closeEditToolbar = useCallback(() => {
    setEditToolbarOpen(false);
  }, []);

  const handleSaveChanges = useCallback(async () => {
    if (pendingChanges.size === 0) return;

    setIsSaving(true);
    try {
      const updates = Array.from(pendingChanges.entries()).map(([letterId, changes]) => ({
        letterId,
        ...changes,
      }));

      await bulkUpdateFields(updates);

      showToast(`Updated ${pendingChanges.size} letter${pendingChanges.size === 1 ? "" : "s"}`, "success");

      exitEditMode();

      await fetchLetters();
    } catch (err) {
      console.error("Failed to save changes:", err);
      showToast(err instanceof Error ? err.message : "Failed to save changes", "error");
    } finally {
      setIsSaving(false);
    }
  }, [exitEditMode, fetchLetters, pendingChanges, showToast]);

  const handleDone = useCallback(async () => {
    if (pendingChanges.size > 0) {
      await handleSaveChanges();
    } else {
      exitEditMode();
    }
  }, [exitEditMode, handleSaveChanges, pendingChanges.size]);

  const toggleCopyMode = useCallback(() => {
    setCopyModeActive((isActive) => !isActive);
    setCopiedValue(null);
    setSourceCell(null);
  }, []);

  const handleCellClick = useCallback((
    letterId: string,
    column: CopyPasteColumn,
    value: string | null,
    event: MouseEvent,
  ) => {
    if (!editMode || !copyModeActive) return;

    event.stopPropagation();

    const existingChange = pendingChanges.get(letterId);
    const hasPendingChangeForColumn = existingChange && existingChange[column] !== undefined;

    if (sourceCell === null) {
      setSourceCell({ letterId, column });
      setCopiedValue(value || "");
    } else if (sourceCell.letterId === letterId && sourceCell.column === column) {
      setSourceCell(null);
      setCopiedValue(null);
    } else if (hasPendingChangeForColumn) {
      setPendingChanges(prev => {
        const next = new Map(prev);
        const existing = next.get(letterId);
        if (existing) {
          const rest = { ...existing };
          delete rest[column];
          if (Object.keys(rest).length === 0) {
            next.delete(letterId);
          } else {
            next.set(letterId, rest as PendingChange);
          }
        }
        return next;
      });
    } else {
      setPendingChanges(prev => {
        const next = new Map(prev);
        const existing = next.get(letterId) || {};
        next.set(letterId, { ...existing, [column]: copiedValue || "" });
        return next;
      });
    }
  }, [copiedValue, copyModeActive, editMode, pendingChanges, sourceCell]);

  const handleEditModeRowClick = useCallback((
    letterId: string,
    index: number,
    event: MouseEvent,
  ) => {
    if (copyModeActive) return true;
    if (selectedIds.size > 0 || pendingChanges.size > 0) {
      handleCheckboxChange(letterId, index, { shiftKey: event.shiftKey });
      return true;
    }
    return false;
  }, [copyModeActive, handleCheckboxChange, pendingChanges.size, selectedIds.size]);

  return {
    editMode,
    copyModeActive,
    copiedValue,
    sourceCell,
    pendingChanges,
    isSaving,
    exitEditMode,
    closeEditToolbar,
    handleDone,
    toggleCopyMode,
    handleCellClick,
    handleEditModeRowClick,
  };
}
