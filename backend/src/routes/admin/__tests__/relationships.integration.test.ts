import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invokeRouter } from '../../../test/express-test-utils.js';

const {
  getAllRelationshipsMock,
  getRelationshipByIdMock,
  createRelationshipMock,
  updateRelationshipMock,
  deleteRelationshipMock,
  getCanonicalPersonByIdMock,
  backfillRelationshipsFromLettersMock,
} = vi.hoisted(() => ({
  getAllRelationshipsMock: vi.fn(),
  getRelationshipByIdMock: vi.fn(),
  createRelationshipMock: vi.fn(),
  updateRelationshipMock: vi.fn(),
  deleteRelationshipMock: vi.fn(),
  getCanonicalPersonByIdMock: vi.fn(),
  backfillRelationshipsFromLettersMock: vi.fn(),
}));

vi.mock('../../../services/entities.js', () => ({
  getAllRelationships: getAllRelationshipsMock,
  getRelationshipById: getRelationshipByIdMock,
  createRelationship: createRelationshipMock,
  updateRelationship: updateRelationshipMock,
  deleteRelationship: deleteRelationshipMock,
  getCanonicalPersonById: getCanonicalPersonByIdMock,
  backfillRelationshipsFromLetters: backfillRelationshipsFromLettersMock,
  buildHumanEntityProvenancePatch: (actor: string) => ({
    entityExtractionRevision: null,
    confirmedBy: actor,
    confirmedAt: new Date(),
  }),
}));

import relationshipsRouter from '../relationships.js';

const PERSON_A_ID = '11111111-1111-4111-8111-111111111111';
const PERSON_B_ID = '22222222-2222-4222-8222-222222222222';
const RELATIONSHIP_ID = '33333333-3333-4333-8333-333333333333';

function makeRelationship() {
  return {
    id: RELATIONSHIP_ID,
    personAId: PERSON_A_ID,
    personBId: PERSON_B_ID,
    personAName: 'Alice Smith',
    personBName: 'Bob Baker',
    relationshipType: 'friend',
    notes: 'Family friends',
    discoveredInLetterId: undefined,
    confidence: 82,
    confirmedBy: 'admin',
    confirmedAt: '2026-03-09T12:00:00.000Z',
    createdAt: '2026-03-09T12:00:00.000Z',
    updatedAt: '2026-03-09T12:00:00.000Z',
  };
}

describe('admin relationships route integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    getAllRelationshipsMock.mockResolvedValue([makeRelationship()]);
    getRelationshipByIdMock.mockResolvedValue(makeRelationship());
    createRelationshipMock.mockResolvedValue(RELATIONSHIP_ID);
    updateRelationshipMock.mockResolvedValue(undefined);
    deleteRelationshipMock.mockResolvedValue(undefined);
    getCanonicalPersonByIdMock.mockImplementation(async (id: string) => ({
      id,
      canonicalName: id === PERSON_A_ID ? 'Alice Smith' : 'Bob Baker',
    }));
    backfillRelationshipsFromLettersMock.mockResolvedValue({
      scannedLetters: 12,
      created: 3,
      updated: 1,
      skipped: 8,
    });
  });

  it('returns admin relationship records', async () => {
    const response = await invokeRouter(relationshipsRouter, {
      method: 'GET',
      url: '/',
      path: '/',
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual([makeRelationship()]);
    expect(getAllRelationshipsMock).toHaveBeenCalledTimes(1);
  });

  it('injects request ids into manual same-person validation errors', async () => {
    const response = await invokeRouter(relationshipsRouter, {
      method: 'POST',
      url: '/',
      path: '/',
      body: {
        personAId: PERSON_A_ID,
        personBId: PERSON_A_ID,
        relationshipType: 'friend',
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({
      error: 'Cannot create relationship between same person',
      requestId: expect.any(String),
    });
    expect(response.headers['x-request-id']).toBe(
      (response.body as { requestId: string }).requestId,
    );
    expect(createRelationshipMock).not.toHaveBeenCalled();
  });

  it('creates a relationship after verifying both people exist', async () => {
    const response = await invokeRouter(relationshipsRouter, {
      method: 'POST',
      url: '/',
      path: '/',
      body: {
        personAId: PERSON_A_ID,
        personBId: PERSON_B_ID,
        relationshipType: 'friend',
        confidence: 82,
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.body).toEqual(makeRelationship());
    expect(getCanonicalPersonByIdMock).toHaveBeenNthCalledWith(1, PERSON_A_ID);
    expect(getCanonicalPersonByIdMock).toHaveBeenNthCalledWith(2, PERSON_B_ID);
    expect(createRelationshipMock).toHaveBeenCalledWith({
      personAId: PERSON_A_ID,
      personBId: PERSON_B_ID,
      relationshipType: 'friend',
      notes: undefined,
      discoveredInLetterId: undefined,
      confidence: 82,
      entityExtractionRevision: null,
      confirmedBy: 'admin',
      confirmedAt: expect.any(Date),
    });
  });

  it('maps unique-constraint failures to 409 conflicts', async () => {
    createRelationshipMock.mockRejectedValueOnce(
      Object.assign(new Error('duplicate relationship'), { code: '23505' }),
    );

    const response = await invokeRouter(relationshipsRouter, {
      method: 'POST',
      url: '/',
      path: '/',
      body: {
        personAId: PERSON_A_ID,
        personBId: PERSON_B_ID,
        relationshipType: 'friend',
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.body).toEqual({
      error: 'Relationship already exists between these people',
      requestId: expect.any(String),
    });
  });

  it('promotes an edited extracted relationship to explicit admin confirmation', async () => {
    const response = await invokeRouter(relationshipsRouter, {
      method: 'PUT',
      url: `/${RELATIONSHIP_ID}`,
      path: `/${RELATIONSHIP_ID}`,
      body: { notes: 'Corrected by a reviewer' },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(updateRelationshipMock).toHaveBeenCalledWith(RELATIONSHIP_ID, {
      notes: 'Corrected by a reviewer',
      entityExtractionRevision: null,
      confirmedBy: 'admin',
      confirmedAt: expect.any(Date),
    });
  });

  it('deletes existing relationships with a 204 response', async () => {
    const response = await invokeRouter(relationshipsRouter, {
      method: 'DELETE',
      url: `/${RELATIONSHIP_ID}`,
      path: `/${RELATIONSHIP_ID}`,
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(204);
    expect(deleteRelationshipMock).toHaveBeenCalledWith(RELATIONSHIP_ID);
  });

  it('returns backfill results', async () => {
    const response = await invokeRouter(relationshipsRouter, {
      method: 'POST',
      url: '/backfill-from-letters',
      path: '/backfill-from-letters',
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      scannedLetters: 12,
      created: 3,
      updated: 1,
      skipped: 8,
    });
    expect(backfillRelationshipsFromLettersMock).toHaveBeenCalledTimes(1);
  });
});
