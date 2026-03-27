/**
 * Shared transcript rendering utilities used by both the public letter
 * detail page and the admin reading view preview.
 */

import { classifyTranscriptLines, FORCE_CONTINUATION } from "./reflowClassifier";

/**
 * Smart reflow: join lines that were broken by the page margin into
 * flowing paragraphs for reading view.
 *
 * Uses classifyTranscriptLines() for line classification (shared with
 * the admin reflow gutter). Strips single-space reflow markers from
 * output so they don't leak into rendered text.
 *
 * Hyphenated word breaks ("un-" + "til") are rejoined automatically.
 */
export function reflowTranscript(text: string): string {
  const lines = text.split("\n");
  const classifications = classifyTranscriptLines(text);
  const result: string[] = [];

  for (let i = 0; i < classifications.length; i++) {
    const { classification } = classifications[i];
    const line = lines[i];

    if (classification === "blank") {
      result.push("");
      continue;
    }

    if (classification === "continuation") {
      const accumulated = result[result.length - 1];
      // Strip force-continuation marker (U+200B) before joining
      const lineContent = line.replace(FORCE_CONTINUATION, "").trim();
      // Hyphenated word break: "un-" + "til" → "until"
      if (/[a-zA-Z]-$/.test(accumulated) && /^[a-z]/.test(lineContent)) {
        result[result.length - 1] = accumulated.slice(0, -1) + lineContent;
      } else {
        result[result.length - 1] += " " + lineContent;
      }
    } else {
      // section-start or positioned: strip markers (single-space or U+200B)
      const clean = line.replace(FORCE_CONTINUATION, "");
      const leadingWS = clean.match(/^(\s*)/)?.[1].length ?? 0;
      const stripped = leadingWS === 1 ? clean.trimStart() : clean;
      result.push(stripped.trimEnd());
    }
  }

  return result.join("\n");
}

/**
 * Determine the "virtual page width" in characters — the max line length
 * in the original monospace text. Used to convert space-based positioning
 * (from the monospace admin editor) into percentage-based CSS indentation
 * that works with any font.
 */
export function computeReferenceWidth(text: string): number {
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return 78; // fallback to standard typewriter width
  return Math.max(...lines.map((l) => l.length));
}

/**
 * Render transcript text with proportional CSS-based positioning.
 *
 * Short positioned lines (dates, closings, signatures) preserve their
 * RIGHT-EDGE position from the monospace original using text-align: right
 * with proportional right padding. This matches the visual position in the
 * admin editor regardless of font.
 *
 * Paragraph text preserves its left-edge indent using text-indent.
 */
export function renderTranscriptLines(
  text: string,
  referenceWidth: number,
): JSX.Element[] {
  const lines = text.split("\n");
  const elements: JSX.Element[] = [];
  const MIN_SPACES = 3;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trim() === "") {
      elements.push(<div key={i} className="transcript-blank" />);
      continue;
    }

    const leadingSpaces = line.match(/^( *)/)?.[1].length ?? 0;

    if (leadingSpaces >= MIN_SPACES && referenceWidth > 0) {
      const content = line.trimStart();
      const contentLen = content.length;

      // Short positioned line (date, closing, signature):
      // content fills < 60% of the reference width → preserve RIGHT edge
      const isShortPositioned = contentLen < referenceWidth * 0.6;

      if (isShortPositioned) {
        // Preserve left-edge indent to match original spacing position
        const indentPct = Math.min(
          (leadingSpaces / referenceWidth) * 100,
          90,
        );
        elements.push(
          <div
            key={i}
            className="transcript-line transcript-line-positioned"
            style={{ paddingLeft: `${indentPct}%` }}
          >
            {content}
          </div>,
        );
      } else {
        // Paragraph text: preserve left-edge indent
        const indentPct = Math.min(
          (leadingSpaces / referenceWidth) * 100,
          90,
        );
        elements.push(
          <div
            key={i}
            className="transcript-line"
            style={{ textIndent: `${indentPct}%` }}
          >
            {content}
          </div>,
        );
      }
    } else {
      elements.push(
        <div key={i} className="transcript-line">
          {line}
        </div>,
      );
    }
  }

  return elements;
}
