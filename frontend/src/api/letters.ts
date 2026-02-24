/**
 * Letters API service
 */

import { apiGet, apiDelete } from './client';
import type { Letter, VisibilityState } from '../types/Letter';

export interface LettersResponse {
  letters: Letter[];
  page: number;
  limit: number;
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
    transcribed: number;
    metadataReady: number;
    reviewed: number;
    published: number;
    hidden: number;
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
  };
}

export type SortField = 'createdAt' | 'letterDate' | 'sender' | 'recipient' | 'workflow' | 'visibility' | 'collection';
export type SortOrder = 'asc' | 'desc';

export interface LetterQueryParams {
  page?: number;
  limit?: number;
  visibility?: 'PUBLISHED' | 'HIDDEN';
  workflow?: string;
  collection?: string;
  sort?: SortField;
  sortOrder?: SortOrder;
}

export interface AdminLetterQueryParams {
  page?: number;
  limit?: number;
  visibility?: VisibilityState;
  collection?: string;
  search?: string;
  sort?: SortField;
  sortOrder?: SortOrder;
  // Date filters
  year?: number;
  month?: number;
  day?: number;
  dateFrom?: string;  // YYYYMMDD format
  dateTo?: string;    // YYYYMMDD format
  // Content status filters (comma-separated if multiple)
  transcriptStatus?: string;
  metadataStatus?: string;
}

/**
 * Fetch list of letters with optional filtering
 */
export async function getLetters(params: LetterQueryParams = {}): Promise<LettersResponse> {
  return apiGet<LettersResponse>('/letters', {
    page: params.page,
    limit: params.limit,
    visibility: params.visibility,
    workflow: params.workflow,
    collection: params.collection,
  });
}

/**
 * Fetch a single letter by ID
 */
export async function getLetterById(id: string): Promise<Letter> {
  return apiGet<Letter>(`/letters/${id}`);
}

/**
 * Fetch letters for public display (published only)
 */
export async function getPublishedLetters(params: Omit<LetterQueryParams, 'visibility'> = {}): Promise<LettersResponse> {
  return getLetters({ ...params, visibility: 'PUBLISHED' });
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
    sort: params.sort,
    sortOrder: params.sortOrder,
    // Date filters
    year: params.year,
    month: params.month,
    day: params.day,
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
    // Content status filters
    transcriptStatus: params.transcriptStatus,
    metadataStatus: params.metadataStatus,
  });
}

/**
 * Fetch all filtered letter IDs (for select-all across pages)
 */
export async function getFilteredLetterIds(params: Omit<AdminLetterQueryParams, 'page' | 'limit'>): Promise<string[]> {
  const ids: string[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const response = await apiGet<AdminLettersResponse>('/admin/letters', {
      ...params,
      page,
      limit: 100,
    });
    ids.push(...response.letters.map(l => l.id));
    totalPages = response.pagination.totalPages;
    page++;
  } while (page <= totalPages);
  return ids;
}

/**
 * Fetch a single letter by ID for admin view (any visibility state)
 */
export async function getAdminLetterById(id: string): Promise<Letter> {
  return apiGet<Letter>(`/admin/letters/${id}`);
}

/**
 * Delete a letter (soft delete)
 */
export async function deleteLetter(id: string): Promise<void> {
  await apiDelete(`/admin/letters/${id}`);
}

/**
 * Adjacent letters response
 */
export interface AdjacentLettersResponse {
  prev: string | null;
  next: string | null;
  position: number;
  total: number;
}

/**
 * Get adjacent (prev/next) letters in the same collection
 */
export async function getAdjacentLetters(id: string): Promise<AdjacentLettersResponse> {
  return apiGet<AdjacentLettersResponse>(`/letters/${id}/adjacent`);
}
