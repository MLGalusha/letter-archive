import { formatLetterDate, generateTitle, mapTypeToImageType } from '../dto/index.js';
import type { ArchiveSearchQuery } from '../schemas/letter.js';
import { archiveTermRanges, canFuzzyMatchArchiveTerm } from './archive-search-matching.js';
import { MEDIA_COUNT_LABELS, toIsoDateString, type ArchiveSearchHighlightRange, type ArchiveSearchPreview, type ArchiveSearchRow } from './archive-search-shared.js';
import { getArchiveTypedSearchFields } from './archive-search-query.js';

export function transformArchiveSearchRow(row: ArchiveSearchRow, query: ArchiveSearchQuery) {
  const primaryImageType = mapTypeToImageType(row.primaryType);
  const [singular, plural] = MEDIA_COUNT_LABELS[primaryImageType];
  const formattedDate = formatLetterDate({ dateRaw: row.dateRaw } as never) || row.dateRaw;
  const pseudoLetter = {
    type: row.primaryType,
    sender: row.sender,
    recipient: row.recipient,
    dateRaw: row.dateRaw,
  };
  const pseudoCollection = {
    title: row.collectionTitle,
    collectionCode: row.collectionCode,
  };

  return {
    id: row.id,
    title: generateTitle(pseudoLetter as never, pseudoCollection as never),
    imageUrl: row.pageId
      ? `/images/${row.pageId}${row.checksumSha256 ? `?v=${row.checksumSha256.slice(0, 8)}` : ''}`
      : undefined,
    imageType: primaryImageType,
    primaryChip: row.primaryPageCount > 0
      ? `${row.primaryPageCount} ${row.primaryPageCount === 1 ? singular : plural}`
      : undefined,
    sender: row.sender || undefined,
    recipient: row.recipient || undefined,
    collectionCode: row.collectionCode,
    createdAt: toIsoDateString(row.createdAt),
    date: formattedDate,
    dateRaw: row.dateRaw,
    hook: row.hook || row.photoDescriptions?.[0] || undefined,
    location: row.location || undefined,
    verified: row.metadataVerified,
    searchPreview: buildArchiveSearchPreview(row, query, formattedDate),
  };
}

function buildArchiveSearchPreview(
  row: ArchiveSearchRow,
  query: ArchiveSearchQuery,
  formattedDate: string,
): ArchiveSearchPreview | undefined {
  const search = query.search?.trim();
  if (!search) return undefined;

  const normalizedSearch = row.normalizedSearch ?? search.toLowerCase();
  // Keep original/folded term positions aligned, including case variants and
  // repeats; deduplicating either side alone can change fuzzy eligibility.
  const searchTerms = query.exact ? [normalizedSearch] : normalizedSearch.trim().split(/\s+/u);
  for (const field of getArchiveTypedSearchFields()) {
    const candidates = [...new Set(field.values(row, formattedDate))]
      .map((original) => {
        const folded = row.searchCaseMap && Object.hasOwn(row.searchCaseMap, original)
          ? row.searchCaseMap[original] : original.toLowerCase();
        return scoreArchivePreviewValue(prepareArchivePreviewText(original, query.exact), search, searchTerms, field.fuzzy && !query.exact,
          prepareArchivePreviewText(folded, query.exact),
          field.fuzzy && row.searchWordMap && Object.hasOwn(row.searchWordMap, original) ? row.searchWordMap[original] : undefined,
          row.searchWordMap, query.exact);
      })
      .filter((candidate): candidate is ArchivePreviewCandidate => candidate !== null)
      .sort((left, right) => right.score - left.score || right.totalMatches - left.totalMatches
        || left.excerpt.localeCompare(right.excerpt));
    const best = candidates[0];
    if (best) {
      return {
        excerpt: best.excerpt,
        highlightRanges: best.highlightRanges,
        // Count the selected source text, not other fields or alternate date forms.
        matchCount: Math.max(best.totalMatches, best.highlightRanges.length, 1),
        matchedFieldLabel: field.label,
      };
    }
  }
  return undefined;
}

type ArchivePreviewCandidate = {
  excerpt: string;
  highlightRanges: ArchiveSearchHighlightRange[];
  score: number;
  totalMatches: number;
};


function collapseArchiveWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function prepareArchivePreviewText(value: string, preserveWhitespace = false) {
  const withoutPageMarkers = value.replace(/---[ \t\r\n\f\v]*Page[ \t\r\n\f\v]+[0-9]+[ \t\r\n\f\v]*---/gi, ' ');
  return preserveWhitespace ? withoutPageMarkers.trim() : collapseArchiveWhitespace(withoutPageMarkers);
}

function scoreArchivePreviewValue(
  value: string,
  rawSearch: string,
  searchTerms: string[],
  allowFuzzy: boolean,
  foldedValue: string,
  sourceWords?: string[],
  wordMap?: Record<string, string[]> | null,
  exact = false,
): ArchivePreviewCandidate | null {
  const originalTerms = rawSearch.trim().split(/\s+/u);
  // Deduplicate only after pairing: differently typed terms can fold identically
  // while one remains literal-only. Repeats should not rescan long transcripts.
  const terms = new Map<string, { term: string; originalTerm: string }>();
  searchTerms.forEach((term, index) => {
    const originalTerm = originalTerms[index]!;
    terms.set(JSON.stringify([term, canFuzzyMatchArchiveTerm(originalTerm)]), { term, originalTerm });
  });
  const termRanges = [...terms.values()].map(({ term, originalTerm }) => archiveTermRanges(value, term, allowFuzzy, foldedValue, originalTerm,
    sourceWords && wordMap && Object.hasOwn(wordMap, originalTerm) ? { source: sourceWords, term: wordMap[originalTerm]! } : undefined));
  if (termRanges.some((ranges) => ranges.length === 0)) return null;
  // Preserve one complete phrase before adjacent highlights are merged. A run
  // of repeated phrases must not expand the excerpt to the entire transcript.
  const exactMatch = exact && termRanges[0]?.[0] ? { ...termRanges[0][0] } : undefined;
  const ranges = mergeArchiveHighlightRanges(termRanges.flat());
  if (!ranges.length) return null;
  const excerpt = buildArchiveExcerptWithHighlights(value, ranges, exactMatch);
  return {
    ...excerpt,
    totalMatches: ranges.length,
    score: (value.toLowerCase().includes(rawSearch.trim().toLowerCase()) ? 100 : 0) + ranges.length,
  };
}

function mergeArchiveHighlightRanges(ranges: ArchiveSearchHighlightRange[]) {
  if (ranges.length === 0) return [];

  const sortedRanges = [...ranges].sort((left, right) => left.start - right.start || left.end - right.end);
  const mergedRanges: ArchiveSearchHighlightRange[] = [sortedRanges[0]];

  for (let index = 1; index < sortedRanges.length; index += 1) {
    const currentRange = sortedRanges[index];
    const previousRange = mergedRanges[mergedRanges.length - 1];

    if (currentRange.start <= previousRange.end) {
      previousRange.end = Math.max(previousRange.end, currentRange.end);
      continue;
    }

    mergedRanges.push({ ...currentRange });
  }

  return mergedRanges;
}

function buildArchiveExcerptWithHighlights(
  value: string,
  ranges: ArchiveSearchHighlightRange[],
  exactMatch?: ArchiveSearchHighlightRange,
) {
  const maxLength = 108;
  const preferredLead = 18;
  const firstRange = ranges[0];
  const shouldWindowExcerpt =
    value.length > maxLength ||
    (firstRange && firstRange.start > preferredLead + 20);

  if (!shouldWindowExcerpt) {
    return {
      excerpt: value,
      highlightRanges: ranges,
    };
  }

  const window = exactMatch && exactMatch.end - exactMatch.start > maxLength - preferredLead
    ? chooseCompleteArchiveMatchWindow(value, exactMatch, preferredLead)
    : chooseArchiveExcerptWindow(value, ranges, maxLength, preferredLead);
  const excerptSource = value.slice(window.start, window.end);
  const leadingTrim = excerptSource.length - excerptSource.trimStart().length;
  const trailingTrim = excerptSource.length - excerptSource.trimEnd().length;
  const trimmedStart = window.start + leadingTrim;
  const trimmedEnd = window.end - trailingTrim;
  const excerptBody = value.slice(trimmedStart, trimmedEnd);
  const prefix = trimmedStart > 0 ? '…' : '';
  const suffix = trimmedEnd < value.length ? '…' : '';

  return {
    excerpt: `${prefix}${excerptBody}${suffix}`,
    highlightRanges: ranges
      .filter((range) => range.end > trimmedStart && range.start < trimmedEnd)
      .map((range) => ({
        start: Math.max(range.start, trimmedStart) - trimmedStart + prefix.length,
        end: Math.min(range.end, trimmedEnd) - trimmedStart + prefix.length,
      })),
  };
}

// Exact queries are capped at 200 characters by request validation. Keep the
// mapped original match plus bounded context; trim partial context words inward
// instead of expanding into an arbitrarily long word or repeated match run.
function chooseCompleteArchiveMatchWindow(
  value: string,
  match: ArchiveSearchHighlightRange,
  contextLength: number,
) {
  let start = Math.max(0, match.start - contextLength);
  let end = Math.min(value.length, match.end + contextLength);
  while (start > 0 && start < match.start && !/\s/u.test(value[start - 1]!)) start += 1;
  while (end < value.length && end > match.end && !/\s/u.test(value[end]!)) end -= 1;
  return { start, end };
}

function chooseArchiveExcerptWindow(
  value: string,
  ranges: ArchiveSearchHighlightRange[],
  maxLength: number,
  preferredLead: number,
) {
  let bestWindow = {
    start: 0,
    end: Math.min(value.length, maxLength),
    score: -1,
  };

  for (const range of ranges) {
    let start = Math.max(0, range.start - preferredLead);
    let end = Math.min(value.length, start + maxLength);

    while (start > 0 && value[start - 1] !== ' ') {
      start -= 1;
    }

    while (end < value.length && value[end] !== ' ') {
      end += 1;
    }

    const overlappingRanges = ranges.filter((candidate) => candidate.end > start && candidate.start < end);
    const overlapCount = overlappingRanges.length;
    const overlapChars = overlappingRanges.reduce(
      (sum, candidate) => sum + Math.min(candidate.end, end) - Math.max(candidate.start, start),
      0,
    );
    const firstVisibleMatchOffset = overlapCount > 0
      ? overlappingRanges[0]!.start - start
      : maxLength;
    const distanceFromPreferredLead = Math.abs(firstVisibleMatchOffset - preferredLead);
    const windowScore =
      overlapCount * 1000 +
      overlapChars * 25 -
      distanceFromPreferredLead * 4 -
      start * 0.05;

    if (windowScore > bestWindow.score) {
      bestWindow = { start, end, score: windowScore };
    }
  }

  return bestWindow;
}

