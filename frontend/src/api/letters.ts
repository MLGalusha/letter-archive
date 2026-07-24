/**
 * Letters API service
 */

import { apiGet, apiDelete } from './client';
import type {
  ArchiveSearchFacets,
  ArchiveShelfItem,
  Letter,
  LetterImageType,
  PublicLetter,
  VisibilityState,
} from '../types/Letter';
import type { BulkSource } from './admin/bulk';

export interface LettersResponse {
  letters: PublicLetter[];
  page: number;
  limit: number;
}

export interface ArchiveShelfResponse {
  letters: ArchiveShelfItem[];
  page: number;
  limit: number;
  total: number;
}

export interface ArchiveSearchResponse extends ArchiveShelfResponse {
  facets: ArchiveSearchFacets;
}

export interface ArchiveSearchParams {
  page?: number;
  limit?: number;
  collection?: string;
  search?: string;
  format?: LetterImageType[] | null;
  sender?: string | null;
  recipient?: string | null;
  place?: string | null;
  topic?: string | string[] | null;
  tone?: string | string[] | null;
  relationship?: string | string[] | null;
  year?: number | null;
  yearFrom?: number | null;
  yearTo?: number | null;
  hasTranscript?: boolean | null;
  verified?: boolean | null;
  sort?: 'relevance' | 'createdAt' | 'letterDate' | 'sender' | 'recipient' | 'collection';
  sortOrder?: SortOrder;
}

export interface AdminLettersResponse {
  letters: Letter[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  stats: {
    total: number;
    uploaded: number;
    transcribing?: number;
    transcribed: number;
    metadataExtracting?: number;
    metadataReady: number;
    reviewed: number;
    published: number;
    hidden: number;
    flagged: number;
    // Two-track content status stats (nested objects)
    transcript: {
      empty: number;
      aiDraft: number;
      edited: number;
      verified: number;
    };
    metadata: {
      empty: number;
      aiDraft: number;
      edited: number;
      verified: number;
    };
    extraContent?: {
      empty: number;
      aiDraft: number;
      edited: number;
      verified: number;
    };
    missing?: {
      sender: number;
      recipient: number;
      date: number;
    };
    contentShape?: {
      extras: number;
      photos: number;
      cover: number;
      telegram: number;
      card: number;
      ephemera: number;
      article: number;
      diary: number;
      voice: number;
    };
  };
}

export type SortOrder = 'asc' | 'desc';

export type PublicLetterSortField = 'createdAt' | 'letterDate' | 'sender';

/** Query options accepted by the published catalogue endpoints. */
export interface PublicLetterQueryParams {
  page?: number;
  limit?: number;
  collection?: string;
  sort?: PublicLetterSortField;
  sortOrder?: SortOrder;
}

export type AdminLetterSortField = 'createdAt' | 'updatedAt' | 'letterDate' | 'sender' | 'recipient' | 'workflow' | 'visibility' | 'collection' | 'lastOpenedAt' | 'flagged' | 'letters' | 'extras' | 'photos' | 'cover' | 'telegram' | 'card' | 'ephemera' | 'article' | 'diary' | 'voice';

export interface AdminLetterQueryParams {
  page?: number;
  limit?: number;
  visibility?: VisibilityState;
  collection?: string;
  search?: string;
  workflow?: string;
  sort?: AdminLetterSortField;
  sortOrder?: SortOrder;
  sortRules?: string;
  // Date filters
  year?: number;
  month?: number;
  day?: number;
  dateFrom?: string;  // YYYYMMDD format
  dateTo?: string;    // YYYYMMDD format
  // Content status filters (comma-separated if multiple)
  transcriptStatus?: string;
  metadataStatus?: string;
  extraContentStatus?: string;
  flagged?: string;
  missing?: string;
  contentShape?: string;
}

/**
 * Fetch list of letters with optional filtering
 */
export async function getLetters(params: PublicLetterQueryParams = {}): Promise<LettersResponse> {
  return apiGet<LettersResponse>('/letters', {
    page: params.page,
    limit: params.limit,
    collection: params.collection,
    sort: params.sort,
    sortOrder: params.sortOrder,
  });
}

/**
 * Fetch a single letter by ID
 */
export async function getLetterById(id: string, signal?: AbortSignal): Promise<PublicLetter> {
  return apiGet<PublicLetter>(`/letters/${id}`, undefined, signal);
}

export async function getArchiveShelfItems(
  params: PublicLetterQueryParams = {},
): Promise<ArchiveShelfResponse> {
  return apiGet<ArchiveShelfResponse>('/letters/summaries', {
    page: params.page,
    limit: params.limit,
    collection: params.collection,
    sort: params.sort,
    sortOrder: params.sortOrder,
    visibility: 'PUBLISHED',
  });
}

export async function searchArchiveShelf(
  params: ArchiveSearchParams = {},
): Promise<ArchiveSearchResponse> {
  return apiGet<ArchiveSearchResponse>('/letters/search', {
    page: params.page,
    limit: params.limit,
    collection: params.collection,
    search: params.search,
    format: params.format?.length ? params.format : undefined,
    sender: params.sender || undefined,
    recipient: params.recipient || undefined,
    place: params.place || undefined,
    topic: Array.isArray(params.topic) ? params.topic.join(",") : params.topic || undefined,
    tone: Array.isArray(params.tone) ? params.tone.join(",") : params.tone || undefined,
    relationship: Array.isArray(params.relationship) ? params.relationship.join(",") : params.relationship || undefined,
    year: params.year || undefined,
    yearFrom: params.yearFrom || undefined,
    yearTo: params.yearTo || undefined,
    hasTranscript: params.hasTranscript === null || params.hasTranscript === undefined
      ? undefined
      : params.hasTranscript ? 'true' : 'false',
    verified: params.verified === null || params.verified === undefined
      ? undefined
      : params.verified ? 'true' : 'false',
    sort: params.sort,
    sortOrder: params.sortOrder,
  });
}

/**
 * Fetch all letters for admin view with server-side filtering, pagination, and stats
 *
 * Uses the /admin/letters endpoint which supports:
 * - visibility: Single visibility filter
 * - collection: Collection code filter
 * - search: Search term (matches sender, recipient, summary, hook)
 * - sort/sortOrder: Server-side sorting
 *
 * Returns:
 * - letters: Paginated letter list
 * - pagination: { page, limit, total, totalPages }
 * - stats: Counts for the collection (unaffected by filters)
 */
export async function getAdminLetters(params: AdminLetterQueryParams = {}): Promise<AdminLettersResponse> {
  return apiGet<AdminLettersResponse>('/admin/letters', {
    page: params.page || 1,
    limit: params.limit || 50,
    visibility: params.visibility,
    collection: params.collection,
    search: params.search,
    workflow: params.workflow,
    sort: params.sort,
    sortOrder: params.sortOrder,
    sortRules: params.sortRules,
    // Date filters
    year: params.year,
    month: params.month,
    day: params.day,
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
    // Content status filters
    transcriptStatus: params.transcriptStatus,
    metadataStatus: params.metadataStatus,
    extraContentStatus: params.extraContentStatus,
    flagged: params.flagged,
    missing: params.missing,
    contentShape: params.contentShape,
  });
}

/**
 * Fetch every filtered letter and its observed source revision for select-all across
 * pages.
 */
export async function getFilteredLetterSources(
  params: Omit<AdminLetterQueryParams, 'page' | 'limit'>,
): Promise<BulkSource[]> {
  const sources: BulkSource[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const response = await apiGet<AdminLettersResponse>('/admin/letters', {
      ...params,
      page,
      limit: 100,
    });
    sources.push(...response.letters.map((letter) => ({
      letterId: letter.id,
      primarySourceRevision: letter.primarySourceRevision,
    })));
    totalPages = response.pagination.totalPages;
    page++;
  } while (page <= totalPages);
  return sources;
}

/**
 * Fetch a single letter by ID for admin view (any visibility state)
 */
export async function getAdminLetterById(id: string): Promise<Letter> {
  return apiGet<Letter>(`/admin/letters/${id}`);
}

/**
 * Delete a complete correspondence group at the source revision shown to the
 * operator.
 */
export async function deleteLetter(
  id: string,
  primarySourceRevision: number,
): Promise<void> {
  await apiDelete(`/admin/letters/${id}`, { primarySourceRevision });
}

/**
 * Preview data for an adjacent letter
 */
export interface AdjacentLetterPreview {
  id: string;
  dateRaw: string;
  date?: string;
  sender?: string;
  recipient?: string;
  hook?: string;
  contentLabels?: string[];
  imageUrl?: string;
}

/**
 * Adjacent letters response with preview data
 */
export interface AdjacentLettersResponse {
  prev: AdjacentLetterPreview | null;
  next: AdjacentLetterPreview | null;
  prevWraps?: boolean;
  nextWraps?: boolean;
  position: number | null;
  total: number;
  collectionCode: string;
  collectionTitle: string | null;
}

/**
 * Get adjacent (prev/next) letters in the same collection
 */
export async function getAdjacentLetters(id: string, signal?: AbortSignal): Promise<AdjacentLettersResponse> {
  return apiGet<AdjacentLettersResponse>(`/letters/${id}/adjacent`, undefined, signal);
}
