/**
 * Highlights transcript uncertainty markers with styled HTML spans.
 *
 * Markers from the AI transcription prompt:
 *   [illegible]                     — words that cannot be read at all
 *   [unclear: best guess]           — words partially made out
 *   [crossed out: text if readable] — crossed-out text
 *   [insertion: text]               — inserted text or marginal notes
 *   [margin: text]                  — marginal notes
 */

/** Marker types and their CSS class suffixes */
const MARKER_TYPES = [
  'illegible',
  'unclear',
  'crossed out',
  'insertion',
  'margin',
] as const;

export type MarkerType = (typeof MARKER_TYPES)[number];

export interface TranscriptMarker {
  type: MarkerType;
  fullMatch: string;
  detail?: string; // the text after the colon, e.g. "best guess" for [unclear: best guess]
  index: number;
}

/**
 * Regex that matches all bracket markers.
 * Captures: [type] or [type: detail]
 */
const MARKER_REGEX =
  /\[(illegible|unclear|crossed out|insertion|margin)(?::\s*([^\]]*))?\]/gi;

/**
 * Find all markers in a transcript string.
 */
export function findMarkers(text: string): TranscriptMarker[] {
  const markers: TranscriptMarker[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(MARKER_REGEX.source, MARKER_REGEX.flags);

  while ((match = re.exec(text)) !== null) {
    markers.push({
      type: match[1].toLowerCase() as MarkerType,
      fullMatch: match[0],
      detail: match[2] || undefined,
      index: match.index,
    });
  }

  return markers;
}

/**
 * CSS class for a marker type.
 */
function markerClass(type: MarkerType): string {
  return `transcript-marker transcript-marker--${type.replace(/\s+/g, '-')}`;
}

/**
 * Title tooltip for a marker.
 */
function markerTitle(type: MarkerType): string {
  switch (type) {
    case 'illegible':
      return 'Illegible — could not be read';
    case 'unclear':
      return 'Unclear — best guess shown';
    case 'crossed out':
      return 'Crossed out in original';
    case 'insertion':
      return 'Inserted text';
    case 'margin':
      return 'Marginal note';
  }
}

/**
 * Escape HTML special characters to prevent XSS in innerHTML.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Convert transcript text to HTML with highlighted markers.
 * Safe for use with innerHTML — all non-marker text is escaped.
 */
export function highlightTranscriptMarkers(text: string): string {
  if (!text) return '';

  const re = new RegExp(MARKER_REGEX.source, MARKER_REGEX.flags);
  let result = '';
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    // Append escaped plain text before this marker
    result += escapeHtml(text.slice(lastIndex, match.index));

    const type = match[1].toLowerCase() as MarkerType;
    const cls = markerClass(type);
    const title = markerTitle(type);
    const escaped = escapeHtml(match[0]);

    result += `<span class="${cls}" title="${title}">${escaped}</span>`;
    lastIndex = match.index + match[0].length;
  }

  // Append remaining text
  result += escapeHtml(text.slice(lastIndex));

  return result;
}

/**
 * Check if text contains any transcript markers.
 */
export function hasTranscriptMarkers(text: string): boolean {
  return MARKER_REGEX.test(text);
}

/**
 * Count markers by type.
 */
export function countMarkers(text: string): Record<MarkerType, number> {
  const counts: Record<MarkerType, number> = {
    illegible: 0,
    unclear: 0,
    'crossed out': 0,
    insertion: 0,
    margin: 0,
  };
  for (const marker of findMarkers(text)) {
    counts[marker.type]++;
  }
  return counts;
}
