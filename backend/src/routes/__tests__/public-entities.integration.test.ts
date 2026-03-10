import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invokeRouter } from '../../test/express-test-utils.js';

const {
  getCanonicalPersonByIdMock,
  getLettersForPersonEnrichedMock,
  getRelationshipsForPersonMock,
  getCanonicalPlaceByIdMock,
  getLettersForPlaceEnrichedMock,
  stripPlaceThemesFromNotesMock,
  extractPlaceThemesFromNotesMock,
} = vi.hoisted(() => ({
  getCanonicalPersonByIdMock: vi.fn(),
  getLettersForPersonEnrichedMock: vi.fn(),
  getRelationshipsForPersonMock: vi.fn(),
  getCanonicalPlaceByIdMock: vi.fn(),
  getLettersForPlaceEnrichedMock: vi.fn(),
  stripPlaceThemesFromNotesMock: vi.fn(),
  extractPlaceThemesFromNotesMock: vi.fn(),
}));

vi.mock('../../services/entities.js', () => ({
  getCanonicalPersonById: getCanonicalPersonByIdMock,
  getLettersForPersonEnriched: getLettersForPersonEnrichedMock,
  getRelationshipsForPerson: getRelationshipsForPersonMock,
  getCanonicalPlaceById: getCanonicalPlaceByIdMock,
  getLettersForPlaceEnriched: getLettersForPlaceEnrichedMock,
  stripPlaceThemesFromNotes: stripPlaceThemesFromNotesMock,
  extractPlaceThemesFromNotes: extractPlaceThemesFromNotesMock,
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
        dateRaw: '19470811',
        letterDate: '1947-08-11',
        role: 'recipient',
        sender: 'Bob Baker',
        recipient: 'Alice Smith',
        hook: 'Second letter',
        summary: 'Hidden summary',
        visibility: 'HIDDEN',
      },
      {
        letterId: 'letter-1',
        dateRaw: '19470810',
        letterDate: '1947-08-10',
        role: 'sender',
        sender: 'Alice Smith',
        recipient: 'Bob Baker',
        hook: 'First letter',
        summary: 'First summary',
        visibility: 'PUBLISHED',
      },
      {
        letterId: 'letter-3',
        dateRaw: '19470812',
        letterDate: '1947-08-12',
        role: 'mentioned',
        sender: 'Clara Jones',
        recipient: 'David Stone',
        hook: 'Third letter',
        summary: 'Third summary',
        visibility: 'PUBLISHED',
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
      },
      {
        id: 'rel-2',
        personAId: 'person-3',
        personBId: 'person-1',
        personAName: 'Clara Jones',
        personBName: 'Alice Smith',
        relationshipType: 'sibling',
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
        dateRaw: '19470811',
        letterDate: '1947-08-11',
        role: 'destination',
        sender: 'Alice Smith',
        recipient: 'Bob Baker',
        hook: 'Trip planning',
        summary: 'Hidden destination',
        visibility: 'HIDDEN',
      },
      {
        letterId: 'place-letter-3',
        dateRaw: '19470812',
        letterDate: '1947-08-12',
        role: 'mentioned',
        sender: 'Alice Smith',
        recipient: 'Bob Baker',
        hook: 'Mentioned city',
        summary: 'Mention summary',
        visibility: 'PUBLISHED',
      },
      {
        letterId: 'place-letter-1',
        dateRaw: '19470810',
        letterDate: '1947-08-10',
        role: 'written_from',
        sender: 'Alice Smith',
        recipient: 'Bob Baker',
        hook: 'Written from Vienna',
        summary: 'Travel summary',
        visibility: 'PUBLISHED',
      },
    ]);
    stripPlaceThemesFromNotesMock.mockReturnValue('Historic capital');
    extractPlaceThemesFromNotesMock.mockReturnValue(['music', 'travel']);
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
        aliases: ['Al'],
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
        aliases: ['Wien'],
        placeType: 'city',
        notes: 'Historic capital',
        themes: ['music', 'travel'],
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
    expect(stripPlaceThemesFromNotesMock).toHaveBeenCalledWith('Historic capital [THEMES: music, travel]');
    expect(extractPlaceThemesFromNotesMock).toHaveBeenCalledWith('Historic capital [THEMES: music, travel]');
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
