import type {
  Collection,
  Letter,
} from '../db/index.js';
import type {
  AdminLetterPageCountsByType,
  AdminLetterSummary as AdminLetterSummaryContract,
} from '../contracts/admin-wire-contracts.js';
import { transcriptDigest } from '../services/letter/metadata-input-identity.js';
import {
  generateTitle,
  mapTypeToImageType,
} from './letter.dto.js';

export type AdminLetterPageCounts = {
  -readonly [Type in keyof AdminLetterPageCountsByType]: number;
};
export type AdminLetterSummary = AdminLetterSummaryContract;

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
