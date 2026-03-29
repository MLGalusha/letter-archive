import type { ArchiveShelfItem } from '../types/Letter';
import type { SearchFilters } from '../components/SearchBar/SearchBar';

/**
 * Merge incoming archive items into an existing list, deduplicating by ID.
 */
export function mergeArchiveItems(
  current: ArchiveShelfItem[],
  incoming: ArchiveShelfItem[],
): ArchiveShelfItem[] {
  const seen = new Set(current.map((item) => item.id));
  const next = [...current];

  for (const item of incoming) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    next.push(item);
  }

  return next;
}

/**
 * Resolve the effective sort field for archive search.
 * When there's an active text query, defaults to "relevance";
 * otherwise uses the provided defaultSort.
 */
export function getResolvedArchiveSort(
  query: string,
  filters: SearchFilters,
  defaultSort: 'createdAt' | 'letterDate' = 'createdAt',
): string {
  const hasQuery = Boolean(query.trim());
  return filters.sort || (hasQuery ? 'relevance' : defaultSort);
}
