import { useCallback, useEffect, useMemo, useState } from "react";
import type { MouseEvent } from "react";
import { bulkUpdateFields } from "../../../api/admin";
import { useToast } from "../../../contexts/ToastContext";
import type { PendingChange } from "./types";
import type { RowSelectionToggleOptions } from "./useDashboardRowSelection";
import type { DashboardSelectionIntent } from "./useDashboardSelection";

type CopyPasteColumn = "sender" | "recipient";

interface SourceCell {
  letterId: string;
  column: CopyPasteColumn;
}

interface UseDashboardCopyPasteEditOptions {
  selectedIds: Set<string>;
  clearSelection: () => void;
  makeSelectionExplicit: () => DashboardSelectionIntent;
  isSelectionIntentCurrent: (
    expectedIntent: DashboardSelectionIntent,
  ) => boolean;
  handleCheckboxChange: (letterId: string, index: number, options?: RowSelectionToggleOptions) => void;
  fetchLetters: () => Promise<void>;
}

export function useDashboardCopyPasteEdit({
  selectedIds,
  clearSelection,
  makeSelectionExplicit,
  isSelectionIntentCurrent,
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

  const exitEditMode = useCallback((
    expectedIntent?: DashboardSelectionIntent,
  ) => {
    if (
      expectedIntent
      && !isSelectionIntentCurrent(expectedIntent)
    ) {
      return;
    }
    clearSelection();
    setEditToolbarOpen(false);
    setPendingChanges(new Map());
    setCopyModeActive(false);
    setCopiedValue(null);
    setSourceCell(null);
  }, [clearSelection, isSelectionIntentCurrent]);

  const closeEditToolbar = useCallback(() => {
    setEditToolbarOpen(false);
  }, []);

  const handleSaveChanges = useCallback(async () => {
    if (pendingChanges.size === 0) return;

    const mutationIntent = makeSelectionExplicit();
    setIsSaving(true);
    try {
      const updates = Array.from(pendingChanges.entries()).map(([letterId, changes]) => ({
        letterId,
        ...changes,
      }));

      const result = await bulkUpdateFields(updates);
      const skippedIds = new Set(
        result.skipReasons.map(({ letterId }) => letterId),
      );
      if (result.skipped === 0) {
        showToast(
          `Updated ${result.updated} letter${result.updated === 1 ? "" : "s"}`,
          "success",
        );
        exitEditMode(mutationIntent);
      } else {
        if (isSelectionIntentCurrent(mutationIntent)) {
          setPendingChanges((previous) => new Map(
            Array.from(previous).filter(([letterId]) => skippedIds.has(letterId)),
          ));
        }
        const sourceChanged = result.skipReasons.filter(
          ({ code }) => code === "SOURCE_CHANGED",
        ).length;
        const missing = result.skipReasons.filter(
          ({ code }) => code === "NOT_FOUND",
        ).length;
        const conflictedOrFailed = result.skipped - sourceChanged - missing;
        const reasons = [
          sourceChanged > 0
            ? `${sourceChanged} source ${sourceChanged === 1 ? "changed" : "versions changed"}`
            : null,
          missing > 0 ? `${missing} no longer ${missing === 1 ? "exists" : "exist"}` : null,
          conflictedOrFailed > 0
            ? `${conflictedOrFailed} had newer edits or failed`
            : null,
        ].filter((reason): reason is string => reason !== null);
        showToast(
          `Updated ${result.updated}; kept ${result.skipped} unsaved (${reasons.join(", ")})`,
          result.applied > 0 ? "info" : "error",
        );
      }
    } catch (err) {
      console.error("Failed to save changes:", err);
      showToast(err instanceof Error ? err.message : "Failed to save changes", "error");
    } finally {
      try {
        await fetchLetters();
      } catch (err) {
        console.error("Failed to refresh letters after saving changes:", err);
      }
      setIsSaving(false);
    }
  }, [
    exitEditMode,
    fetchLetters,
    isSelectionIntentCurrent,
    makeSelectionExplicit,
    pendingChanges,
    showToast,
  ]);

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
    primarySourceRevision: number,
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
      makeSelectionExplicit();
      setPendingChanges(prev => {
        const next = new Map(prev);
        const existing = next.get(letterId);
        if (existing) {
          const rest = { ...existing };
          delete rest[column];
          if (rest.sender === undefined && rest.recipient === undefined) {
            next.delete(letterId);
          } else {
            next.set(letterId, rest);
          }
        }
        return next;
      });
    } else {
      makeSelectionExplicit();
      setPendingChanges(prev => {
        const next = new Map(prev);
        const existing = next.get(letterId);
        next.set(letterId, {
          primarySourceRevision:
            existing?.primarySourceRevision ?? primarySourceRevision,
          ...existing,
          [column]: copiedValue || "",
        });
        return next;
      });
    }
  }, [
    copiedValue,
    copyModeActive,
    editMode,
    makeSelectionExplicit,
    pendingChanges,
    sourceCell,
  ]);

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
