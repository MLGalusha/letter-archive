/**
 * Collections API service
 */

import { apiGet, apiPut, apiPost } from './client';
import type { Letter, PublicLetter } from '../types/Letter';

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
  letters: PublicLetter[];
  profileNarrative?: string | null;
  profileStatus?: ContentStatus;
  profileStartHereLetterId?: string | null;
  profileCorrespondents?: CollectionProfileCorrespondent[];
}

/** Admin collection detail is independent from the public response contract. */
export interface AdminCollectionWithLetters {
  id: string;
  collectionCode: string;
  title: string | null;
  description: string | null;
  createdAt: string;
  profileRevision: number;
  identityFingerprint: string;
  letterCount: number;
  hook?: string | null;
  letters: Letter[];
  profileNarrative?: string | null;
  profileStatus?: ContentStatus;
  profileStartHereLetterId?: string | null;
  profileCorrespondents?: CollectionProfileCorrespondent[];
}

export interface AdminCollectionInfo {
  id: string;
  collectionCode: string;
  title: string | null;
  description: string | null;
  createdAt: string;
  profileRevision: number;
  letterCount?: number;
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

/**
 * Fetch all collections (public - only shows published letter counts)
 */
export async function listCollections(): Promise<CollectionInfo[]> {
  return apiGet<CollectionInfo[]>('/collections');
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
export async function getAdminCollectionByCode(code: string): Promise<AdminCollectionWithLetters> {
  return apiGet<AdminCollectionWithLetters>(`/admin/collections/${code}`);
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
  profileRevision: number;
  isStub: boolean;
}

export interface CollectionProfileMutationResult {
  profileRevision: number;
}

export interface CollectionEditorMutation {
  profileRevision: number;
  identityFingerprint: string;
  hook?: string | null;
  profileNarrative?: string;
  profileStartHereLetterId?: string | null;
  profileCorrespondents?: CollectionProfileCorrespondent[];
  description?: string | null;
  correspondentRenames: Array<{
    oldName: string;
    newName: string;
    roles: Array<'sender' | 'recipient'>;
  }>;
}

export interface CollectionEditorMutationResult {
  profileRevision: number;
  identityFingerprint: string;
  updatedLetterCount: number;
  changed: boolean;
}

/** Persist the collection editor's complete Update action atomically. */
export async function updateCollectionEditor(
  code: string,
  data: CollectionEditorMutation,
): Promise<CollectionEditorMutationResult> {
  return apiPut<CollectionEditorMutationResult>(
    `/admin/collections/${code}/editor`,
    data,
  );
}

/** Get data completeness before generating profile */
export async function getCollectionCompleteness(code: string): Promise<CollectionCompleteness> {
  return apiGet<CollectionCompleteness>(`/admin/collections/${code}/profile/completeness`);
}

/** Generate (or regenerate) a collection profile via AI */
export async function generateCollectionProfile(
  code: string,
  profileRevision: number,
  force = false,
): Promise<GenerateProfileResult> {
  return apiPost<GenerateProfileResult>(`/admin/collections/${code}/generate-profile`, {
    force,
    profileRevision,
  });
}

/** Update profile content and/or status */
export async function updateCollectionProfile(
  code: string,
  data: {
    profileRevision: number;
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
): Promise<CollectionProfileMutationResult> {
  return apiPut<CollectionProfileMutationResult>(`/admin/collections/${code}/profile`, data);
}

/** Reset a collection profile back to EMPTY, clearing all generated content */
export async function resetCollectionProfile(
  code: string,
  profileRevision: number,
): Promise<CollectionProfileMutationResult> {
  return updateCollectionProfile(code, { profileRevision, profileStatus: 'EMPTY' });
}

/** Get the full public collection profile (AI + aggregations) */
export async function getCollectionProfile(code: string): Promise<CollectionProfile> {
  return apiGet<CollectionProfile>(`/collections/${code}/profile`);
}
