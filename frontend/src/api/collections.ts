/**
 * Collections API service
 */

import { apiGet, apiPut, apiPost, apiPatch } from './client';
import type { Letter } from '../types/Letter';

export interface CollectionInfo {
  id: string;
  collectionCode: string;
  title: string | null;
  description: string | null;
  createdAt: string;
  letterCount?: number;
  hook?: string | null;
  dateRange?: { min: string; max: string } | null;
  primarySender?: string | null;
  primaryRecipient?: string | null;
}

export interface CollectionWithLetters extends CollectionInfo {
  letters: Letter[];
  profileNarrative?: string | null;
  profileStatus?: ContentStatus;
  profileStartHereLetterId?: string | null;
  profileCorrespondents?: CollectionProfileCorrespondent[];
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
  minDate: string | null;     // Earliest dateRaw (YYYYMMDD format), prefers specific dates
  maxDate: string | null;     // Latest dateRaw (YYYYMMDD format), prefers specific dates
  minDateSpecific: boolean;   // true if minDate has no X placeholders
  maxDateSpecific: boolean;   // true if maxDate has no X placeholders
  // Profile
  profileStatus?: ContentStatus;
  hook?: string | null;
  highlightImageId?: string | null;
  // Per-type counts
  typeCounts: {
    letter: number;
    photo: number;
    cover: number;
    telegram: number;
    card: number;
    ephemera: number;
    voice: number;
    article: number;
    diary: number;
  };
}

let cachedPublicCollections: CollectionInfo[] | null = null;
let pendingPublicCollections: Promise<CollectionInfo[]> | null = null;

function storePublicCollections(data: CollectionInfo[]): CollectionInfo[] {
  cachedPublicCollections = data;
  pendingPublicCollections = null;
  return data;
}

export function getCachedCollections(): CollectionInfo[] | null {
  return cachedPublicCollections;
}

/**
 * Fetch all collections (public - only shows published letter counts)
 */
export async function listCollections(): Promise<CollectionInfo[]> {
  if (cachedPublicCollections) return Promise.resolve(cachedPublicCollections);
  if (pendingPublicCollections) return pendingPublicCollections;

  pendingPublicCollections = apiGet<CollectionInfo[]>('/collections')
    .then(storePublicCollections)
    .catch((error) => {
      pendingPublicCollections = null;
      throw error;
    });

  return pendingPublicCollections;
}

export function prefetchCollections(): void {
  if (cachedPublicCollections || pendingPublicCollections) return;
  void listCollections().catch(() => {});
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

// ============================================================================
// COLLECTION PROFILE
// ============================================================================

export interface CollectionCompleteness {
  totalLetters: number;
  publishedLetters: number;
  withTranscripts: number;
  withMetadata: number;
  withEmotionalTone: number;
  withTopics: number;
  completenessScore: number;
  warnings: string[];
}

export interface ReadingPath {
  title: string;
  description: string;
  letterIds: string[];
}

export interface GapAnalysis {
  startDate: string;
  endDate: string;
  description: string;
}

export interface ThemeGroup {
  name: string;
  description: string;
  letterIds: string[];
}

export interface SentimentPoint {
  date: string;
  tone: string;
  letterId: string;
}

export interface TopicPoint {
  date: string;
  topics: string[];
  letterId: string;
}

export interface NetworkNode {
  id: string;
  name: string;
  letterCount: number;
  biography: string | null;
}

export interface NetworkEdge {
  source: string;
  target: string;
  count: number;
  type: string | null;
}

export interface OnThisDayEntry {
  letterId: string;
  date: string;
  hook: string | null;
  sender: string | null;
  recipient: string | null;
  yearsAgo: number;
}

export interface KeyPerson {
  id: string;
  name: string;
  biography: string | null;
  hook: string | null;
  letterCount: number;
  roles: { sender: number; recipient: number };
}

export interface FormatCount {
  type: string;
  label: string;
  count: number;
}

export interface CollectionProfileCorrespondent {
  name: string;
  biography: string | null;
  hook: string | null;
}

export type ContentStatus = 'EMPTY' | 'AI_DRAFT' | 'EDITED' | 'VERIFIED';

export interface CollectionProfile {
  // AI-generated
  hook: string | null;
  narrative: string | null;
  profileStatus: ContentStatus;
  startHere: { letterId: string; reason: string; hook: string | null; date: string | null } | null;
  readingPaths: ReadingPath[];
  gapAnalysis: GapAnalysis[];
  themes: ThemeGroup[];
  profileCorrespondents: CollectionProfileCorrespondent[];
  // Computed aggregations
  sentimentArc: SentimentPoint[];
  topicEvolution: TopicPoint[];
  correspondenceNetwork: { nodes: NetworkNode[]; edges: NetworkEdge[] };
  onThisDay: OnThisDayEntry[];
  keyPeople: KeyPerson[];
  formatBreakdown: FormatCount[];
  dateRange: { start: string; end: string } | null;
  letterCount: number;
}

export interface GenerateProfileResult {
  hook: string;
  narrative: string;
  correspondents: CollectionProfileCorrespondent[];
  profileStatus: ContentStatus;
  isStub: boolean;
}

/** Get data completeness before generating profile */
export async function getCollectionCompleteness(code: string): Promise<CollectionCompleteness> {
  return apiGet<CollectionCompleteness>(`/admin/collections/${code}/profile/completeness`);
}

/** Generate (or regenerate) a collection profile via AI */
export async function generateCollectionProfile(code: string, force = false): Promise<GenerateProfileResult> {
  return apiPost<GenerateProfileResult>(`/admin/collections/${code}/generate-profile`, { force });
}

/** Update profile content and/or status */
export async function updateCollectionProfile(
  code: string,
  data: {
    hook?: string | null;
    profileNarrative?: string;
    profileStartHereLetterId?: string | null;
    profileStartHereReason?: string;
    profileReadingPaths?: ReadingPath[];
    profileGapAnalysis?: GapAnalysis[];
    profileThemes?: ThemeGroup[];
    profileCorrespondents?: CollectionProfileCorrespondent[];
    profileStatus?: 'EMPTY' | 'AI_DRAFT' | 'EDITED' | 'VERIFIED';
    highlightImageId?: string | null;
  },
): Promise<AdminCollectionInfo> {
  return apiPut<AdminCollectionInfo>(`/admin/collections/${code}/profile`, data);
}

/** Reset a collection profile back to EMPTY, clearing all generated content */
export async function resetCollectionProfile(code: string): Promise<AdminCollectionInfo> {
  return updateCollectionProfile(code, { profileStatus: 'EMPTY' });
}

export async function renameCollectionCorrespondent(
  code: string,
  data: {
    oldName: string;
    newName: string;
    roles: Array<'sender' | 'recipient'>;
  },
): Promise<{ updatedCount: number; message: string }> {
  return apiPatch<{ updatedCount: number; message: string }>(`/admin/collections/${code}/correspondents`, data);
}

/** Get the full public collection profile (AI + aggregations) */
export async function getCollectionProfile(code: string): Promise<CollectionProfile> {
  return apiGet<CollectionProfile>(`/collections/${code}/profile`);
}
