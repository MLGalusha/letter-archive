import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invokeRouter } from '../../../test/express-test-utils.js';

const {
  dbUpdateMock,
  returningMock,
  updateCalls,
} = vi.hoisted(() => ({
  dbUpdateMock: vi.fn(),
  returningMock: vi.fn(),
  updateCalls: [] as Array<{
    updates: Record<string, unknown>;
    condition: unknown;
  }>,
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...clauses: unknown[]) => ({ kind: 'and', clauses })),
  eq: vi.fn((field: unknown, value: unknown) => ({ kind: 'eq', field, value })),
  inArray: vi.fn((field: unknown, values: unknown[]) => ({
    kind: 'inArray',
    field,
    values,
  })),
}));

vi.mock('../../../db/index.js', () => {
  dbUpdateMock.mockImplementation(() => ({
    set: (updates: Record<string, unknown>) => ({
      where: (condition: unknown) => ({
        returning: async () => {
          updateCalls.push({ updates, condition });
          return returningMock();
        },
      }),
    }),
  }));

  return {
    db: { update: dbUpdateMock },
    letters: {
      id: 'letters.id',
      visibility: 'letters.visibility',
      transcriptPublished: 'letters.transcriptPublished',
      transcriptionStatus: 'letters.transcriptionStatus',
      transcriptStatus: 'letters.transcriptStatus',
      metadataPublished: 'letters.metadataPublished',
      metadataStatus: 'letters.metadataStatus',
      metadataContentStatus: 'letters.metadataContentStatus',
    },
  };
});

vi.mock('../../../services/letter-operations.js', () => ({
  bulkClearMetadata: vi.fn(),
  bulkClearTranscriptions: vi.fn(),
  bulkExtractMetadata: vi.fn(),
  bulkTranscribe: vi.fn(),
  bulkUpdateFields: vi.fn(),
}));

import bulkRouter from '../letters/bulk.js';

const eligibleId = '11111111-1111-4111-8111-111111111111';
const ineligibleId = '22222222-2222-4222-8222-222222222222';
const letterIds = [eligibleId, ineligibleId];

describe('admin bulk content visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateCalls.length = 0;
  });

  it('hides every selected letter even when metadata publishing is only eligible for some', async () => {
    returningMock
      .mockResolvedValueOnce(letterIds.map(id => ({ id })))
      .mockResolvedValueOnce([{ id: eligibleId }]);

    const response = await invokeRouter(bulkRouter, {
      method: 'PATCH',
      url: '/content-visibility',
      body: {
        letterIds,
        visibility: 'HIDDEN',
        metadataPublished: true,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ updated: 2 });
    expect(updateCalls).toHaveLength(2);
    expect(updateCalls[0]).toMatchObject({
      updates: { visibility: 'HIDDEN' },
      condition: {
        kind: 'inArray',
        field: 'letters.id',
        values: letterIds,
      },
    });
    expect(updateCalls[0].updates).not.toHaveProperty('metadataPublished');
    expect(updateCalls[1]).toMatchObject({
      updates: { metadataPublished: true },
      condition: {
        kind: 'and',
        clauses: [
          { kind: 'inArray', field: 'letters.id', values: letterIds },
          { kind: 'eq', field: 'letters.metadataContentStatus', value: 'VERIFIED' },
        ],
      },
    });
  });

  it('unpublishes every selected transcript while publishing only eligible metadata', async () => {
    returningMock
      .mockResolvedValueOnce(letterIds.map(id => ({ id })))
      .mockResolvedValueOnce([{ id: eligibleId }]);

    const response = await invokeRouter(bulkRouter, {
      method: 'PATCH',
      url: '/content-visibility',
      body: {
        letterIds,
        transcriptPublished: false,
        metadataPublished: true,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ updated: 2 });
    expect(updateCalls).toHaveLength(2);
    expect(updateCalls[0]).toMatchObject({
      updates: { transcriptPublished: false },
      condition: {
        kind: 'inArray',
        field: 'letters.id',
        values: letterIds,
      },
    });
    expect(updateCalls[0].updates).not.toHaveProperty('metadataPublished');
    expect(updateCalls[1]).toMatchObject({
      updates: { metadataPublished: true },
      condition: {
        kind: 'and',
        clauses: [
          { kind: 'inArray', field: 'letters.id', values: letterIds },
          { kind: 'eq', field: 'letters.metadataContentStatus', value: 'VERIFIED' },
        ],
      },
    });
  });

  it('publishes only committed verified transcript content', async () => {
    returningMock.mockResolvedValueOnce([{ id: eligibleId }]);

    const response = await invokeRouter(bulkRouter, {
      method: 'PATCH',
      url: '/content-visibility',
      body: { letterIds, transcriptPublished: true },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ updated: 1 });
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]).toMatchObject({
      updates: { transcriptPublished: true },
      condition: {
        kind: 'and',
        clauses: [
          { kind: 'inArray', field: 'letters.id', values: letterIds },
          { kind: 'eq', field: 'letters.transcriptStatus', value: 'VERIFIED' },
        ],
      },
    });
  });
});
