import { prepareWithSegments, layoutWithLines } from '@chenglou/pretext';

export const PAGE_SEPARATOR_REGEX = /\n*---\s*Page\s*\d+\s*---\n*/i;
export const FONT_FAMILY = "Georgia, 'Times New Roman', serif";
export const CSS_BORDER_PADDING = 6;

export function splitTranscriptByPage(fullText: string, pageCount: number): string[] {
  if (pageCount <= 1) {
    return [fullText];
  }

  const parts = fullText.split(PAGE_SEPARATOR_REGEX);
  const pages: string[] = [];

  for (let index = 1; index < parts.length; index += 1) {
    pages.push(parts[index] || '');
  }

  while (pages.length < pageCount) {
    pages.push('');
  }

  return pages;
}

export function reconstructTranscript(pageTexts: string[]): string {
  if (pageTexts.length === 1) {
    return pageTexts[0];
  }

  return pageTexts
    .map((text, index) => `--- Page ${index + 1} ---\n\n${text}`)
    .join('\n\n');
}

export function computeLineInputHeight(
  lineBbox: [number, number, number, number] | undefined,
  scaleFactor: number,
  fontSize: number,
): number {
  const fontBasedMin = fontSize + CSS_BORDER_PADDING * 2;

  if (!lineBbox) {
    return Math.max(30, fontBasedMin);
  }

  const krakenHeight = (lineBbox[3] - lineBbox[1]) * scaleFactor + CSS_BORDER_PADDING * 2;
  return Math.max(20, fontBasedMin, Math.min(80, krakenHeight));
}

// Measurement cache: keyed by "text|fontSize" to avoid re-preparing the same text.
const measureCache = new Map<string, number>();
const MAX_CACHE = 500;

/**
 * Measures the rendered width of text using Pretext's canvas-based measurement.
 * Much faster than DOM-based measurement and avoids layout thrash.
 */
export function measureRenderedTextWidth(
  text: string,
  fontSize: number,
  wordSpacing = 0,
): number {
  const cacheKey = `${text}|${fontSize}|${wordSpacing}`;
  const cached = measureCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const fontString = `${fontSize}px ${FONT_FAMILY}`;
  const prepared = prepareWithSegments(text, fontString, {
    whiteSpace: 'pre',
  });
  const result = layoutWithLines(prepared, 1e6, fontSize);
  let width = result.lines[0]?.width ?? 0;

  // Adjust for word-spacing if specified
  if (wordSpacing !== 0 && width > 0) {
    const spaceCount = (text.match(/ /g) || []).length;
    width += spaceCount * wordSpacing;
  }

  // Maintain cache size
  if (measureCache.size >= MAX_CACHE) {
    const firstKey = measureCache.keys().next().value;
    if (firstKey !== undefined) measureCache.delete(firstKey);
  }
  measureCache.set(cacheKey, width);

  return width;
}

export function normalizeReviewLineText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function mergeEditedTextWithOriginalSpacing(
  originalText: string,
  normalizedEditedText: string,
): string {
  if (!normalizedEditedText) {
    return '';
  }

  const leadingWhitespace = originalText.match(/^\s*/)?.[0] ?? '';
  const trailingWhitespace = originalText.match(/\s*$/)?.[0] ?? '';
  const trimmedOriginal = originalText.trim();

  if (!trimmedOriginal) {
    return normalizedEditedText;
  }

  const originalTokens = trimmedOriginal.split(/\s+/).filter(Boolean);
  const newTokens = normalizedEditedText.split(' ').filter(Boolean);

  if (originalTokens.length === newTokens.length && newTokens.length > 0) {
    const chunks = trimmedOriginal.match(/\S+|\s+/g) ?? [];
    let tokenIndex = 0;

    const rebuilt = chunks
      .map((chunk) => {
        if (/^\s+$/.test(chunk)) {
          return chunk;
        }

        const replacement = newTokens[tokenIndex];
        tokenIndex += 1;
        return replacement ?? chunk;
      })
      .join('');

    if (tokenIndex === newTokens.length) {
      return `${leadingWhitespace}${rebuilt}${trailingWhitespace}`;
    }
  }

  return `${leadingWhitespace}${newTokens.join(' ')}${trailingWhitespace}`;
}
