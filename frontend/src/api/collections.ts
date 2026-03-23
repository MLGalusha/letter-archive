/**
 * Collections API service
 */

import { apiGet, apiPut, apiPost } from './client';
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
  hiddenCount: number;
  uploadedCount: number;
  transcribedCount: number;
  metadataReadyCount: number;
  reviewedCount: number;
  letterPageCount: number;
  extraContentCount: number;
  // Verification and date range stats
  verifiedCount: number;      // Letters with both transcript AND metadata verified
  minDate: string | null;     // Earliest dateRaw (YYYYMMDD format)
  maxDate: string | null;     // Latest dateRaw (YYYYMMDD format)
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

/**
 * Collection analysis result types
 */
export interface CollectionAnalysisEntity {
  name: string;
  role: 'sender' | 'recipient' | 'mentioned';
  letterCount: number;
}

export interface CollectionAnalysisPlace {
  name: string;
  type: string;
  letterCount: number;
}

export interface CollectionAnalysisRelationship {
  person1: string;
  person2: string;
  type: string;
  evidence: string;
}

export interface CollectionAnalysisDuplicate {
  name1: string;
  name2: string;
  confidence: number;
  reason: string;
}

export interface CollectionAnalysisResult {
  collectionId: string;
  collectionCode: string;
  letterCount: number;
  analysis: {
    people: CollectionAnalysisEntity[];
    places: CollectionAnalysisPlace[];
    relationships: CollectionAnalysisRelationship[];
    potentialDuplicates: CollectionAnalysisDuplicate[];
  };
  stats: {
    peopleFound: number;
    placesFound: number;
    relationshipsFound: number;
    duplicatesFound: number;
    entitiesCreated: number;
    entitiesLinked: number;
    itemsQueuedForReview: number;
  };
  isStub: boolean;
}

/**
 * Analyze a collection to discover entities, relationships, and potential duplicates
 */
export async function analyzeCollection(code: string): Promise<CollectionAnalysisResult> {
  return apiPost<CollectionAnalysisResult>(`/admin/collections/${code}/analyze`);
}

/**
 * Entity resolution result types
 */
export interface EntityResolutionResult {
  collectionId: string;
  phases: {
    phase1: {
      mergesExecuted: number;
      mergesQueued: number;
      genericsResolved: number;
      genericsQueued: number;
      genericsDeleted: number;
      fillsApplied: number;
      fillsQueued: number;
      relationshipCorrections: number;
      relationshipCorrectionsQueued: number;
    };
    phase2: {
      relationshipsVerified: number;
      correctionsApplied: number;
      correctionsQueued: number;
    };
    phase3: {
      biographiesGenerated: number;
      biographiesSkipped: number;
    };
  };
  isStub: boolean;
  errors: string[];
}

/**
 * Run collection-level entity resolution (merges, generics, fills, bios)
 */
export async function resolveCollectionEntities(code: string): Promise<EntityResolutionResult> {
  return apiPost<EntityResolutionResult>(`/admin/collections/${code}/resolve-entities`);
}
