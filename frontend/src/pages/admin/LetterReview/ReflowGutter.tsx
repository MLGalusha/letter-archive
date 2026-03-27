import { useMemo, useEffect, useState, useCallback, type RefObject } from "react";
import { classifyTranscriptLines, type LineClass } from "../../../utils/reflowClassifier";

const PAGE_SEP_RE = /^---\s*Page\s+\d+\s*---$/;

interface ReflowGutterProps {
  transcript: string;
  editorRef: RefObject<HTMLDivElement | null>;
  onToggleLine?: (lineIndex: number, action: "combine" | "separate") => void;
  /** Blank line indices to show as red "pending delete" indicators */
  pendingDeleteBlanks?: Set<number>;
  /** Called when a red blank indicator is clicked to confirm deletion */
  onConfirmBlankDelete?: () => void;
}

/**
 * Narrow interactive gutter alongside the transcript editor showing
 * which lines will be combined in reading view.
 *
 * - Click a continuation bar (blue) → separate it
 * - Click a section-start (orange/green) → combine with line above
 *   - If blank lines are in the way, they turn red first
 *   - Click a red blank to remove it and complete the combine
 */
export default function ReflowGutter({
  transcript,
  editorRef,
  onToggleLine,
  pendingDeleteBlanks,
  onConfirmBlankDelete,
}: ReflowGutterProps) {
  const { classifications, lines } = useMemo(() => ({
    classifications: classifyTranscriptLines(transcript),
    lines: transcript.split("\n"),
  }), [transcript]);

  const [metrics, setMetrics] = useState({ lineHeight: 28, paddingTop: 24 });

  const measure = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const style = getComputedStyle(el);
    const fontSize = parseFloat(style.fontSize) || 16;
    const lh = parseFloat(style.lineHeight);
    const lineHeight = !lh || isNaN(lh) ? fontSize * 1.75 : lh > 10 ? lh : fontSize * lh;
    const paddingTop = parseFloat(style.paddingTop) || 0;
    setMetrics((prev) => {
      if (prev.lineHeight === lineHeight && prev.paddingTop === paddingTop) return prev;
      return { lineHeight, paddingTop };
    });
  }, [editorRef]);

  useEffect(() => {
    measure();
    const el = editorRef.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [editorRef, measure]);

  const { lineHeight, paddingTop } = metrics;

  const hasPending = !!pendingDeleteBlanks;

  return (
    <div className={`reflow-gutter${hasPending ? " gutter-pending" : ""}`} style={{ paddingTop }}>
      {classifications.map((cl, i) => {
        const cls = cl.classification;
        const lineText = i < lines.length ? lines[i] : "";
        const isPageSep = PAGE_SEP_RE.test(lineText.trim());

        if (isPageSep) {
          return <div key={i} className="reflow-indicator reflow-indicator--blank" style={{ height: lineHeight }} />;
        }

        // Check if this blank line is pending deletion (red indicator)
        if (cls === "blank" && pendingDeleteBlanks?.has(i)) {
          return (
            <div
              key={i}
              className="reflow-indicator reflow-indicator--pending-delete clickable"
              style={{ height: lineHeight }}
              title="Click to remove this blank line and combine"
              onClick={(e) => {
                e.stopPropagation();
                onConfirmBlankDelete?.();
              }}
            />
          );
        }

        const nextCls = i + 1 < classifications.length ? classifications[i + 1].classification : null;
        const role = getLineRole(cls, nextCls);

        // Determine if this line can be combined upward
        let canCombineUp = false;
        if (i > 0) {
          let above = i - 1;
          while (above >= 0 && (lines[above].trim() === "" || PAGE_SEP_RE.test(lines[above].trim()))) above--;
          canCombineUp = above >= 0;
        }

        // Green lines (group-start) that can't combine up can still break their group.
        // Positioned lines (3+ spaces) are also clickable — the heuristic may be wrong
        // (e.g. indented paragraph start vs actual date/closing) and the admin can override.
        const isGroupStart = role === "group-start";
        const clickable = onToggleLine && (
          cls === "continuation" ||
          ((cls === "section-start" || cls === "positioned") && canCombineUp) ||
          (isGroupStart && !canCombineUp && nextCls === "continuation")
        );

        const title = !clickable ? undefined
          : cls === "continuation" ? "Click to separate this line"
          : canCombineUp ? "Click to combine with line above"
          : "Click to separate this group";

        return (
          <div
            key={i}
            className={`reflow-indicator reflow-indicator--${role}${clickable ? " clickable" : ""}`}
            style={{ height: lineHeight }}
            title={title}
            onClick={clickable ? (e) => {
              e.stopPropagation();
              if (cls === "continuation") {
                onToggleLine!(cl.index, "separate");
              } else if (canCombineUp) {
                onToggleLine!(cl.index, "combine");
              } else {
                // Break group: separate the next continuation line
                onToggleLine!(cl.index + 1, "separate");
              }
            } : undefined}
          />
        );
      })}
    </div>
  );
}

/** Determine the visual role of a line for the gutter color */
function getLineRole(cls: LineClass, nextCls: LineClass | null): string {
  if (cls === "blank") return "blank";
  if (cls === "continuation") return "combined";       // blue — combines into previous
  if (nextCls === "continuation") return "group-start"; // green — starts a combined group
  return "standalone";                                  // orange — doesn't combine
}
