import { describe, expect, it } from 'vitest';
import {
  ARCHIVE_SEARCH_URL_KEYS,
  decodeArchiveSearchParams,
  encodeArchiveSearchParams,
  hasArchiveSearchParams,
  normalizeArchiveSearchState,
  type ArchiveSearchState,
} from '../archiveSearch';

describe('archive search URL ownership', () => {
  it('detects empty and malformed owned parameters by presence', () => {
    expect(hasArchiveSearchParams(new URLSearchParams('campaign=summer'))).toBe(false);
    expect(hasArchiveSearchParams(new URLSearchParams('q='))).toBe(true);
    expect(hasArchiveSearchParams(new URLSearchParams('year=not-a-year'))).toBe(true);
  });

  it('keeps the owned-key registry unique', () => {
    expect(new Set(ARCHIVE_SEARCH_URL_KEYS).size).toBe(ARCHIVE_SEARCH_URL_KEYS.length);
  });
});

describe('decodeArchiveSearchParams', () => {
  it('decodes every addressable field and accepts repeated or comma-delimited formats', () => {
    const params = new URLSearchParams();
    params.set('q', '  family letters  ');
    params.append('format', 'letter');
    params.append('format', 'photo,telegram');
    params.append('format', 'photo');
    params.set('collection', ' 009 ');
    params.set('sender', 'Mason');
    params.set('recipient', 'Ruth');
    params.set('place', 'Paris');
    params.set('topic', 'family,war');
    params.set('tone', 'hopeful,nostalgic');
    params.set('relationship', 'sibling,friend');
    params.set('year', '1944');
    params.set('yearFrom', '1940');
    params.set('yearTo', '1945');
    params.set('hasTranscript', 'false');
    params.set('verified', 'true');
    params.set('sort', 'sender');
    params.set('sortOrder', 'asc');

    expect(decodeArchiveSearchParams(params)).toEqual({
      query: 'family letters',
      filters: {
        format: ['letter', 'photo', 'telegram'],
        collection: '009',
        sender: 'Mason',
        recipient: 'Ruth',
        place: 'Paris',
        topic: ['family', 'war'],
        tone: ['hopeful', 'nostalgic'],
        relationship: ['sibling', 'friend'],
        year: 1944,
        dateRange: { start: 1940, end: 1945 },
        hasTranscript: false,
        verified: true,
        sort: 'sender',
        sortOrder: 'asc',
      },
    });
  });

  it('drops malformed values while retaining the configured effective defaults', () => {
    const params = new URLSearchParams();
    params.append('format', 'letter,bogus');
    params.append('format', 'unknown');
    params.set('topic', 'family,,');
    params.set('hasTranscript', 'yes');
    params.set('verified', '1');
    params.set('year', '0');
    params.set('yearFrom', 'nineteen-forty');
    params.set('yearTo', '10000');
    params.set('sort', 'newest');
    params.set('sortOrder', 'sideways');

    expect(decodeArchiveSearchParams(params, {
      defaultSort: 'letterDate',
      defaultSortOrder: 'asc',
    })).toEqual({
      query: '',
      filters: {
        format: ['letter'],
        collection: null,
        sender: null,
        recipient: null,
        place: null,
        topic: ['family'],
        tone: null,
        relationship: null,
        year: null,
        dateRange: undefined,
        hasTranscript: null,
        verified: null,
        sort: 'letterDate',
        sortOrder: 'asc',
      },
    });
  });
});

describe('normalizeArchiveSearchState', () => {
  it('normalizes hostile stored shapes and overlays normalized fixed filters', () => {
    const state = normalizeArchiveSearchState({
      query: { unexpected: true },
      filters: {
        format: 'letter',
        collection: ['009'],
        sender: 42,
        recipient: '  Ruth  ',
        topic: 'family',
        tone: ['hopeful', 42, '', 'hopeful'],
        relationship: null,
        year: '1944',
        dateRange: { start: 1940, end: '1945' },
        hasTranscript: 'false',
        verified: false,
        sort: 'sender',
        sortOrder: 'sideways',
      },
    }, {
      defaultSortOrder: 'desc',
      fixedFilters: {
        collection: ' 009 ',
        place: '  London ',
      },
    });

    expect(state).toEqual({
      query: '',
      filters: {
        format: null,
        collection: '009',
        sender: null,
        recipient: 'Ruth',
        place: 'London',
        topic: null,
        tone: ['hopeful'],
        relationship: null,
        year: null,
        dateRange: { start: 1940 },
        hasTranscript: null,
        verified: false,
        sort: 'sender',
        sortOrder: 'desc',
      },
    });
  });

  it('uses relevance and descending order as the default pair', () => {
    expect(normalizeArchiveSearchState(null)).toMatchObject({
      query: '',
      filters: {
        sort: 'relevance',
        sortOrder: 'desc',
      },
    });
  });

  it('preserves draft whitespace in state while trimming the canonical URL query', () => {
    const normalized = normalizeArchiveSearchState({
      query: 'family ',
      filters: {},
    });
    const encoded = encodeArchiveSearchParams(normalized);

    expect(normalized.query).toBe('family ');
    expect(encoded.get('q')).toBe('family');
  });

  it('lets explicit null fixed filters clear persisted criteria', () => {
    const normalized = normalizeArchiveSearchState({
      query: 'letters',
      filters: {
        format: ['letter'],
        collection: '009',
        dateRange: { start: 1940 },
        verified: true,
      },
    }, {
      fixedFilters: {
        format: null,
        collection: null,
        dateRange: undefined,
        verified: null,
      },
    });

    expect(normalized.filters).toMatchObject({
      format: null,
      collection: null,
      verified: null,
    });
    expect(normalized.filters.dateRange).toBeUndefined();
  });
});

describe('encodeArchiveSearchParams', () => {
  const completeState: ArchiveSearchState = {
    query: '  family letters  ',
    filters: {
      format: ['letter', 'photo'],
      collection: '009',
      sender: 'Mason',
      recipient: 'Ruth',
      place: 'Paris',
      topic: ['family', 'war'],
      tone: ['hopeful', 'nostalgic'],
      relationship: ['sibling', 'friend'],
      year: 1944,
      dateRange: { start: 1940, end: 1945 },
      hasTranscript: false,
      verified: true,
      sort: 'sender',
      sortOrder: 'asc',
    },
  };

  it('writes a canonical round-trip for every addressable field', () => {
    const encoded = encodeArchiveSearchParams(completeState);

    expect(encoded.getAll('format')).toEqual(['letter', 'photo']);
    expect(encoded.get('topic')).toBe('family,war');
    expect(encoded.get('tone')).toBe('hopeful,nostalgic');
    expect(encoded.get('relationship')).toBe('sibling,friend');
    expect(encoded.get('hasTranscript')).toBe('false');
    expect(encoded.get('verified')).toBe('true');
    expect(decodeArchiveSearchParams(encoded)).toEqual(
      normalizeArchiveSearchState({
        ...completeState,
        query: 'family letters',
      }),
    );
  });

  it('omits the configured default pair but writes non-default sort values', () => {
    const collectionDefaults = {
      defaultSort: 'letterDate' as const,
      defaultSortOrder: 'asc' as const,
    };

    const defaults = encodeArchiveSearchParams({
      query: '',
      filters: { sort: 'letterDate', sortOrder: 'asc' },
    }, collectionDefaults);
    expect(defaults.has('sort')).toBe(false);
    expect(defaults.has('sortOrder')).toBe(false);

    const nonDefaults = encodeArchiveSearchParams({
      query: '',
      filters: { sort: 'createdAt', sortOrder: 'desc' },
    }, collectionDefaults);
    expect(nonDefaults.get('sort')).toBe('createdAt');
    expect(nonDefaults.get('sortOrder')).toBe('desc');
  });

  it('preserves foreign parameters and repeated values while replacing owned keys', () => {
    const currentParams = new URLSearchParams();
    currentParams.append('campaign', 'summer');
    currentParams.append('campaign', 'archive');
    currentParams.set('panel', 'details');
    currentParams.set('q', 'stale');
    currentParams.append('format', 'voice');

    const encoded = encodeArchiveSearchParams(completeState, { currentParams });

    expect(encoded.getAll('campaign')).toEqual(['summer', 'archive']);
    expect(encoded.get('panel')).toBe('details');
    expect(encoded.get('q')).toBe('family letters');
    expect(encoded.getAll('format')).toEqual(['letter', 'photo']);
    expect(currentParams.get('q')).toBe('stale');
    expect(currentParams.getAll('format')).toEqual(['voice']);
  });

  it('omits every URL key owned by a configured fixed filter', () => {
    const encoded = encodeArchiveSearchParams(completeState, {
      fixedFilters: {
        collection: '009',
        dateRange: { start: 1940, end: 1945 },
        verified: true,
      },
    });

    expect(encoded.has('collection')).toBe(false);
    expect(encoded.has('yearFrom')).toBe(false);
    expect(encoded.has('yearTo')).toBe(false);
    expect(encoded.has('verified')).toBe(false);
    expect(encoded.get('hasTranscript')).toBe('false');
  });
});
