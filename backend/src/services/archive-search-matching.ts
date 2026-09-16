/** Ordinary search treats whitespace-separated input as literal terms, never operators. */
export function archiveSearchTerms(value: string): string[] {
  return [...new Set(value.trim().toLowerCase().split(/\s+/u).filter(Boolean))];
}

export const ARCHIVE_TYPO_SIMILARITY = 0.6;

export function canFuzzyMatchArchiveTerm(term: string): boolean {
  return [...term].length >= 4 && /^\p{L}+$/u.test(term);
}

/** pg_trgm similarity for a single alphanumeric word: distinct padded trigram sets. */
export function archiveWordSimilarity(left: string, right: string): number {
  const trigrams = (word: string) => {
    const chars = [...`  ${word.toLowerCase()} `];
    return new Set(chars.slice(0, -2).map((_, i) => chars.slice(i, i + 3).join('')));
  };
  const a = trigrams(left);
  const b = trigrams(right);
  const shared = [...a].filter((value) => b.has(value)).length;
  return shared / (a.size + b.size - shared);
}

export function archiveTermRanges(value: string, term: string, allowFuzzy: boolean) {
  if (!term) return [];
  const lowered = value.toLowerCase();
  // Lowercasing can expand a character (İ -> i + combining dot). Keep ranges
  // in the original UTF-16 coordinates consumed by the UI.
  const offsets: Array<{ start: number; end: number }> = [];
  let offset = 0;
  for (const character of value) {
    for (let i = 0; i < character.toLowerCase().length; i++) {
      offsets.push({ start: offset, end: offset + character.length });
    }
    offset += character.length;
  }
  const ranges: Array<{ start: number; end: number }> = [];
  for (let start = lowered.indexOf(term); start !== -1; start = lowered.indexOf(term, start + term.length)) {
    ranges.push({ start: offsets[start]!.start, end: offsets[start + term.length - 1]!.end });
  }
  // A literal occurrence always explains the term before approximate names/places.
  if (ranges.length || !allowFuzzy || !canFuzzyMatchArchiveTerm(term)) return ranges;
  for (const token of value.matchAll(/[\p{L}\p{N}]+/gu)) {
    if (archiveWordSimilarity(token[0], term) >= ARCHIVE_TYPO_SIMILARITY) {
      ranges.push({ start: token.index, end: token.index + token[0].length });
    }
  }
  return ranges;
}
