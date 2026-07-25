import type {
  Collection,
  ContentStatus,
  JobStatus,
  Letter,
  VisibilityState,
} from '../db/index.js';
import { transcriptDigest } from '../services/letter/metadata-input-identity.js';
import {
  generateTitle,
  mapTypeToImageType,
  type FrontendLetterImageType,
} from './letter.dto.js';

export interface AdminLetterPageCounts {
  letter: number;
  photo: number;
  cover: number;
  telegram: number;
  card: number;
  ephemera: number;
  voice: number;
  article: number;
  diary: number;
}

export interface AdminLetterSummary {
  id: string;
  title: string;
  collectionCode: string;
  primarySourceRevision: number;
  primaryImageType: FrontendLetterImageType;
  pageCountsByType: AdminLetterPageCounts;
  metadata: {
    sender?: string;
    recipient?: string;
    dateRaw: string;
  };
  visibility: VisibilityState;
  transcriptPublished: boolean;
  metadataPublished: boolean;
  transcriptStatus: ContentStatus;
  metadataContentStatus: ContentStatus;
  extraContentStatus: ContentStatus;
  photoDescriptionStatus: ContentStatus;
  metadataJobStatus: JobStatus;
  transcriptDigest: string;
  transcriptConfirmed: boolean;
  flagged: boolean;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt?: string;
}

export type AdminLetterSummarySource = Pick<
  Letter,
  | 'id'
  | 'collectionId'
  | 'dateRaw'
  | 'extractedDate'
  | 'type'
  | 'typeSequence'
  | 'sender'
  | 'recipient'
  | 'primarySourceRevision'
  | 'visibility'
  | 'transcriptPublished'
  | 'metadataPublished'
  | 'transcriptStatus'
  | 'metadataContentStatus'
  | 'extraContentStatus'
  | 'photoDescriptionStatus'
  | 'metadataStatus'
  | 'transcriptionText'
  | 'transcriptConfirmedAt'
  | 'flagged'
  | 'createdAt'
  | 'updatedAt'
> & {
  collection: Pick<Collection, 'collectionCode' | 'title'>;
};

export function emptyAdminLetterPageCounts(): AdminLetterPageCounts {
  return {
    letter: 0,
    photo: 0,
    cover: 0,
    telegram: 0,
    card: 0,
    ephemera: 0,
    voice: 0,
    article: 0,
    diary: 0,
  };
}

export function transformAdminLetterSummary(
  letter: AdminLetterSummarySource,
  pageCountsByType: AdminLetterPageCounts,
  lastOpenedAt?: string,
): AdminLetterSummary {
  return {
    id: letter.id,
    title: generateTitle(letter, letter.collection),
    collectionCode: letter.collection.collectionCode,
    primarySourceRevision: letter.primarySourceRevision,
    primaryImageType: mapTypeToImageType(letter.type),
    pageCountsByType,
    metadata: {
      ...(letter.sender !== null ? { sender: letter.sender } : {}),
      ...(letter.recipient !== null ? { recipient: letter.recipient } : {}),
      dateRaw: letter.dateRaw,
    },
    visibility: letter.visibility,
    transcriptPublished: letter.transcriptPublished,
    metadataPublished: letter.metadataPublished,
    transcriptStatus: letter.transcriptStatus,
    metadataContentStatus: letter.metadataContentStatus,
    extraContentStatus: letter.extraContentStatus,
    photoDescriptionStatus: letter.photoDescriptionStatus,
    metadataJobStatus: letter.metadataStatus,
    transcriptDigest: transcriptDigest(letter.transcriptionText ?? ''),
    transcriptConfirmed: letter.transcriptConfirmedAt !== null,
    flagged: letter.flagged,
    createdAt: letter.createdAt.toISOString(),
    updatedAt: letter.updatedAt.toISOString(),
    ...(lastOpenedAt !== undefined ? { lastOpenedAt } : {}),
  };
}
