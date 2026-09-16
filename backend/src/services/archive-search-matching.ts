/** Ordinary search treats whitespace-separated input as literal terms, never operators. */
export function archiveSearchTerms(value: string): string[] {
  return [...new Set(value.trim().split(/\s+/u).filter(Boolean))];
}

export const ARCHIVE_TYPO_SIMILARITY = 0.6;
// Lowercase length changes add/remove combining marks on a base character.
// Match those groups in one pass; unrelated code points retain their own spans.
const caseGroups = (text: string) => Array.from(
  text.matchAll(/\P{M}\p{M}*|\p{M}+/gu),
  (match) => ({ index: match.index, length: match[0].length }),
);

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

export function archiveTermRanges(value: string, term: string, allowFuzzy: boolean, databaseFolded?: string) {
  if (!term) return [];
  const lowered = databaseFolded ?? value.toLowerCase();
  // Unicode lowercase can add/remove combining marks on a base character (ICU
  // English İ, Lithuanian accents, Turkish dotted I). Align base/mark groups instead
  // of individual code points, preserving original base/mark spans and UTF-16 offsets.
  // Both strings are scanned once; no prefix lowercasing or edit-distance grid.
  const original = caseGroups(value);
  const folded = caseGroups(lowered);
  // Lowercase preserves these groups. If a future provider applies
  // another transformation, omit highlights rather than invent offsets or throw.
  if (original.length !== folded.length) return [];
  const offsets: Array<{ start: number; end: number }> = [];
  for (let index = 0; index < original.length; index++) {
    const source = original[index]!;
    for (let i = 0; i < folded[index]!.length; i++) {
      offsets.push({ start: source.index, end: source.index + source.length });
    }
  }
  const ranges: Array<{ start: number; end: number }> = [];
  for (let start = lowered.indexOf(term); start !== -1; start = lowered.indexOf(term, start + term.length)) {
    ranges.push({ start: offsets[start]!.start, end: offsets[start + term.length - 1]!.end });
  }
  // A literal occurrence always explains the term before approximate names/places.
  if (ranges.length || !allowFuzzy || !canFuzzyMatchArchiveTerm(term)) return ranges;
  for (const token of lowered.matchAll(/[\p{L}\p{N}]+/gu)) {
    if (archiveWordSimilarity(token[0], term) >= ARCHIVE_TYPO_SIMILARITY) {
      ranges.push({ start: offsets[token.index]!.start, end: offsets[token.index + token[0].length - 1]!.end });
    }
  }
  return ranges;
}
