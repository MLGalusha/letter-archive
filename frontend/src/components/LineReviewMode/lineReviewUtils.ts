import type { LineSegmentWord } from '../../types/Letter';

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
  words: LineSegmentWord[] | undefined,
  scaleFactor: number,
  fontSize: number,
): number {
  const fontBasedMin = fontSize + CSS_BORDER_PADDING * 2;

  if (!words || words.length === 0) {
    return Math.max(30, fontBasedMin);
  }

  let totalHeight = 0;
  for (const word of words) {
    totalHeight += word.bbox[3] - word.bbox[1];
  }

  const avgWordHeight = totalHeight / words.length;
  const scaled = avgWordHeight * scaleFactor + CSS_BORDER_PADDING * 2;
  return Math.max(20, fontBasedMin, Math.min(80, scaled));
}

export function measureRenderedTextWidth(
  text: string,
  fontSize: number,
  wordSpacing = 0,
): number {
  const measureNode = document.createElement('span');
  measureNode.textContent = text;
  measureNode.style.position = 'absolute';
  measureNode.style.left = '-99999px';
  measureNode.style.top = '0';
  measureNode.style.visibility = 'hidden';
  measureNode.style.whiteSpace = 'pre';
  measureNode.style.margin = '0';
  measureNode.style.padding = '0';
  measureNode.style.border = '0';
  measureNode.style.lineHeight = '1';
  measureNode.style.fontFamily = FONT_FAMILY;
  measureNode.style.fontSize = `${fontSize}px`;
  measureNode.style.wordSpacing = `${wordSpacing}px`;
  measureNode.style.fontKerning = 'none';
  measureNode.style.fontVariantLigatures = 'none';

  document.body.appendChild(measureNode);
  const width = measureNode.getBoundingClientRect().width;
  measureNode.remove();

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
