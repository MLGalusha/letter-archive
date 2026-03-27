/**
 * Classifies transcript lines for reflow — determines which lines are
 * margin continuations (should be combined in reading view) vs section
 * starts, blank lines, or positioned text.
 *
 * Used by both the public reading view (reflowTranscript) and the admin
 * reflow gutter visualization.
 *
 * Classification convention:
 *   - U+200B at start  = force continuation (admin override via gutter click)
 *   - 0 leading spaces = candidate for continuation (heuristic decides)
 *   - 1 leading space  = explicit "section start" marker
 *   - 3+ leading spaces = positioned text (dates, closings, centered text)
 *   - blank line = paragraph break
 */

/** Zero-width space used as an invisible "force continuation" marker */
export const FORCE_CONTINUATION = "\u200B";

export type LineClass = "continuation" | "section-start" | "blank" | "positioned";

export interface ClassifiedLine {
  /** Line index in the original text */
  index: number;
  /** How this line should be treated in reading view */
  classification: LineClass;
  /** Group index — lines in the same group get combined in reading view */
  groupIndex: number;
}

const MIN_POSITIONED_SPACES = 3;

/**
 * Classify each line of a transcript for reflow purposes.
 *
 * The classification logic mirrors the heuristics in reflowTranscript():
 *   1. Blank lines → "blank"
 *   2. Lines with 3+ leading spaces → "positioned"
 *   3. Lines with 1-2 leading spaces → "section-start" (explicit marker or indent)
 *   4. Lines with 0 leading spaces that meet continuation criteria → "continuation"
 *   5. Everything else → "section-start"
 *
 * Continuation criteria (line has 0 leading spaces AND):
 *   a. Previous line's trimmed content length >= margin threshold, OR
 *   b. For narrow-margin text (large handwriting): previous line doesn't end
 *      with terminal punctuation AND current line starts with lowercase
 */
export function classifyTranscriptLines(text: string): ClassifiedLine[] {
  const lines = text.split("\n");

  // Derive margin width: max trimmed-content length of body text lines
  const bodyLengths = lines
    .map((l) => l.trim().length)
    .filter((len) => len > 10);
  const maxBodyLen = bodyLengths.length > 0 ? Math.max(...bodyLengths) : 78;
  const MARGIN_THRESHOLD = Math.max(30, Math.round(maxBodyLen * 0.7));
  const isNarrowMargin = maxBodyLen < 40;

  const result: ClassifiedLine[] = [];
  let groupIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trim() === "") {
      result.push({ index: i, classification: "blank", groupIndex });
      groupIndex++;
      continue;
    }

    // Force-continuation marker (U+200B) — admin override via gutter click
    if (line.startsWith(FORCE_CONTINUATION)) {
      if (i > 0 && result.length > 0 && result[result.length - 1].classification !== "blank") {
        result.push({ index: i, classification: "continuation", groupIndex: result[result.length - 1].groupIndex });
      } else {
        // First line or after blank — can't continue from nothing
        result.push({ index: i, classification: "section-start", groupIndex });
        groupIndex++;
      }
      continue;
    }

    const leadingWS = line.match(/^(\s*)/)?.[1].length ?? 0;

    if (leadingWS >= MIN_POSITIONED_SPACES) {
      result.push({ index: i, classification: "positioned", groupIndex });
      groupIndex++;
      continue;
    }

    if (leadingWS > 0) {
      // 1-2 leading spaces = explicit section-start marker
      result.push({ index: i, classification: "section-start", groupIndex });
      groupIndex++;
      continue;
    }

    // leadingWS === 0 — check if this is a continuation
    const prev = i > 0 ? lines[i - 1] : "";
    const prevContent = prev.trim();
    const prevContentLen = prevContent.length;
    const lineContent = line.trim();

    const isContinuation =
      prevContentLen > 0 &&
      result.length > 0 &&
      result[result.length - 1].classification !== "blank" &&
      (
        prevContentLen >= MARGIN_THRESHOLD ||
        (
          isNarrowMargin &&
          !/[.!?:;—–]$/.test(prevContent) &&
          /^[a-z]/.test(lineContent)
        )
      );

    if (isContinuation) {
      // Same group as previous non-blank line
      result.push({ index: i, classification: "continuation", groupIndex: result[result.length - 1].groupIndex });
    } else {
      result.push({ index: i, classification: "section-start", groupIndex });
      groupIndex++;
    }
  }

  return result;
}
