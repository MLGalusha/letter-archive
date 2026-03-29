import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  saveCollectionsSort,
  loadCollectionsSort,
  saveJournalSort,
  loadJournalSort,
  saveSearchState,
  loadSearchState,
} from '../searchPersistence';

// Use a real storage map so we can verify values
let store: Record<string, string>;

beforeEach(() => {
  store = {};
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── Collections sort ─────────────────────────────────────────────────────────

describe('saveCollectionsSort / loadCollectionsSort', () => {
  it('round-trips field and order', () => {
    saveCollectionsSort('title', 'asc');
    const result = loadCollectionsSort();
    expect(result).toEqual({ field: 'title', order: 'asc' });
  });

  it('overwrites previous value', () => {
    saveCollectionsSort('title', 'asc');
    saveCollectionsSort('date', 'desc');
    expect(loadCollectionsSort()).toEqual({ field: 'date', order: 'desc' });
  });
});

// ── Journal sort ─────────────────────────────────────────────────────────────

describe('saveJournalSort / loadJournalSort', () => {
  it('round-trips field and order', () => {
    saveJournalSort('publishedAt', 'desc');
    const result = loadJournalSort();
    expect(result).toEqual({ field: 'publishedAt', order: 'desc' });
  });

  it('overwrites previous value', () => {
    saveJournalSort('title', 'asc');
    saveJournalSort('publishedAt', 'desc');
    expect(loadJournalSort()).toEqual({ field: 'publishedAt', order: 'desc' });
  });
});

// ── Load returns null when nothing saved ─────────────────────────────────────

describe('load functions with empty storage', () => {
  it('loadCollectionsSort returns null', () => {
    expect(loadCollectionsSort()).toBeNull();
  });

  it('loadJournalSort returns null', () => {
    expect(loadJournalSort()).toBeNull();
  });

  it('loadSearchState returns null', () => {
    expect(loadSearchState('letters')).toBeNull();
  });
});

// ── Invalid JSON handling ────────────────────────────────────────────────────

describe('graceful handling of invalid JSON', () => {
  it('loadCollectionsSort returns null for corrupt data', () => {
    store['archiveSort:collections'] = '{not valid json';
    expect(loadCollectionsSort()).toBeNull();
  });

  it('loadJournalSort returns null for corrupt data', () => {
    store['archiveSort:journal'] = 'broken!!!';
    expect(loadJournalSort()).toBeNull();
  });

  it('loadSearchState returns null for corrupt data', () => {
    store['archiveSearch:letters'] = '{{bad';
    expect(loadSearchState('letters')).toBeNull();
  });
});

// ── Search state round-trip ──────────────────────────────────────────────────

describe('saveSearchState / loadSearchState', () => {
  it('round-trips query and filters', () => {
    saveSearchState('letters', 'hello', {});
    const result = loadSearchState('letters');
    expect(result).toEqual({ query: 'hello', filters: {} });
  });

  it('stores per page key', () => {
    saveSearchState('letters', 'foo', {});
    saveSearchState('collections', 'bar', {});
    expect(loadSearchState('letters')!.query).toBe('foo');
    expect(loadSearchState('collections')!.query).toBe('bar');
  });
});

// ── localStorage errors ──────────────────────────────────────────────────────

describe('localStorage errors are swallowed', () => {
  it('saveCollectionsSort does not throw when setItem fails', () => {
    (localStorage.setItem as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => saveCollectionsSort('title', 'asc')).not.toThrow();
  });

  it('saveJournalSort does not throw when setItem fails', () => {
    (localStorage.setItem as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => saveJournalSort('date', 'desc')).not.toThrow();
  });

  it('saveSearchState does not throw when setItem fails', () => {
    (localStorage.setItem as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => saveSearchState('letters', 'q', {})).not.toThrow();
  });
});
