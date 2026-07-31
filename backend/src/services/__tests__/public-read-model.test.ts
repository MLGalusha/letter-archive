import { describe, expect, it } from 'vitest';
import type { FrontendLetter } from '../../dto/letter.dto.js';
import type { PublicLetterMetadata } from '../public-read-model.js';
import {
  isPublicLetter,
  toPublicCollection,
  toPublicLetter,
} from '../public-read-model.js';

function makeLetter(overrides: Partial<FrontendLetter> = {}): FrontendLetter {
  return {
    id: 'letter-1',
    title: 'Secret title from Alice to Bob',
    collectionCode: '009',
    primarySourceRevision: 0,
    transcriptRevision: 0,
    transcriptChecksumSha256:
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    images: [{
      id: 'page-1',
      type: 'letter',
      pageNumber: 1,
      imageUrl: '/images/page-1',
      originalFilename: 'private-scan-name.jpg',
      lineSegments: [{
        line: 1,
        baseline: [[0, 0], [1, 1]],
        bbox: [0, 0, 1, 1],
        ocrText: 'private OCR',
      }],
      pageLayout: { schemaVersion: 2 } as never,
      pageLayoutChecksumSha256: 'a'.repeat(64),
      segmentTrustState: 'trusted',
    }],
    transcript: {
      pages: [{ pageNumber: 1, text: 'private transcript' }],
      fullText: 'private transcript',
      verified: true,
      structuredPages: [{ pageNumber: 1, lines: [] }],
    },
    metadata: {
      sender: 'Alice',
      recipient: 'Bob',
      date: 'August 10, 1947',
      dateRaw: '19470810',
      dateConfidence: 'exact',
      location: 'Private Place',
      hook: 'private hook',
      description: 'private summary',
      taggedHook: 'private tagged hook',
      taggedDescription: 'private tagged summary',
      tags: ['private tag'],
      notes: 'private reviewer note',
      verified: true,
      verifiedBy: 'admin-user-id',
      verifiedAt: '2026-01-01T00:00:00.000Z',
      firstPageFilename: 'private-scan-name.jpg',
      emotionalTone: 'hopeful',
      senderRecipientRelationship: 'friend',
      primaryTopics: ['private topic'],
      notableQuotes: [{ text: 'private quote' }],
    },
    status: 'published',
    workflowState: 'REVIEWED',
    metadataJobStatus: 'SUCCESS',
    visibility: 'PUBLISHED',
    transcriptPublished: false,
    metadataPublished: false,
    transcriptStatus: 'VERIFIED',
    metadataContentStatus: 'VERIFIED',
    transcriptVerifiedAt: '2026-01-01T00:00:00.000Z',
    transcriptVerifiedBy: 'transcript-admin',
    metadataVerifiedAt: '2026-01-01T00:00:00.000Z',
    metadataVerifiedBy: 'metadata-admin',
    extraContentTranscript: 'private extra transcript',
    extraContentItems: [{
      type: 'cover',
      label: 'Cover',
      transcript: 'private cover transcript',
      imageIds: ['cover-page'],
    }],
    extraContentStatus: 'VERIFIED',
    extraContentVerifiedAt: '2026-01-01T00:00:00.000Z',
    extraContentVerifiedBy: 'extra-admin',
    photoDescription: 'private photo description',
    photoDescriptionStatus: 'VERIFIED',
    photoDescriptionVerifiedAt: '2026-01-01T00:00:00.000Z',
    photoDescriptionVerifiedBy: 'photo-admin',
    photoDescriptionContext: 'private prompt context',
    aiNotes: [{ content: 'private AI note' }],
    readingText: 'private reading view',
    transcriptConfirmedAt: '2026-01-01T00:00:00.000Z',
    transcriptConfirmationId: '38000000-0000-4000-8000-000000000001',
    flagged: true,
    flaggedAt: '2026-01-01T00:00:00.000Z',
    flaggedBy: 'flag-admin',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    entityExtractionStatus: 'SUCCESS',
    entityExtractionJson: { private: true },
    entityExtractionError: 'private extraction error',
    linkedPersons: [{
      id: 'link-1',
      personId: 'person-1',
      canonicalName: 'Alice',
      role: 'sender',
      nameAsWritten: 'A.',
      relationshipToSender: 'self',
      context: 'private person context',
      confidence: 99,
    }],
    linkedPlaces: [{
      id: 'place-link-1',
      placeId: 'place-1',
      canonicalName: 'Private Place',
      role: 'written_from',
      context: 'private place context',
      confidence: 88,
    }],
    ...overrides,
  };
}

describe('public letter read model', () => {
  it('defines public metadata as a positive allowlist', () => {
    const acceptPublicMetadata = (metadata: PublicLetterMetadata) => metadata;

    expect(acceptPublicMetadata({
      sender: 'Alice',
      verified: true,
    })).toEqual({ sender: 'Alice', verified: true });

    // @ts-expect-error Reviewer notes are not part of the public contract.
    acceptPublicMetadata({ verified: true, notes: 'private reviewer note' });
    // @ts-expect-error Verification identities are not part of the public contract.
    acceptPublicMetadata({ verified: true, verifiedBy: 'admin-user-id' });
    // @ts-expect-error Source filenames are not part of the public contract.
    acceptPublicMetadata({ verified: true, firstPageFilename: 'private-scan-name.jpg' });
  });

  it('excludes hidden rows at the public visibility predicate', () => {
    expect(isPublicLetter({ visibility: 'HIDDEN' })).toBe(false);
    expect(isPublicLetter({ visibility: 'PUBLISHED' })).toBe(true);
  });

  it('refuses to project hidden content even when publication flags remain set', () => {
    expect(() => toPublicLetter(makeLetter({
      visibility: 'HIDDEN',
      transcriptPublished: true,
      metadataPublished: true,
    }), { photoOnly: false })).toThrow('Cannot project a hidden letter through the public read model');
  });

  it('publishes only the catalogue shell when both content flags are off', () => {
    const result = toPublicLetter(makeLetter(), { photoOnly: false });

    expect(result.title).toBe('Letter');
    expect(result.metadata).toEqual({
      date: 'August 10, 1947',
      dateRaw: '19470810',
      dateConfidence: 'exact',
      verified: false,
    });
    expect(result.transcript).toEqual({ pages: [], fullText: '', verified: false });
    expect(result.transcriptStatus).toBe('EMPTY');
    expect(result.metadataContentStatus).toBe('EMPTY');
    expect(result.extraContentStatus).toBe('EMPTY');
    expect(result.images[0]).toEqual({
      id: 'page-1',
      type: 'letter',
      pageNumber: 1,
      imageUrl: '/images/page-1',
      width: undefined,
      height: undefined,
    });

    for (const privateField of [
      'aiNotes',
      'entityExtractionJson',
      'entityExtractionStatus',
      'flagged',
      'linkedPersons',
      'linkedPlaces',
      'photoDescription',
      'photoDescriptionContext',
      'transcriptVerifiedBy',
      'metadataVerifiedBy',
      'metadataJobStatus',
      'transcriptConfirmationId',
      'workflowState',
    ]) {
      expect(result).not.toHaveProperty(privateField);
    }
    expect(result.images[0]).not.toHaveProperty('originalFilename');
    expect(result.images[0]).not.toHaveProperty('lineSegments');
    expect(result.images[0]).not.toHaveProperty('pageLayout');
    expect(result.images[0]).not.toHaveProperty('pageLayoutChecksumSha256');
    expect(result.metadata).not.toHaveProperty('notes');
    expect(result.metadata).not.toHaveProperty('taggedHook');
    expect(result.metadata).not.toHaveProperty('verifiedBy');
    expect(result.metadata).not.toHaveProperty('firstPageFilename');
  });

  it('publishes transcript content without leaking metadata content', () => {
    const result = toPublicLetter(makeLetter({ transcriptPublished: true }), { photoOnly: false });

    expect(result.transcript.fullText).toBe('private transcript');
    expect(result.transcript).not.toHaveProperty('structuredPages');
    expect(result.extraContentTranscript).toBe('private extra transcript');
    expect(result.readingText).toBe('private reading view');
    expect(result.metadata.sender).toBeUndefined();
    expect(result.linkedPersons).toBeUndefined();
  });

  it('keeps unverified extra content private when the main transcript is public', () => {
    const result = toPublicLetter(makeLetter({
      transcriptPublished: true,
      extraContentStatus: 'AI_DRAFT',
    }), { photoOnly: false });

    expect(result.transcript.fullText).toBe('private transcript');
    expect(result.extraContentStatus).toBe('EMPTY');
    expect(result.extraContentTranscript).toBeUndefined();
    expect(result.extraContentItems).toBeUndefined();
  });

  it('publishes metadata content and minimal discovery links without transcript content', () => {
    const result = toPublicLetter(makeLetter({ metadataPublished: true }), { photoOnly: false });

    expect(result.title).toBe('Secret title from Alice to Bob');
    expect(result.metadata.sender).toBe('Alice');
    expect(result.metadata.notableQuotes).toEqual([{ text: 'private quote' }]);
    expect(result.transcript.fullText).toBe('');
    expect(result.extraContentTranscript).toBeUndefined();
    expect(result.linkedPersons).toEqual([{
      personId: 'person-1',
      canonicalName: 'Alice',
      role: 'sender',
    }]);
    expect(result.linkedPlaces).toEqual([{
      placeId: 'place-1',
      canonicalName: 'Private Place',
      role: 'written_from',
    }]);
  });

  it('keeps empty admin metadata omitted from the serialized public contract', () => {
    const result = toPublicLetter(makeLetter({
      metadataPublished: true,
      metadata: {
        sender: '',
        recipient: '',
        location: '',
        hook: '',
        description: '',
        verified: true,
      },
    }), { photoOnly: false });

    expect(JSON.parse(JSON.stringify(result.metadata))).toEqual({
      verified: true,
    });
  });

  it('publishes both tracks when both flags are on but still omits admin-only fields', () => {
    const result = toPublicLetter(makeLetter({
      transcriptPublished: true,
      metadataPublished: true,
    }), { photoOnly: false });

    expect(result.metadata.sender).toBe('Alice');
    expect(result.transcript.fullText).toBe('private transcript');
    expect(result).not.toHaveProperty('aiNotes');
    expect(result.metadata).not.toHaveProperty('notes');
    expect(result.images[0]).not.toHaveProperty('lineSegments');
  });

  it('applies the photo exception only to photo-only description content', () => {
    const photo = makeLetter({
      images: [{ id: 'photo-1', type: 'photo', imageUrl: '/images/photo-1' }],
    });
    const photoResult = toPublicLetter(photo, { photoOnly: true });
    expect(photoResult.photoDescription).toBe('private photo description');
    expect(photoResult.metadata.sender).toBeUndefined();
    expect(photoResult).not.toHaveProperty('photoDescriptionContext');

    const companionResult = toPublicLetter(makeLetter({
      images: [
        { id: 'letter-page', type: 'letter', imageUrl: '/images/letter-page' },
        { id: 'photo-page', type: 'photo', imageUrl: '/images/photo-page' },
      ],
    }), { photoOnly: false });
    expect(companionResult.photoDescription).toBeUndefined();
  });

  it('uses catalogue-unit types rather than page presence for the photo exception', () => {
    const photoImagesWithNonPhotoPeer = toPublicLetter(makeLetter({
      images: [{ id: 'photo-1', type: 'photo', imageUrl: '/images/photo-1' }],
    }), { photoOnly: false });
    expect(photoImagesWithNonPhotoPeer.photoDescription).toBeUndefined();

    const imageLessPhotoUnit = toPublicLetter(makeLetter({
      images: [],
    }), { photoOnly: true });
    expect(imageLessPhotoUnit.photoDescription).toBe('private photo description');
  });

  it('keeps an unverified photo description private', () => {
    const result = toPublicLetter(makeLetter({
      images: [{ id: 'photo-1', type: 'photo', imageUrl: '/images/photo-1' }],
      photoDescriptionStatus: 'AI_DRAFT',
    }), { photoOnly: true });

    expect(result.photoDescription).toBeUndefined();
    expect(result.photoDescriptionStatus).toBeUndefined();
  });
});

describe('public collection read model', () => {
  it('publishes only stable collection fields and a verified profile hook', () => {
    const source = {
      id: 'collection-9',
      collectionCode: '009',
      title: 'Collection Nine',
      description: 'Public description',
      createdAt: '2026-01-01T00:00:00.000Z',
      hook: 'Profile hook',
      profileStatus: 'AI_DRAFT',
      profileNarrative: 'Private generated narrative',
      profileThemes: ['private'],
    };

    expect(toPublicCollection(source, false)).toEqual({
      id: 'collection-9',
      collectionCode: '009',
      title: 'Collection Nine',
      description: 'Public description',
      createdAt: '2026-01-01T00:00:00.000Z',
      hook: null,
    });
    expect(toPublicCollection(
      { ...source, profileStatus: 'VERIFIED' },
      true,
    ).hook).toBe('Profile hook');
    expect(toPublicCollection(
      { ...source, profileStatus: 'VERIFIED' },
      false,
    ).hook).toBeNull();
  });
});
