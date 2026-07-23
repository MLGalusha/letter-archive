import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invokeRouter } from '../../test/express-test-utils.js';

const {
  getCanonicalPersonByIdMock,
  getLettersForPersonEnrichedMock,
  getRelationshipsForPersonMock,
  getCanonicalPlaceByIdMock,
  getLettersForPlaceEnrichedMock,
} = vi.hoisted(() => ({
  getCanonicalPersonByIdMock: vi.fn(),
  getLettersForPersonEnrichedMock: vi.fn(),
  getRelationshipsForPersonMock: vi.fn(),
  getCanonicalPlaceByIdMock: vi.fn(),
  getLettersForPlaceEnrichedMock: vi.fn(),
}));

vi.mock('../../services/entities.js', () => ({
  getCanonicalPersonById: getCanonicalPersonByIdMock,
  getLettersForPersonEnriched: getLettersForPersonEnrichedMock,
  getRelationshipsForPerson: getRelationshipsForPersonMock,
  getCanonicalPlaceById: getCanonicalPlaceByIdMock,
  getLettersForPlaceEnriched: getLettersForPlaceEnrichedMock,
}));

import personsRouter from '../persons.js';
import placesRouter from '../places.js';

describe('public entity route integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    getCanonicalPersonByIdMock.mockResolvedValue({
      id: 'person-1',
      canonicalName: 'Alice Smith',
      aliases: ['Al'],
      biography: 'Alice biography',
      biographyStatus: 'VERIFIED',
    });
    getLettersForPersonEnrichedMock.mockResolvedValue([
      {
        letterId: 'letter-2',
        collectionId: 'collection-1',
        typeSequence: 2,
        type: 'L',
        dateRaw: '19470811',
        letterDate: '1947-08-11',
        role: 'recipient',
        sender: 'Bob Baker',
        recipient: 'Alice Smith',
        hook: 'Second letter',
        summary: 'Hidden summary',
        visibility: 'HIDDEN',
        metadataPublished: true,
        entityProjectionTrusted: true,
      },
      {
        letterId: 'photo-alias-for-letter-1',
        collectionId: 'collection-1',
        typeSequence: 1,
        type: 'P',
        dateRaw: '19470810',
        letterDate: '1947-08-10',
        role: 'mentioned',
        sender: 'Wrong Photo Sender',
        recipient: 'Wrong Photo Recipient',
        hook: 'Photo alias',
        summary: 'Must collapse behind the letter',
        visibility: 'PUBLISHED',
        metadataPublished: true,
        entityProjectionTrusted: true,
      },
      {
        letterId: 'letter-1',
        collectionId: 'collection-1',
        typeSequence: 1,
        type: 'L',
        dateRaw: '19470810',
        letterDate: '1947-08-10',
        role: 'sender',
        sender: 'Alice Smith',
        recipient: 'Bob Baker',
        hook: 'First letter',
        summary: 'First summary',
        visibility: 'PUBLISHED',
        metadataPublished: true,
        entityProjectionTrusted: true,
      },
      {
        letterId: 'letter-3',
        collectionId: 'collection-1',
        typeSequence: 3,
        type: 'L',
        dateRaw: '19470812',
        letterDate: '1947-08-12',
        role: 'mentioned',
        sender: 'Clara Jones',
        recipient: 'David Stone',
        hook: 'Third letter',
        summary: 'Third summary',
        visibility: 'PUBLISHED',
        metadataPublished: true,
        entityProjectionTrusted: true,
      },
      {
        letterId: 'letter-unpublished-metadata',
        collectionId: 'collection-1',
        typeSequence: 4,
        type: 'L',
        dateRaw: '19470813',
        letterDate: '1947-08-13',
        role: 'sender',
        sender: 'Private Sender',
        recipient: 'Private Recipient',
        hook: 'Private hook',
        summary: 'Private summary',
        visibility: 'PUBLISHED',
        metadataPublished: false,
        entityProjectionTrusted: true,
      },
      {
        letterId: 'letter-uncommitted-projection',
        collectionId: 'collection-1',
        typeSequence: 5,
        type: 'L',
        dateRaw: '19470815',
        letterDate: '1947-08-15',
        role: 'recipient',
        sender: 'Partial Sender',
        recipient: 'Alice Smith',
        hook: 'Partial extraction',
        summary: 'Must not leak',
        visibility: 'PUBLISHED',
        metadataPublished: true,
        entityProjectionTrusted: false,
      },
      {
        letterId: 'standalone-cover',
        collectionId: 'collection-1',
        typeSequence: 6,
        type: 'C',
        dateRaw: '19470814',
        letterDate: '1947-08-14',
        role: 'mentioned',
        sender: 'Private Cover Sender',
        recipient: 'Private Cover Recipient',
        hook: 'Supplementary-only hook',
        summary: 'Supplementary-only summary',
        visibility: 'PUBLISHED',
        metadataPublished: true,
        entityProjectionTrusted: true,
      },
    ]);
    getRelationshipsForPersonMock.mockResolvedValue([
      {
        id: 'rel-1',
        personAId: 'person-1',
        personBId: 'person-2',
        personAName: 'Alice Smith',
        personBName: 'Bob Baker',
        relationshipType: 'friend',
        confirmedAt: new Date('2026-01-01T00:00:00.000Z'),
        discoveredRelationshipTrusted: true,
        relatedPersonHasPublicMetadata: true,
      },
      {
        id: 'rel-2',
        personAId: 'person-3',
        personBId: 'person-1',
        personAName: 'Clara Jones',
        personBName: 'Alice Smith',
        relationshipType: 'sibling',
        confirmedAt: new Date('2026-01-01T00:00:00.000Z'),
        discoveredRelationshipTrusted: true,
        relatedPersonHasPublicMetadata: true,
      },
      {
        id: 'rel-supplementary-discovery',
        personAId: 'person-1',
        personBId: 'person-4',
        personAName: 'Alice Smith',
        personBName: 'Supplement Person',
        relationshipType: 'friend',
        confirmedAt: null,
        discoveredLetterVisibility: 'PUBLISHED',
        discoveredLetterMetadataPublished: true,
        discoveredLetterIsPublicCatalogueRoot: false,
        discoveredRelationshipTrusted: true,
        relatedPersonHasPublicMetadata: true,
      },
      {
        id: 'rel-uncommitted-discovery',
        personAId: 'person-1',
        personBId: 'person-5',
        personAName: 'Alice Smith',
        personBName: 'Partial Person',
        relationshipType: 'friend',
        confirmedAt: null,
        discoveredLetterVisibility: 'PUBLISHED',
        discoveredLetterMetadataPublished: true,
        discoveredLetterIsPublicCatalogueRoot: true,
        discoveredRelationshipTrusted: false,
        relatedPersonHasPublicMetadata: true,
      },
    ]);

    getCanonicalPlaceByIdMock.mockResolvedValue({
      id: 'place-1',
      canonicalName: 'Vienna',
      aliases: ['Wien'],
      placeType: 'city',
      notes: 'Historic capital [THEMES: music, travel]',
    });
    getLettersForPlaceEnrichedMock.mockResolvedValue([
      {
        letterId: 'place-letter-2',
        collectionId: 'collection-1',
        typeSequence: 2,
        type: 'L',
        dateRaw: '19470811',
        letterDate: '1947-08-11',
        role: 'destination',
        sender: 'Alice Smith',
        recipient: 'Bob Baker',
        hook: 'Trip planning',
        summary: 'Hidden destination',
        visibility: 'HIDDEN',
        metadataPublished: true,
        entityProjectionTrusted: true,
      },
      {
        letterId: 'place-photo-alias-for-letter-1',
        collectionId: 'collection-1',
        typeSequence: 1,
        type: 'P',
        dateRaw: '19470810',
        letterDate: '1947-08-10',
        role: 'mentioned',
        sender: 'Wrong Photo Sender',
        recipient: 'Wrong Photo Recipient',
        hook: 'Photo alias',
        summary: 'Must collapse behind the letter',
        visibility: 'PUBLISHED',
        metadataPublished: true,
        entityProjectionTrusted: true,
      },
      {
        letterId: 'place-letter-3',
        collectionId: 'collection-1',
        typeSequence: 3,
        type: 'L',
        dateRaw: '19470812',
        letterDate: '1947-08-12',
        role: 'mentioned',
        sender: 'Alice Smith',
        recipient: 'Bob Baker',
        hook: 'Mentioned city',
        summary: 'Mention summary',
        visibility: 'PUBLISHED',
        metadataPublished: true,
        entityProjectionTrusted: true,
      },
      {
        letterId: 'place-letter-1',
        collectionId: 'collection-1',
        typeSequence: 1,
        type: 'L',
        dateRaw: '19470810',
        letterDate: '1947-08-10',
        role: 'written_from',
        sender: 'Alice Smith',
        recipient: 'Bob Baker',
        hook: 'Written from Vienna',
        summary: 'Travel summary',
        visibility: 'PUBLISHED',
        metadataPublished: true,
        entityProjectionTrusted: true,
      },
      {
        letterId: 'place-unpublished-metadata',
        collectionId: 'collection-1',
        typeSequence: 4,
        type: 'L',
        dateRaw: '19470813',
        letterDate: '1947-08-13',
        role: 'written_from',
        sender: 'Private Sender',
        recipient: 'Private Recipient',
        hook: 'Private place hook',
        summary: 'Private place summary',
        visibility: 'PUBLISHED',
        metadataPublished: false,
        entityProjectionTrusted: true,
      },
      {
        letterId: 'place-uncommitted-projection',
        collectionId: 'collection-1',
        typeSequence: 5,
        type: 'L',
        dateRaw: '19470815',
        letterDate: '1947-08-15',
        role: 'destination',
        sender: 'Alice Smith',
        recipient: 'Partial Recipient',
        hook: 'Partial extraction',
        summary: 'Must not leak',
        visibility: 'PUBLISHED',
        metadataPublished: true,
        entityProjectionTrusted: false,
      },
      {
        letterId: 'standalone-place-card',
        collectionId: 'collection-1',
        typeSequence: 6,
        type: 'N',
        dateRaw: '19470814',
        letterDate: '1947-08-14',
        role: 'mentioned',
        sender: 'Private Card Sender',
        recipient: 'Private Card Recipient',
        hook: 'Supplementary-only place hook',
        summary: 'Supplementary-only place summary',
        visibility: 'PUBLISHED',
        metadataPublished: true,
        entityProjectionTrusted: true,
      },
    ]);
  });

  it('returns public person detail with published letters, stats, and mapped relationships', async () => {
    const response = await invokeRouter(personsRouter, {
      method: 'GET',
      url: '/persons/person-1',
      path: '/persons/person-1',
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      person: {
        id: 'person-1',
        canonicalName: 'Alice Smith',
        aliases: [],
        biography: 'Alice biography',
        biographyStatus: 'VERIFIED',
      },
      relationships: [
        {
          id: 'rel-1',
          relatedPersonId: 'person-2',
          relatedPersonName: 'Bob Baker',
          relationshipType: 'friend',
        },
        {
          id: 'rel-2',
          relatedPersonId: 'person-3',
          relatedPersonName: 'Clara Jones',
          relationshipType: 'sibling',
        },
      ],
      stats: {
        asSender: 1,
        asRecipient: 0,
        asMentioned: 1,
        total: 2,
      },
      letters: [
        {
          id: 'letter-1',
          dateRaw: '19470810',
          letterDate: '1947-08-10',
          role: 'sender',
          sender: 'Alice Smith',
          recipient: 'Bob Baker',
          hook: 'First letter',
          summary: 'First summary',
        },
        {
          id: 'letter-3',
          dateRaw: '19470812',
          letterDate: '1947-08-12',
          role: 'mentioned',
          sender: 'Clara Jones',
          recipient: 'David Stone',
          hook: 'Third letter',
          summary: 'Third summary',
        },
      ],
    });
  });

  it('injects request ids into public person 404 responses', async () => {
    getCanonicalPersonByIdMock.mockResolvedValueOnce(null);

    const response = await invokeRouter(personsRouter, {
      method: 'GET',
      url: '/persons/missing-person',
      path: '/persons/missing-person',
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.body).toEqual({
      error: 'Person not found',
      requestId: expect.any(String),
    });
    expect(response.headers['x-request-id']).toBe(
      (response.body as { requestId: string }).requestId,
    );
  });

  it('does not publish an unverified canonical-person biography', async () => {
    getCanonicalPersonByIdMock.mockResolvedValueOnce({
      id: 'person-1',
      canonicalName: 'Alice Smith',
      aliases: ['Al'],
      biography: 'AI draft based on private sources',
      biographyStatus: 'AI_DRAFT',
    });

    const response = await invokeRouter(personsRouter, {
      method: 'GET',
      url: '/persons/person-1',
      path: '/persons/person-1',
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      person: {
        biography: null,
        biographyStatus: 'EMPTY',
      },
    });
  });

  it('returns public place detail with published letters, stats, and extracted themes', async () => {
    const response = await invokeRouter(placesRouter, {
      method: 'GET',
      url: '/places/place-1',
      path: '/places/place-1',
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      place: {
        id: 'place-1',
        canonicalName: 'Vienna',
        aliases: [],
        notes: null,
        themes: [],
      },
      stats: {
        writtenFrom: 1,
        mentioned: 1,
        destination: 0,
        total: 2,
      },
      letters: [
        {
          id: 'place-letter-1',
          dateRaw: '19470810',
          letterDate: '1947-08-10',
          role: 'written_from',
          sender: 'Alice Smith',
          recipient: 'Bob Baker',
          hook: 'Written from Vienna',
          summary: 'Travel summary',
        },
        {
          id: 'place-letter-3',
          dateRaw: '19470812',
          letterDate: '1947-08-12',
          role: 'mentioned',
          sender: 'Alice Smith',
          recipient: 'Bob Baker',
          hook: 'Mentioned city',
          summary: 'Mention summary',
        },
      ],
    });
  });

  it('injects request ids into public place 404 responses', async () => {
    getCanonicalPlaceByIdMock.mockResolvedValueOnce(null);

    const response = await invokeRouter(placesRouter, {
      method: 'GET',
      url: '/places/missing-place',
      path: '/places/missing-place',
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.body).toEqual({
      error: 'Place not found',
      requestId: expect.any(String),
    });
    expect(response.headers['x-request-id']).toBe(
      (response.body as { requestId: string }).requestId,
    );
  });
});
