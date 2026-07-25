import type { ArchiveShelfItem, LetterImageType } from '../types/Letter';

export type ArchiveSearchSort =
  | 'relevance'
  | 'createdAt'
  | 'letterDate'
  | 'sender'
  | 'recipient'
  | 'collection';

export type ArchiveSearchSortOrder = 'asc' | 'desc';

export interface SearchFilters {
  format?: LetterImageType[] | null;
  collection?: string | null;
  sender?: string | null;
  recipient?: string | null;
  place?: string | null;
  topic?: string[] | null;
  tone?: string[] | null;
  relationship?: string[] | null;
  year?: number | null;
  dateRange?: { start?: number; end?: number };
  hasTranscript?: boolean | null;
  verified?: boolean | null;
  sort?: ArchiveSearchSort;
  sortOrder?: ArchiveSearchSortOrder;
}

export interface ArchiveSearchState {
  query: string;
  filters: SearchFilters;
}

export type ArchiveDefaultSort = Extract<
  ArchiveSearchSort,
  'relevance' | 'createdAt' | 'letterDate'
>;

export interface ArchiveSearchCodecOptions {
  defaultSort?: ArchiveDefaultSort;
  defaultSortOrder?: ArchiveSearchSortOrder;
  fixedFilters?: Partial<SearchFilters>;
  /** Existing URL parameters to clone before replacing archive-owned keys. */
  currentParams?: URLSearchParams;
}

export const ARCHIVE_SEARCH_URL_KEYS = [
  'q',
  'collection',
  'sender',
  'recipient',
  'format',
  'sort',
  'verified',
  'hasTranscript',
  'place',
  'topic',
  'tone',
  'relationship',
  'year',
  'yearFrom',
  'yearTo',
  'sortOrder',
] as const;

export type ArchiveSearchUrlKey = (typeof ARCHIVE_SEARCH_URL_KEYS)[number];

const ARCHIVE_FORMATS = new Set<LetterImageType>([
  'letter',
  'photo',
  'ephemera',
  'voice',
  'article',
  'diary',
  'cover',
  'card',
  'telegram',
]);

const ARCHIVE_SORTS = new Set<ArchiveSearchSort>([
  'relevance',
  'createdAt',
  'letterDate',
  'sender',
  'recipient',
  'collection',
]);

const ARCHIVE_SORT_ORDERS = new Set<ArchiveSearchSortOrder>(['asc', 'desc']);

const FILTER_URL_KEYS: Record<keyof SearchFilters, readonly ArchiveSearchUrlKey[]> = {
  format: ['format'],
  collection: ['collection'],
  sender: ['sender'],
  recipient: ['recipient'],
  place: ['place'],
  topic: ['topic'],
  tone: ['tone'],
  relationship: ['relationship'],
  year: ['year'],
  dateRange: ['yearFrom', 'yearTo'],
  hasTranscript: ['hasTranscript'],
  verified: ['verified'],
  sort: ['sort'],
  sortOrder: ['sortOrder'],
};

const MAX_QUERY_LENGTH = 200;
const MAX_FILTER_VALUE_LENGTH = 120;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeText(value: unknown, maxLength = MAX_FILTER_VALUE_LENGTH): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) return null;
  return normalized;
}

function normalizeQuery(value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_QUERY_LENGTH) return '';
  return value;
}

function normalizeUrlQuery(value: string | null): string {
  return normalizeText(value, MAX_QUERY_LENGTH) ?? '';
}

function normalizeStringList(value: unknown, maxLength: number): string[] | null {
  if (!Array.isArray(value)) return null;

  const normalized = [...new Set(
    value
      .map((entry) => normalizeText(entry, maxLength))
      .filter((entry): entry is string => entry !== null),
  )];

  if (normalized.length === 0 || normalized.join(',').length > maxLength) return null;
  return normalized;
}

function normalizeFormats(value: unknown): LetterImageType[] | null {
  if (!Array.isArray(value)) return null;

  const normalized = value.filter(
    (entry): entry is LetterImageType =>
      typeof entry === 'string' && ARCHIVE_FORMATS.has(entry as LetterImageType),
  );

  return normalized.length > 0 ? [...new Set(normalized)] : null;
}

function normalizeBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function parseUrlBoolean(value: string | null): boolean | null {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

function normalizeYear(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0 || value > 9999) {
    return null;
  }
  return value;
}

function parseUrlYear(value: string | null): number | null {
  if (value === null || !/^\d{1,4}$/.test(value.trim())) return null;
  return normalizeYear(Number(value));
}

function normalizeDateRange(value: unknown): SearchFilters['dateRange'] {
  if (!isRecord(value)) return undefined;

  const start = normalizeYear(value.start);
  const end = normalizeYear(value.end);
  if (start === null && end === null) return undefined;

  return {
    ...(start !== null ? { start } : {}),
    ...(end !== null ? { end } : {}),
  };
}

function normalizeSort(value: unknown): ArchiveSearchSort | null {
  return typeof value === 'string' && ARCHIVE_SORTS.has(value as ArchiveSearchSort)
    ? value as ArchiveSearchSort
    : null;
}

function normalizeSortOrder(value: unknown): ArchiveSearchSortOrder | null {
  return typeof value === 'string' && ARCHIVE_SORT_ORDERS.has(value as ArchiveSearchSortOrder)
    ? value as ArchiveSearchSortOrder
    : null;
}

function normalizeOptionalFilters(value: unknown): Partial<SearchFilters> {
  if (!isRecord(value)) return {};

  const normalized: Partial<SearchFilters> = {};

  if (Object.hasOwn(value, 'format')) normalized.format = normalizeFormats(value.format);
  if (Object.hasOwn(value, 'collection')) normalized.collection = normalizeText(value.collection);
  if (Object.hasOwn(value, 'sender')) normalized.sender = normalizeText(value.sender);
  if (Object.hasOwn(value, 'recipient')) normalized.recipient = normalizeText(value.recipient);
  if (Object.hasOwn(value, 'place')) normalized.place = normalizeText(value.place);
  if (Object.hasOwn(value, 'topic')) normalized.topic = normalizeStringList(value.topic, 120);
  if (Object.hasOwn(value, 'tone')) normalized.tone = normalizeStringList(value.tone, 80);
  if (Object.hasOwn(value, 'relationship')) {
    normalized.relationship = normalizeStringList(value.relationship, 80);
  }
  if (Object.hasOwn(value, 'year')) normalized.year = normalizeYear(value.year);
  if (Object.hasOwn(value, 'dateRange')) normalized.dateRange = normalizeDateRange(value.dateRange);
  if (Object.hasOwn(value, 'hasTranscript')) {
    normalized.hasTranscript = normalizeBoolean(value.hasTranscript);
  }
  if (Object.hasOwn(value, 'verified')) normalized.verified = normalizeBoolean(value.verified);

  if (Object.hasOwn(value, 'sort')) {
    const sort = normalizeSort(value.sort);
    if (sort !== null) normalized.sort = sort;
  }

  if (Object.hasOwn(value, 'sortOrder')) {
    const sortOrder = normalizeSortOrder(value.sortOrder);
    if (sortOrder !== null) normalized.sortOrder = sortOrder;
  }

  return normalized;
}

function getDefaults(options: ArchiveSearchCodecOptions) {
  return {
    sort: options.defaultSort ?? 'relevance',
    sortOrder: options.defaultSortOrder ?? 'desc',
  } as const;
}

function getFixedUrlKeys(fixedFilters: Partial<SearchFilters> | undefined) {
  const fixedUrlKeys = new Set<ArchiveSearchUrlKey>();
  if (!fixedFilters) return fixedUrlKeys;

  for (const key of Object.keys(fixedFilters) as Array<keyof SearchFilters>) {
    for (const urlKey of FILTER_URL_KEYS[key] ?? []) {
      fixedUrlKeys.add(urlKey);
    }
  }

  return fixedUrlKeys;
}

function parseUrlList(searchParams: URLSearchParams, key: ArchiveSearchUrlKey): string[] | null {
  const values = searchParams
    .getAll(key)
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean);

  return values.length > 0 ? values : null;
}

/**
 * Whether the URL contains any archive-owned key. Presence is intentional:
 * empty or malformed owned parameters still prevent private persisted state
 * from leaking into a shared URL.
 */
export function hasArchiveSearchParams(searchParams: URLSearchParams): boolean {
  return ARCHIVE_SEARCH_URL_KEYS.some((key) => searchParams.has(key));
}

/**
 * Normalize an unknown snapshot into the single safe archive-search shape.
 * Configured fixed filters are normalized and overlaid last.
 */
export function normalizeArchiveSearchState(
  value: unknown,
  options: ArchiveSearchCodecOptions = {},
): ArchiveSearchState {
  const state = isRecord(value) ? value : {};
  const filters = normalizeOptionalFilters(state.filters);
  const fixedFilters = normalizeOptionalFilters(options.fixedFilters);
  const defaults = getDefaults(options);
  const overlaidFilters = { ...filters, ...fixedFilters };

  return {
    query: normalizeQuery(state.query),
    filters: {
      format: overlaidFilters.format ?? null,
      collection: overlaidFilters.collection ?? null,
      sender: overlaidFilters.sender ?? null,
      recipient: overlaidFilters.recipient ?? null,
      place: overlaidFilters.place ?? null,
      topic: overlaidFilters.topic ?? null,
      tone: overlaidFilters.tone ?? null,
      relationship: overlaidFilters.relationship ?? null,
      year: overlaidFilters.year ?? null,
      dateRange: overlaidFilters.dateRange,
      hasTranscript: overlaidFilters.hasTranscript ?? null,
      verified: overlaidFilters.verified ?? null,
      sort: overlaidFilters.sort ?? defaults.sort,
      sortOrder: overlaidFilters.sortOrder ?? defaults.sortOrder,
    },
  };
}

/**
 * Decode archive-owned URL parameters, validating their values and applying
 * configured defaults and fixed filters.
 */
export function decodeArchiveSearchParams(
  searchParams: URLSearchParams,
  options: ArchiveSearchCodecOptions = {},
): ArchiveSearchState {
  const formats = parseUrlList(searchParams, 'format');
  const topic = parseUrlList(searchParams, 'topic');
  const tone = parseUrlList(searchParams, 'tone');
  const relationship = parseUrlList(searchParams, 'relationship');
  const start = parseUrlYear(searchParams.get('yearFrom'));
  const end = parseUrlYear(searchParams.get('yearTo'));

  return normalizeArchiveSearchState({
    query: normalizeUrlQuery(searchParams.get('q')),
    filters: {
      format: formats,
      collection: searchParams.get('collection'),
      sender: searchParams.get('sender'),
      recipient: searchParams.get('recipient'),
      place: searchParams.get('place'),
      topic,
      tone,
      relationship,
      year: parseUrlYear(searchParams.get('year')),
      dateRange: start !== null || end !== null
        ? {
            ...(start !== null ? { start } : {}),
            ...(end !== null ? { end } : {}),
          }
        : undefined,
      hasTranscript: parseUrlBoolean(searchParams.get('hasTranscript')),
      verified: parseUrlBoolean(searchParams.get('verified')),
      sort: searchParams.get('sort'),
      sortOrder: searchParams.get('sortOrder'),
    },
  }, options);
}

/**
 * Replace archive-owned parameters in a clone of the current URL while
 * preserving every foreign key and repeated foreign value.
 */
export function encodeArchiveSearchParams(
  state: ArchiveSearchState,
  options: ArchiveSearchCodecOptions = {},
): URLSearchParams {
  const normalized = normalizeArchiveSearchState(state, options);
  const defaults = getDefaults(options);
  const fixedUrlKeys = getFixedUrlKeys(options.fixedFilters);
  const searchParams = new URLSearchParams(options.currentParams);

  for (const key of ARCHIVE_SEARCH_URL_KEYS) {
    searchParams.delete(key);
  }

  const { query, filters } = normalized;
  const canonicalQuery = query.trim();
  if (canonicalQuery) searchParams.set('q', canonicalQuery);

  if (!fixedUrlKeys.has('format')) {
    filters.format?.forEach((format) => searchParams.append('format', format));
  }
  if (!fixedUrlKeys.has('collection') && filters.collection) {
    searchParams.set('collection', filters.collection);
  }
  if (!fixedUrlKeys.has('sender') && filters.sender) searchParams.set('sender', filters.sender);
  if (!fixedUrlKeys.has('recipient') && filters.recipient) {
    searchParams.set('recipient', filters.recipient);
  }
  if (!fixedUrlKeys.has('place') && filters.place) searchParams.set('place', filters.place);
  if (!fixedUrlKeys.has('topic') && filters.topic?.length) {
    searchParams.set('topic', filters.topic.join(','));
  }
  if (!fixedUrlKeys.has('tone') && filters.tone?.length) {
    searchParams.set('tone', filters.tone.join(','));
  }
  if (!fixedUrlKeys.has('relationship') && filters.relationship?.length) {
    searchParams.set('relationship', filters.relationship.join(','));
  }
  if (!fixedUrlKeys.has('year') && filters.year !== null && filters.year !== undefined) {
    searchParams.set('year', String(filters.year));
  }
  if (!fixedUrlKeys.has('yearFrom') && filters.dateRange?.start !== undefined) {
    searchParams.set('yearFrom', String(filters.dateRange.start));
  }
  if (!fixedUrlKeys.has('yearTo') && filters.dateRange?.end !== undefined) {
    searchParams.set('yearTo', String(filters.dateRange.end));
  }
  if (
    !fixedUrlKeys.has('hasTranscript')
    && filters.hasTranscript !== null
    && filters.hasTranscript !== undefined
  ) {
    searchParams.set('hasTranscript', String(filters.hasTranscript));
  }
  if (
    !fixedUrlKeys.has('verified')
    && filters.verified !== null
    && filters.verified !== undefined
  ) {
    searchParams.set('verified', String(filters.verified));
  }
  if (!fixedUrlKeys.has('sort') && filters.sort && filters.sort !== defaults.sort) {
    searchParams.set('sort', filters.sort);
  }
  if (
    !fixedUrlKeys.has('sortOrder')
    && filters.sortOrder
    && filters.sortOrder !== defaults.sortOrder
  ) {
    searchParams.set('sortOrder', filters.sortOrder);
  }

  return searchParams;
}

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
