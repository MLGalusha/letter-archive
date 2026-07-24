import { sql, type SQLWrapper } from 'drizzle-orm';
import type {
  FrontendLetter,
  FrontendLetterImage,
  FrontendLetterImageType,
  FrontendNotableQuote,
} from '../dto/letter.dto.js';
import type { EmotionalTone, RelationshipType } from '../db/index.js';

/**
 * Public letter responses are projections, not redacted admin responses.
 * Keep this list deliberately small: adding a field here is a publication
 * decision and should be covered by the publication matrix tests.
 */

export interface PublicLetterImage {
  id: string;
  type: FrontendLetterImageType;
  pageNumber?: number;
  imageUrl: string;
  width?: number;
  height?: number;
}

export interface PublicTranscript {
  pages: Array<{
    pageNumber: number;
    text: string;
    confidence?: number;
  }>;
  fullText: string;
  verified: boolean;
}

export interface PublicLetterMetadata {
  sender?: string;
  recipient?: string;
  date?: string;
  dateRaw?: string;
  dateConfidence?: 'exact' | 'unknown' | 'inferred';
  location?: string;
  hook?: string;
  description?: string;
  tags?: string[];
  verified: boolean;
  emotionalTone?: EmotionalTone;
  senderRecipientRelationship?: RelationshipType;
  primaryTopics?: string[];
  notableQuotes?: FrontendNotableQuote[];
}

export interface PublicLinkedPerson {
  personId: string;
  canonicalName: string;
  role: string;
}

export interface PublicLinkedPlace {
  placeId: string;
  canonicalName: string;
  role: string;
}

export interface PublicExtraContentItem {
  type: FrontendLetterImageType;
  label: string;
  transcript: string;
  imageIds: string[];
}

export interface PublicLetter {
  id: string;
  title: string;
  collectionCode?: string;
  images: PublicLetterImage[];
  transcript: PublicTranscript;
  metadata: PublicLetterMetadata;
  status: 'published';
  visibility: 'PUBLISHED';
  transcriptPublished: boolean;
  metadataPublished: boolean;
  transcriptStatus: FrontendLetter['transcriptStatus'];
  metadataContentStatus: FrontendLetter['metadataContentStatus'];
  extraContentStatus: FrontendLetter['extraContentStatus'];
  extraContentTranscript?: string;
  extraContentItems?: PublicExtraContentItem[];
  readingText?: string;
  photoDescription?: string;
  photoDescriptionStatus?: FrontendLetter['photoDescriptionStatus'];
  linkedPersons?: PublicLinkedPerson[];
  linkedPlaces?: PublicLinkedPlace[];
  createdAt: string;
  updatedAt?: string;
}

export interface PublicCollectionSource {
  id: string;
  collectionCode: string;
  title: string | null;
  description: string | null;
  createdAt: Date | string;
  hook: string | null;
  profileStatus: string;
}

export interface PublicCollection {
  id: string;
  collectionCode: string;
  title: string | null;
  description: string | null;
  createdAt: Date | string;
  hook: string | null;
}

export function isPublicLetter<T extends { visibility: string }>(
  state: T,
): state is T & { visibility: 'PUBLISHED' } {
  return state.visibility === 'PUBLISHED';
}

export function isVerifiedPublicContent(status: string | null | undefined): boolean {
  return status === 'VERIFIED';
}

export function toPublicCollection(
  collection: PublicCollectionSource,
  profileSourceCurrent: boolean,
): PublicCollection {
  return {
    id: collection.id,
    collectionCode: collection.collectionCode,
    title: collection.title,
    description: collection.description,
    createdAt: collection.createdAt,
    hook: isVerifiedPublicContent(collection.profileStatus) && profileSourceCurrent
      ? collection.hook
      : null,
  };
}

function projectImage(image: FrontendLetterImage): PublicLetterImage {
  return {
    id: image.id,
    type: image.type,
    pageNumber: image.pageNumber,
    imageUrl: image.imageUrl,
    width: image.width,
    height: image.height,
  };
}

function emptyTranscript(): PublicTranscript {
  return {
    pages: [],
    fullText: '',
    verified: false,
  };
}

function publicTranscript(transcript: FrontendLetter['transcript']): PublicTranscript {
  return {
    pages: transcript.pages.map((page) => ({
      pageNumber: page.pageNumber,
      text: page.text,
      confidence: page.confidence,
    })),
    fullText: transcript.fullText,
    verified: transcript.verified,
  };
}

function publicMetadata(dto: FrontendLetter): PublicLetterMetadata {
  const catalogDate = {
    date: dto.metadata.date,
    dateRaw: dto.metadata.dateRaw,
    dateConfidence: dto.metadata.dateConfidence,
  };

  if (!dto.metadataPublished) {
    return {
      ...catalogDate,
      verified: false,
    };
  }

  return {
    ...catalogDate,
    sender: dto.metadata.sender,
    recipient: dto.metadata.recipient,
    location: dto.metadata.location,
    hook: dto.metadata.hook,
    description: dto.metadata.description,
    tags: dto.metadata.tags,
    emotionalTone: dto.metadata.emotionalTone,
    senderRecipientRelationship: dto.metadata.senderRecipientRelationship,
    primaryTopics: dto.metadata.primaryTopics,
    notableQuotes: dto.metadata.notableQuotes,
    verified: dto.metadata.verified,
  };
}

function publicStatus(
  published: boolean,
  status: FrontendLetter['transcriptStatus'],
): FrontendLetter['transcriptStatus'] {
  return published ? status : 'EMPTY';
}

function genericPublicTitle(images: Array<Pick<FrontendLetterImage, 'type'>>): string {
  const type = images[0]?.type;
  if (!type) return 'Archive item';
  return type.charAt(0).toUpperCase() + type.slice(1);
}

/**
 * Convert the shared/admin letter DTO into the only shape public routes may
 * return. The photo-only exception applies solely to photoDescription; it does
 * not grant access to metadata, transcripts, OCR segments, filenames, notes,
 * verification identities, or extraction internals.
 */
export function toPublicLetter(
  dto: FrontendLetter,
  context: { photoOnly: boolean },
): PublicLetter {
  if (!isPublicLetter(dto)) {
    throw new TypeError('Cannot project a hidden letter through the public read model');
  }

  const metadata = publicMetadata(dto);
  const extraContentPublished = dto.transcriptPublished
    && isVerifiedPublicContent(dto.extraContentStatus);
  const photoDescriptionPublished = context.photoOnly
    && isVerifiedPublicContent(dto.photoDescriptionStatus);

  return {
    id: dto.id,
    title: dto.metadataPublished ? dto.title : genericPublicTitle(dto.images),
    collectionCode: dto.collectionCode,
    images: dto.images.map(projectImage),
    transcript: dto.transcriptPublished ? publicTranscript(dto.transcript) : emptyTranscript(),
    metadata,
    status: 'published',
    visibility: 'PUBLISHED',
    transcriptPublished: dto.transcriptPublished,
    metadataPublished: dto.metadataPublished,
    transcriptStatus: publicStatus(dto.transcriptPublished, dto.transcriptStatus),
    metadataContentStatus: publicStatus(dto.metadataPublished, dto.metadataContentStatus),
    extraContentStatus: publicStatus(extraContentPublished, dto.extraContentStatus),
    ...(extraContentPublished && dto.extraContentTranscript
      ? { extraContentTranscript: dto.extraContentTranscript }
      : {}),
    ...(extraContentPublished && dto.extraContentItems
      ? {
          extraContentItems: dto.extraContentItems.map((item) => ({
            type: item.type,
            label: item.label,
            transcript: item.transcript,
            imageIds: item.imageIds,
          })),
        }
      : {}),
    ...(dto.transcriptPublished && dto.readingText
      ? { readingText: dto.readingText }
      : {}),
    ...(photoDescriptionPublished && dto.photoDescription
      ? {
          photoDescription: dto.photoDescription,
          photoDescriptionStatus: 'VERIFIED' as const,
        }
      : {}),
    ...(dto.metadataPublished && dto.linkedPersons
      ? {
          linkedPersons: dto.linkedPersons.map((person) => ({
            personId: person.personId,
            canonicalName: person.canonicalName,
            role: person.role,
          })),
        }
      : {}),
    ...(dto.metadataPublished && dto.linkedPlaces
      ? {
          linkedPlaces: dto.linkedPlaces.map((place) => ({
            placeId: place.placeId,
            canonicalName: place.canonicalName,
            role: place.role,
          })),
        }
      : {}),
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  };
}

/** SQL counterpart to the in-memory allowlist projection. */
export function publicFieldSql(published: SQLWrapper, value: SQLWrapper) {
  return sql`CASE WHEN ${published} THEN ${value} ELSE NULL END`;
}
