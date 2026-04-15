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

export type ArchiveDefaultSort = 'relevance' | 'createdAt' | 'letterDate';

/**
 * Resolve the effective sort field for archive search.
 *
 * If the user has explicitly picked a sort it wins, otherwise the page's
 * defaultSort applies. We intentionally do NOT auto-switch based on query
 * presence — the user's choice (or the page default) sticks regardless of
 * whether they're searching, so their sort preference never silently flips
 * out from under them.
 */
export function getResolvedArchiveSort(
  filters: SearchFilters,
  defaultSort: ArchiveDefaultSort = 'relevance',
): string {
  return filters.sort || defaultSort;
}
