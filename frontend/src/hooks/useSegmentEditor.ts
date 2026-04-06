import { useState, useCallback, useRef, useMemo } from 'react';
import type { LineSegment } from '../types/Letter';

export interface EditableSegment extends LineSegment {
  _id: string;
  excluded?: boolean;
  _deleted?: boolean;
}

interface UndoEntry {
  segments: EditableSegment[];
  selectedId: string | null;
}

let nextId = 0;
function makeId(): string {
  return `seg-${Date.now()}-${nextId++}`;
}

function toEditable(segments: LineSegment[]): EditableSegment[] {
  return segments.map((seg) => ({
    ...seg,
    _id: makeId(),
    excluded: seg.excluded ?? false,
    _deleted: false,
  }));
}

/** Strip client-only fields and return clean LineSegments for persistence. */
export function toLineSegments(segments: EditableSegment[]): LineSegment[] {
  return segments
    .filter((s) => !s._deleted)
    .map(({ _id, _deleted, ...rest }) => rest);
}

export interface UseSegmentEditorReturn {
  segmentEditMode: boolean;
  setSegmentEditMode: (v: boolean) => void;
  editedSegments: EditableSegment[];
  selectedSegmentId: string | null;
  selectSegment: (id: string | null) => void;
  resizeSegment: (id: string, newBbox: [number, number, number, number]) => void;
  deleteSegment: (id: string) => void;
  addSegment: (bbox: [number, number, number, number]) => void;
  toggleExcluded: (id: string) => void;
  isDirty: boolean;
  undo: () => void;
  canUndo: boolean;
  /** Resets editor state from fresh source segments (e.g. after save or page switch). */
  resetFromSource: (segments: LineSegment[]) => void;
  /** Returns cleaned segments ready for API persistence. */
  getSegmentsForSave: () => LineSegment[];
  /** Mark state as clean (after a successful save). */
  markClean: () => void;
}

export function useSegmentEditor(
  sourceSegments: LineSegment[],
): UseSegmentEditorReturn {
  const [segmentEditMode, setSegmentEditMode] = useState(false);
  const [editedSegments, setEditedSegments] = useState<EditableSegment[]>(() =>
    toEditable(sourceSegments),
  );
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  const undoStackRef = useRef<UndoEntry[]>([]);

  const pushUndo = useCallback((segments: EditableSegment[], selectedId: string | null) => {
    undoStackRef.current.push({ segments: segments.map((s) => ({ ...s })), selectedId });
    // Limit undo history
    if (undoStackRef.current.length > 50) {
      undoStackRef.current.shift();
    }
  }, []);

  const selectSegment = useCallback((id: string | null) => {
    setSelectedSegmentId(id);
  }, []);

  const resizeSegment = useCallback(
    (id: string, newBbox: [number, number, number, number]) => {
      setEditedSegments((prev) => {
        pushUndo(prev, selectedSegmentId);
        return prev.map((seg) => {
          if (seg._id !== id) return seg;
          // Recalculate baseline as horizontal midpoint
          const midY = (newBbox[1] + newBbox[3]) / 2;
          return {
            ...seg,
            bbox: newBbox,
            boundary: undefined, // clear polygon — falls back to bbox
            baseline: [[newBbox[0], midY], [newBbox[2], midY]],
          };
        });
      });
      setIsDirty(true);
    },
    [pushUndo, selectedSegmentId],
  );

  const deleteSegment = useCallback(
    (id: string) => {
      setEditedSegments((prev) => {
        pushUndo(prev, selectedSegmentId);
        return prev.map((seg) => (seg._id === id ? { ...seg, _deleted: true } : seg));
      });
      setSelectedSegmentId(null);
      setIsDirty(true);
    },
    [pushUndo, selectedSegmentId],
  );

  const addSegment = useCallback(
    (bbox: [number, number, number, number]) => {
      const midY = (bbox[1] + bbox[3]) / 2;
      const newSeg: EditableSegment = {
        _id: makeId(),
        line: -1, // user-created, no original line number
        baseline: [[bbox[0], midY], [bbox[2], midY]],
        bbox,
        ocrText: '',
        words: [],
        excluded: false,
        _deleted: false,
      };
      setEditedSegments((prev) => {
        pushUndo(prev, selectedSegmentId);
        return [...prev, newSeg];
      });
      setSelectedSegmentId(newSeg._id);
      setIsDirty(true);
    },
    [pushUndo, selectedSegmentId],
  );

  const toggleExcluded = useCallback(
    (id: string) => {
      setEditedSegments((prev) => {
        pushUndo(prev, selectedSegmentId);
        return prev.map((seg) =>
          seg._id === id ? { ...seg, excluded: !seg.excluded } : seg,
        );
      });
      setIsDirty(true);
    },
    [pushUndo, selectedSegmentId],
  );

  const undo = useCallback(() => {
    const entry = undoStackRef.current.pop();
    if (!entry) return;
    setEditedSegments(entry.segments);
    setSelectedSegmentId(entry.selectedId);
    // If undo stack is empty, we're back to clean state
    setIsDirty(undoStackRef.current.length > 0);
  }, []);

  const canUndo = undoStackRef.current.length > 0;

  const resetFromSource = useCallback((segments: LineSegment[]) => {
    setEditedSegments(toEditable(segments));
    setSelectedSegmentId(null);
    setIsDirty(false);
    undoStackRef.current = [];
  }, []);

  const getSegmentsForSave = useCallback(() => {
    return toLineSegments(editedSegments);
  }, [editedSegments]);

  const markClean = useCallback(() => {
    setIsDirty(false);
    undoStackRef.current = [];
  }, []);

  // Visible (non-deleted) segments for rendering
  const visibleSegments = useMemo(
    () => editedSegments.filter((s) => !s._deleted),
    [editedSegments],
  );

  return {
    segmentEditMode,
    setSegmentEditMode,
    editedSegments: visibleSegments,
    selectedSegmentId,
    selectSegment,
    resizeSegment,
    deleteSegment,
    addSegment,
    toggleExcluded,
    isDirty,
    undo,
    canUndo,
    resetFromSource,
    getSegmentsForSave,
    markClean,
  };
}
