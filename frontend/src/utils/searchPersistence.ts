import type { SearchFilters } from '../components/SearchBar/SearchBar';

interface SavedSearchState {
  query: string;
  filters: SearchFilters;
}

const PREFIX = 'archiveSearch:';

function getKey(page: string): string {
  return `${PREFIX}${page}`;
}

export function saveSearchState(page: string, query: string, filters: SearchFilters): void {
  try {
    const state: SavedSearchState = { query, filters };
    localStorage.setItem(getKey(page), JSON.stringify(state));
  } catch {
    // localStorage full or unavailable
  }
}

export function loadSearchState(page: string): SavedSearchState | null {
  try {
    const raw = localStorage.getItem(getKey(page));
    if (!raw) return null;
    return JSON.parse(raw) as SavedSearchState;
  } catch {
    return null;
  }
}

export function saveCollectionsSort(field: string, order: string): void {
  try {
    localStorage.setItem('archiveSort:collections', JSON.stringify({ field, order }));
  } catch {
    // ignore
  }
}

const VALID_COLLECTION_SORT_FIELDS = ['letters', 'date', 'title'];
const VALID_JOURNAL_SORT_FIELDS = ['date', 'title', 'author', 'publishedAt'];
const VALID_SORT_ORDERS = ['asc', 'desc'];

export function loadCollectionsSort(): { field: string; order: string } | null {
  try {
    const raw = localStorage.getItem('archiveSort:collections');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!VALID_COLLECTION_SORT_FIELDS.includes(parsed.field) || !VALID_SORT_ORDERS.includes(parsed.order)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveJournalSort(field: string, order: string): void {
  try {
    localStorage.setItem('archiveSort:journal', JSON.stringify({ field, order }));
  } catch {
    // ignore
  }
}

export function loadJournalSort(): { field: string; order: string } | null {
  try {
    const raw = localStorage.getItem('archiveSort:journal');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!VALID_JOURNAL_SORT_FIELDS.includes(parsed.field) || !VALID_SORT_ORDERS.includes(parsed.order)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
