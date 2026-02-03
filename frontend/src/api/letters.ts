/**
 * Letters API service
 */

import { apiGet } from './client';
import type { Letter } from '../types/Letter';

export interface LettersResponse {
  letters: Letter[];
  page: number;
  limit: number;
}

export type SortField = 'createdAt' | 'letterDate' | 'sender' | 'title' | 'workflow' | 'visibility';
export type SortOrder = 'asc' | 'desc';

export interface LetterQueryParams {
  page?: number;
  limit?: number;
  visibility?: 'DRAFT' | 'PUBLISHED' | 'HIDDEN';
  workflow?: string;
  collection?: string;
  sort?: SortField;
  sortOrder?: SortOrder;
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
 * Fetch all letters for admin view (all visibility states)
 */
export async function getAdminLetters(params: LetterQueryParams = {}): Promise<LettersResponse> {
  return apiGet<LettersResponse>('/letters', {
    page: params.page || 1,
    limit: params.limit || 100,
    visibility: params.visibility, // undefined = all
    workflow: params.workflow,
    collection: params.collection,
    sort: params.sort,
    sortOrder: params.sortOrder,
  });
}
