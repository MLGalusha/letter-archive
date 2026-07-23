import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invokeRouter } from '../../../test/express-test-utils.js';

const {
  getPendingReviewItemsMock,
  getReviewQueueStatsMock,
  resolveReviewItemMock,
  findMatchingPersonsMock,
  findMatchingPlacesMock,
  getRelationshipByIdMock,
  updateRelationshipMock,
} = vi.hoisted(() => ({
  getPendingReviewItemsMock: vi.fn(),
  getReviewQueueStatsMock: vi.fn(),
  resolveReviewItemMock: vi.fn(),
  findMatchingPersonsMock: vi.fn(),
  findMatchingPlacesMock: vi.fn(),
  getRelationshipByIdMock: vi.fn(),
  updateRelationshipMock: vi.fn(),
}));

vi.mock('../../../services/entities.js', () => {
  const stub = () => vi.fn();
  return {
    getAllPersonsWithCounts: stub(),
    getAllPlacesWithCounts: stub(),
    getCanonicalPersonById: stub(),
    getCanonicalPlaceById: stub(),
    createCanonicalPerson: stub(),
    createCanonicalPlace: stub(),
    updateCanonicalPersonWithUndo: stub(),
    updateCanonicalPlaceWithUndo: stub(),
    mergePersonsWithUndo: stub(),
    mergePlacesWithUndo: stub(),
    undoPersonRename: stub(),
    undoPersonMerge: stub(),
    undoPlaceRename: stub(),
    undoPlaceMerge: stub(),
    generatePlaceThemes: stub(),
    extractPlaceThemesFromNotes: stub(),
    getLettersForPersonEnriched: stub(),
    getLettersForPlaceEnriched: stub(),
    getPendingReviewItems: getPendingReviewItemsMock,
    resolveReviewItem: resolveReviewItemMock,
    getReviewQueueStats: getReviewQueueStatsMock,
    findMatchingPersons: findMatchingPersonsMock,
    findMatchingPlaces: findMatchingPlacesMock,
    getAllRelationships: stub(),
    getRelationshipsForPerson: stub(),
    getRelationshipById: getRelationshipByIdMock,
    createRelationship: stub(),
    updateRelationship: updateRelationshipMock,
    deleteRelationship: stub(),
    buildHumanEntityProvenancePatch: (actor: string) => ({
      entityExtractionRevision: null,
      confirmedBy: actor,
      confirmedAt: new Date(),
    }),
    findPotentialDuplicatePersons: stub(),
    findPotentialDuplicatePlaces: stub(),
    bulkMergePersons: stub(),
    bulkMergePlaces: stub(),
    getPersonDetailsForMerge: stub(),
    getPlaceDetailsForMerge: stub(),
    getSameNamePersonCandidates: stub(),
    getSameNamePlaceCandidates: stub(),
  };
});

vi.mock('../../../services/biography.js', () => ({
  updatePersonBiography: vi.fn(),
}));

import entitiesRouter from '../entities.js';

describe('admin entities route integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    getPendingReviewItemsMock.mockResolvedValue([
      {
        id: 'review-1',
        entityType: 'person',
        extractedText: 'Alice Smith',
        letterId: 'letter-1',
        suggestedEntityId: 'person-1',
        suggestedEntityName: 'Alice B. Smith',
        context: 'Alice Smith wrote home.',
        confidence: 87,
        status: 'pending',
        createdAt: '2026-03-09T12:00:00.000Z',
      },
    ]);
    getReviewQueueStatsMock.mockResolvedValue({
      pending: { persons: 1, places: 0 },
      resolved: { confirmed: 2, rejected: 1, newEntity: 0 },
    });
    resolveReviewItemMock.mockResolvedValue(undefined);
    findMatchingPersonsMock.mockResolvedValue([
      {
        entityId: 'person-1',
        canonicalName: 'Alice B. Smith',
        matchedOn: 'canonical_name',
        similarity: 94,
      },
    ]);
    findMatchingPlacesMock.mockResolvedValue([
      {
        entityId: 'place-1',
        canonicalName: 'Vienna',
        matchedOn: 'canonical_name',
        similarity: 91,
      },
    ]);
    getRelationshipByIdMock.mockResolvedValue({
      id: 'relationship-1',
      relationshipType: 'friend',
      notes: 'Corrected by a reviewer',
    });
    updateRelationshipMock.mockResolvedValue(undefined);
  });

  it('returns the filtered review queue with stats', async () => {
    const response = await invokeRouter(entitiesRouter, {
      method: 'GET',
      url: '/review?type=person',
      path: '/review',
      query: { type: 'person' },
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      items: [
        {
          id: 'review-1',
          entityType: 'person',
          extractedText: 'Alice Smith',
          letterId: 'letter-1',
          suggestedEntityId: 'person-1',
          suggestedEntityName: 'Alice B. Smith',
          context: 'Alice Smith wrote home.',
          confidence: 87,
          status: 'pending',
          createdAt: '2026-03-09T12:00:00.000Z',
        },
      ],
      stats: {
        pending: { persons: 1, places: 0 },
        resolved: { confirmed: 2, rejected: 1, newEntity: 0 },
      },
    });
    expect(getPendingReviewItemsMock).toHaveBeenCalledWith('person');
    expect(getReviewQueueStatsMock).toHaveBeenCalledTimes(1);
  });

  it('propagates request ids when loading the review queue fails', async () => {
    getPendingReviewItemsMock.mockRejectedValueOnce(new Error('queue unavailable'));

    const response = await invokeRouter(entitiesRouter, {
      method: 'GET',
      url: '/review',
      path: '/review',
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).toMatchObject({
      error: 'Internal server error',
      requestId: expect.any(String),
    });
    expect(response.headers['x-request-id']).toBe(
      (response.body as { requestId: string }).requestId,
    );
  });

  it('validates person search queries and injects request ids into errors', async () => {
    const response = await invokeRouter(entitiesRouter, {
      method: 'GET',
      url: '/persons/search',
      path: '/persons/search',
      query: {},
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toMatchObject({
      error: 'Validation error',
      requestId: expect.any(String),
      details: expect.any(Array),
    });
    expect(response.headers['x-request-id']).toBe(
      (response.body as { requestId: string }).requestId,
    );
    expect(findMatchingPersonsMock).not.toHaveBeenCalled();
  });

  it('returns place search matches', async () => {
    const response = await invokeRouter(entitiesRouter, {
      method: 'GET',
      url: '/places/search?q=Vienna',
      path: '/places/search',
      query: { q: 'Vienna' },
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      matches: [
        {
          entityId: 'place-1',
          canonicalName: 'Vienna',
          matchedOn: 'canonical_name',
          similarity: 91,
        },
      ],
    });
    expect(findMatchingPlacesMock).toHaveBeenCalledWith('Vienna');
  });

  it('applies the default reviewer when resolving a review item', async () => {
    const response = await invokeRouter(entitiesRouter, {
      method: 'POST',
      url: '/review/review-1/resolve',
      path: '/review/review-1/resolve',
      body: { status: 'confirmed' },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ message: 'Review item resolved' });
    expect(resolveReviewItemMock).toHaveBeenCalledWith('review-1', {
      status: 'confirmed',
      reviewedBy: 'admin',
    });
  });

  it('promotes relationship edits from the combined admin route to confirmation', async () => {
    const response = await invokeRouter(entitiesRouter, {
      method: 'PUT',
      url: '/relationships/relationship-1',
      path: '/relationships/relationship-1',
      body: { notes: 'Corrected by a reviewer' },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(updateRelationshipMock).toHaveBeenCalledWith('relationship-1', {
      notes: 'Corrected by a reviewer',
      entityExtractionRevision: null,
      confirmedBy: 'admin',
      confirmedAt: expect.any(Date),
    });
  });
});
