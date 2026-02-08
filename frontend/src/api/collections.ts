/**
 * Collections API service
 */

import { apiGet, apiPut } from './client';
import type { Letter } from '../types/Letter';

export interface CollectionInfo {
  id: string;
  collectionCode: string;
  title: string | null;
  description: string | null;
  createdAt: string;
  letterCount?: number;
}

export interface CollectionWithLetters extends CollectionInfo {
  letters: Letter[];
}

export interface AdminCollectionInfo extends CollectionInfo {
  publishedCount: number;
  draftCount: number;
  uploadedCount: number;
  readyCount: number;
  reviewedCount: number;
  letterPageCount: number;
  extraContentCount: number;
}

/**
 * Fetch all collections (public - only shows published letter counts)
 */
export async function listCollections(): Promise<CollectionInfo[]> {
  return apiGet<CollectionInfo[]>('/collections');
}

/**
 * Get the next available collection number
 */
export async function getNextCollectionNumber(): Promise<number> {
  const response = await apiGet<{ nextCollectionNumber: number }>('/collections/next-number');
  return response.nextCollectionNumber;
}

/**
 * Fetch a single collection by code (public - only includes published letters)
 */
export async function getCollectionByCode(code: string): Promise<CollectionWithLetters> {
  return apiGet<CollectionWithLetters>(`/collections/${code}`);
}

/**
 * Fetch all collections for admin (with full stats)
 */
export async function getAdminCollections(): Promise<AdminCollectionInfo[]> {
  return apiGet<AdminCollectionInfo[]>('/admin/collections');
}

/**
 * Fetch a single collection for admin (all letters regardless of visibility)
 */
export async function getAdminCollectionByCode(code: string): Promise<CollectionWithLetters> {
  return apiGet<CollectionWithLetters>(`/admin/collections/${code}`);
}

/**
 * Update collection metadata (admin only)
 */
export async function updateCollection(
  code: string,
  data: { title?: string; description?: string | null }
): Promise<CollectionInfo> {
  return apiPut<CollectionInfo>(`/admin/collections/${code}`, data);
}
