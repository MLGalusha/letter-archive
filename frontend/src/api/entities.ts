/**
 * Entity API service for persons, places, and review queue
 */

import { apiGet, apiPost, apiPut, apiDelete } from './client';
import type {
  PersonRole,
  PlaceRole,
  PlaceType,
  ContentStatus,
  PersonRelationshipType,
} from '../types/Letter';

// ============================================================================
// TYPES
// ============================================================================

export interface CanonicalPerson {
  id: string;
  canonicalName: string;
  aliases: string[];
  notes?: string;
  biography?: string;
  biographyStatus?: ContentStatus;
  biographyVerifiedAt?: string;
  biographyVerifiedBy?: string;
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

/**
 * Merge two places (moves all letter associations to keepId, deletes mergeId)
 */
export async function mergePlaces(
  keepId: string,
  mergeId: string
): Promise<{ place: CanonicalPlace; message: string }> {
  return apiPost<{ place: CanonicalPlace; message: string }>(
    '/admin/entities/places/merge',
    { keepId, mergeId }
  );
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

// ============================================================================
// PUBLIC ENTITY API
// ============================================================================

export interface PublicLetterForEntity {
  id: string;
  dateRaw: string;
  letterDate?: string;
  role: PersonRole | PlaceRole;
  sender?: string;
  recipient?: string;
  hook?: string;
  summary?: string;
}

export interface PublicPersonDetail {
  person: {
    id: string;
    canonicalName: string;
    aliases: string[];
    biography?: string;
    biographyStatus?: ContentStatus;
  };
  relationships: Array<{
    id: string;
    relatedPersonId: string;
    relatedPersonName: string;
    relationshipType: PersonRelationshipType;
  }>;
  stats: {
    asSender: number;
    asRecipient: number;
    asMentioned: number;
    total: number;
  };
  letters: PublicLetterForEntity[];
}

export interface PublicPlaceDetail {
  place: {
    id: string;
    canonicalName: string;
    aliases: string[];
    placeType?: PlaceType;
    notes?: string;
  };
  stats: {
    writtenFrom: number;
    mentioned: number;
    destination: number;
    total: number;
  };
  letters: PublicLetterForEntity[];
}

/**
 * Get public person detail (for public person page)
 */
export async function getPersonPublic(personId: string): Promise<PublicPersonDetail> {
  return apiGet<PublicPersonDetail>(`/persons/${personId}`);
}

/**
 * Get public place detail (for public place page)
 */
export async function getPlacePublic(placeId: string): Promise<PublicPlaceDetail> {
  return apiGet<PublicPlaceDetail>(`/places/${placeId}`);
}

// ============================================================================
// BIOGRAPHY API
// ============================================================================

/**
 * Generate AI biography for a person
 */
export async function generateBiography(
  personId: string
): Promise<{ person: CanonicalPerson }> {
  return apiPost<{ person: CanonicalPerson }>(
    `/admin/entities/persons/${personId}/biography/generate`
  );
}

/**
 * Save/verify biography
 */
export async function saveBiography(
  personId: string,
  data: { biography: string; verify?: boolean }
): Promise<{ person: CanonicalPerson }> {
  return apiPut<{ person: CanonicalPerson }>(
    `/admin/entities/persons/${personId}/biography`,
    data
  );
}

/**
 * Unverify biography (revert to editable state)
 */
export async function unverifyBiography(
  personId: string
): Promise<{ person: CanonicalPerson }> {
  return apiPost<{ person: CanonicalPerson }>(
    `/admin/entities/persons/${personId}/biography/unverify`
  );
}

// ============================================================================
// RELATIONSHIP GRAPH API (Public)
// ============================================================================

export interface GraphNode {
  id: string;
  name: string;
  letterCount: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  relationshipType: PersonRelationshipType;
  confidence: number;
}

export interface RelationshipGraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface PathNode {
  id: string;
  name: string;
}

export interface PathEdge {
  id: string;
  type: string;
}

export interface ConnectionPath {
  path: PathNode[];
  edges: PathEdge[];
  message?: string;
}

/**
 * Get all relationships for graph visualization
 */
export async function getRelationshipGraph(): Promise<RelationshipGraphData> {
  return apiGet<RelationshipGraphData>('/relationships');
}

/**
 * Get relationships for a specific collection
 */
export async function getRelationshipGraphByCollection(
  collectionId: string
): Promise<RelationshipGraphData> {
  return apiGet<RelationshipGraphData>(`/relationships/collection/${collectionId}`);
}

/**
 * Find connection path between two people
 */
export async function findConnectionPath(
  personAId: string,
  personBId: string
): Promise<ConnectionPath> {
  return apiGet<ConnectionPath>(`/relationships/path/${personAId}/${personBId}`);
}

// ============================================================================
// ADMIN RELATIONSHIP API
// ============================================================================

/**
 * Get all relationships for admin view
 */
export async function getAdminRelationships(): Promise<PersonRelationship[]> {
  return apiGet<PersonRelationship[]>('/admin/relationships');
}

/**
 * Create a new relationship (admin)
 */
export async function createAdminRelationship(data: {
  personAId: string;
  personBId: string;
  relationshipType: PersonRelationshipType;
  notes?: string;
  discoveredInLetterId?: string;
  confidence?: number;
}): Promise<PersonRelationship> {
  return apiPost<PersonRelationship>('/admin/relationships', data);
}

/**
 * Update a relationship (admin)
 */
export async function updateAdminRelationship(
  relationshipId: string,
  data: {
    relationshipType?: PersonRelationshipType;
    notes?: string | null;
    confidence?: number;
  }
): Promise<PersonRelationship> {
  return apiPut<PersonRelationship>(`/admin/relationships/${relationshipId}`, data);
}

/**
 * Delete a relationship (admin)
 */
export async function deleteAdminRelationship(relationshipId: string): Promise<void> {
  return apiDelete<void>(`/admin/relationships/${relationshipId}`);
}

// ============================================================================
// DUPLICATE SUGGESTIONS API (Phase 5)
// ============================================================================

export interface DuplicateSuggestion {
  entityAId: string;
  entityAName: string;
  entityALetterCount: number;
  entityAAliases: string[];
  entityBId: string;
  entityBName: string;
  entityBLetterCount: number;
  entityBAliases: string[];
  similarity: number;
}

/**
 * Get AI-suggested duplicate entities
 */
export async function getDuplicateSuggestions(
  entityType: 'person' | 'place',
  limit: number = 20
): Promise<{ suggestions: DuplicateSuggestion[] }> {
  return apiGet<{ suggestions: DuplicateSuggestion[] }>(
    '/admin/entities/suggestions',
    { entityType, limit }
  );
}

// ============================================================================
// BULK MERGE API (Phase 5)
// ============================================================================

/**
 * Bulk merge multiple persons into one
 */
export async function bulkMergePersons(
  keepId: string,
  mergeIds: string[]
): Promise<{ person: CanonicalPerson; message: string }> {
  return apiPost<{ person: CanonicalPerson; message: string }>(
    '/admin/entities/persons/bulk-merge',
    { keepId, mergeIds }
  );
}

/**
 * Bulk merge multiple places into one
 */
export async function bulkMergePlaces(
  keepId: string,
  mergeIds: string[]
): Promise<{ place: CanonicalPlace; message: string }> {
  return apiPost<{ place: CanonicalPlace; message: string }>(
    '/admin/entities/places/bulk-merge',
    { keepId, mergeIds }
  );
}

// ============================================================================
// MERGE DETAILS API (Phase 5)
// ============================================================================

export interface PersonMergeDetails {
  id: string;
  canonicalName: string;
  aliases: string[];
  letterCount: number;
  asSender: number;
  asRecipient: number;
  asMentioned: number;
  relationshipCount: number;
  relationships: Array<{
    personId: string;
    personName: string;
    relationshipType: string;
  }>;
  biography?: string;
  biographyStatus?: ContentStatus;
}

export interface PlaceMergeDetails {
  id: string;
  canonicalName: string;
  aliases: string[];
  placeType?: PlaceType;
  letterCount: number;
  writtenFrom: number;
  destination: number;
  mentioned: number;
}

/**
 * Get detailed info for person merge comparison
 */
export async function getPersonMergeDetails(
  personId: string
): Promise<PersonMergeDetails> {
  return apiGet<PersonMergeDetails>(`/admin/entities/persons/${personId}/merge-details`);
}

/**
 * Get detailed info for place merge comparison
 */
export async function getPlaceMergeDetails(
  placeId: string
): Promise<PlaceMergeDetails> {
  return apiGet<PlaceMergeDetails>(`/admin/entities/places/${placeId}/merge-details`);
}
