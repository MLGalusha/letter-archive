/**
 * Entity API service for persons, places, and review queue
 */

import { apiGet, apiPost, apiPut, apiDelete } from './client';
import type { PersonRole, PlaceRole, PlaceType } from '../types/Letter';

// ============================================================================
// TYPES
// ============================================================================

export interface CanonicalPerson {
  id: string;
  canonicalName: string;
  aliases: string[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CanonicalPlace {
  id: string;
  canonicalName: string;
  aliases: string[];
  placeType?: PlaceType;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PersonWithCount extends CanonicalPerson {
  letterCount: number;
}

export interface PlaceWithCount extends CanonicalPlace {
  letterCount: number;
}

export interface EntityMatch {
  entityId: string;
  canonicalName: string;
  matchedOn: 'canonical_name' | 'alias';
  similarity: number;
}

export interface EntityReviewItem {
  id: string;
  entityType: 'person' | 'place';
  extractedText: string;
  letterId: string;
  suggestedEntityId?: string;
  suggestedEntityName?: string;
  context?: string;
  confidence: number;
  status: 'pending' | 'confirmed' | 'rejected' | 'new_entity';
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt: string;
}

export interface ReviewQueueStats {
  pending: { persons: number; places: number };
  resolved: { confirmed: number; rejected: number; newEntity: number };
}

export interface LetterForEntity {
  letterId: string;
  title: string;
  dateRaw?: string;
  role: PersonRole | PlaceRole;
  confidence: number;
}

// Relationship types
export type PersonRelationshipType =
  | 'spouse'
  | 'fiancé/fiancée'
  | 'romantic-partner'
  | 'parent-child'
  | 'sibling'
  | 'grandparent-grandchild'
  | 'aunt-uncle-niece-nephew'
  | 'cousin'
  | 'in-law'
  | 'friend'
  | 'acquaintance'
  | 'business-associate'
  | 'employer-employee'
  | 'unknown';

export interface PersonRelationship {
  id: string;
  personAId: string;
  personBId: string;
  personAName: string;
  personBName: string;
  relationshipType: PersonRelationshipType;
  notes?: string;
  discoveredInLetterId?: string;
  confidence: number;
  confirmedBy?: string;
  confirmedAt?: string;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// PERSONS API
// ============================================================================

/**
 * Get all persons with letter counts
 */
export async function getAllPersons(): Promise<{ persons: PersonWithCount[] }> {
  return apiGet<{ persons: PersonWithCount[] }>('/admin/entities/persons');
}

/**
 * Search persons by name (fuzzy matching)
 */
export async function searchPersons(query: string): Promise<{ matches: EntityMatch[] }> {
  return apiGet<{ matches: EntityMatch[] }>('/admin/entities/persons/search', { q: query });
}

/**
 * Get person by ID with related letters
 */
export async function getPersonById(personId: string): Promise<{
  person: CanonicalPerson;
  letters: LetterForEntity[];
}> {
  return apiGet<{ person: CanonicalPerson; letters: LetterForEntity[] }>(
    `/admin/entities/persons/${personId}`
  );
}

/**
 * Create a new canonical person
 */
export async function createPerson(data: {
  canonicalName: string;
  aliases?: string[];
  notes?: string;
}): Promise<{ person: CanonicalPerson }> {
  return apiPost<{ person: CanonicalPerson }>('/admin/entities/persons', data);
}

/**
 * Update a canonical person
 */
export async function updatePerson(
  personId: string,
  data: {
    canonicalName?: string;
    aliases?: string[];
    notes?: string | null;
  }
): Promise<{ person: CanonicalPerson }> {
  return apiPut<{ person: CanonicalPerson }>(`/admin/entities/persons/${personId}`, data);
}

/**
 * Merge two persons (moves all letter associations to keepId, deletes mergeId)
 */
export async function mergePersons(
  keepId: string,
  mergeId: string
): Promise<{ person: CanonicalPerson; message: string }> {
  return apiPost<{ person: CanonicalPerson; message: string }>(
    '/admin/entities/persons/merge',
    { keepId, mergeId }
  );
}

// ============================================================================
// PLACES API
// ============================================================================

/**
 * Get all places with letter counts
 */
export async function getAllPlaces(): Promise<{ places: PlaceWithCount[] }> {
  return apiGet<{ places: PlaceWithCount[] }>('/admin/entities/places');
}

/**
 * Search places by name (fuzzy matching)
 */
export async function searchPlaces(query: string): Promise<{ matches: EntityMatch[] }> {
  return apiGet<{ matches: EntityMatch[] }>('/admin/entities/places/search', { q: query });
}

/**
 * Get place by ID with related letters
 */
export async function getPlaceById(placeId: string): Promise<{
  place: CanonicalPlace;
  letters: LetterForEntity[];
}> {
  return apiGet<{ place: CanonicalPlace; letters: LetterForEntity[] }>(
    `/admin/entities/places/${placeId}`
  );
}

/**
 * Create a new canonical place
 */
export async function createPlace(data: {
  canonicalName: string;
  aliases?: string[];
  placeType?: PlaceType;
  notes?: string;
}): Promise<{ place: CanonicalPlace }> {
  return apiPost<{ place: CanonicalPlace }>('/admin/entities/places', data);
}

/**
 * Update a canonical place
 */
export async function updatePlace(
  placeId: string,
  data: {
    canonicalName?: string;
    aliases?: string[];
    placeType?: PlaceType | null;
    notes?: string | null;
  }
): Promise<{ place: CanonicalPlace }> {
  return apiPut<{ place: CanonicalPlace }>(`/admin/entities/places/${placeId}`, data);
}

// ============================================================================
// REVIEW QUEUE API
// ============================================================================

/**
 * Get pending review items (optionally filtered by entity type)
 */
export async function getReviewQueue(entityType?: 'person' | 'place'): Promise<{
  items: EntityReviewItem[];
  stats: ReviewQueueStats;
}> {
  return apiGet<{ items: EntityReviewItem[]; stats: ReviewQueueStats }>(
    '/admin/entities/review',
    entityType ? { type: entityType } : undefined
  );
}

/**
 * Resolve a review queue item
 */
export async function resolveReviewItem(
  itemId: string,
  resolution: {
    status: 'confirmed' | 'rejected' | 'new_entity';
    reviewedBy?: string;
  }
): Promise<{ message: string }> {
  return apiPost<{ message: string }>(`/admin/entities/review/${itemId}/resolve`, resolution);
}

// ============================================================================
// RELATIONSHIPS API
// ============================================================================

/**
 * Get all relationships
 */
export async function getAllRelationships(): Promise<{ relationships: PersonRelationship[] }> {
  return apiGet<{ relationships: PersonRelationship[] }>('/admin/entities/relationships');
}

/**
 * Get relationships for a specific person
 */
export async function getRelationshipsForPerson(
  personId: string
): Promise<{ relationships: PersonRelationship[] }> {
  return apiGet<{ relationships: PersonRelationship[] }>(
    `/admin/entities/relationships/person/${personId}`
  );
}

/**
 * Create a new relationship
 */
export async function createRelationship(data: {
  personAId: string;
  personBId: string;
  relationshipType: PersonRelationshipType;
  notes?: string;
  discoveredInLetterId?: string;
  confidence?: number;
}): Promise<{ relationship: PersonRelationship }> {
  return apiPost<{ relationship: PersonRelationship }>('/admin/entities/relationships', data);
}

/**
 * Update a relationship
 */
export async function updateRelationship(
  relationshipId: string,
  data: {
    relationshipType?: PersonRelationshipType;
    notes?: string | null;
    confidence?: number;
  }
): Promise<{ relationship: PersonRelationship }> {
  return apiPut<{ relationship: PersonRelationship }>(
    `/admin/entities/relationships/${relationshipId}`,
    data
  );
}

/**
 * Delete a relationship
 */
export async function deleteRelationship(relationshipId: string): Promise<{ message: string }> {
  return apiDelete<{ message: string }>(`/admin/entities/relationships/${relationshipId}`);
}
