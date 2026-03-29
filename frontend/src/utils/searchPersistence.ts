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

export function loadCollectionsSort(): { field: string; order: string } | null {
  try {
    const raw = localStorage.getItem('archiveSort:collections');
    if (!raw) return null;
    return JSON.parse(raw);
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
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
