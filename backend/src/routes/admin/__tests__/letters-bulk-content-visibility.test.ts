import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invokeRouter } from '../../../test/express-test-utils.js';

const {
  applyBulkPublicationActionMock,
  bulkClearMetadataMock,
  bulkClearTranscriptionsMock,
  bulkExtractMetadataMock,
  bulkTranscribeMock,
  bulkUpdateFieldsMock,
} = vi.hoisted(() => ({
  applyBulkPublicationActionMock: vi.fn(),
  bulkClearMetadataMock: vi.fn(),
  bulkClearTranscriptionsMock: vi.fn(),
  bulkExtractMetadataMock: vi.fn(),
  bulkTranscribeMock: vi.fn(),
  bulkUpdateFieldsMock: vi.fn(),
}));

vi.mock('../../../services/letter-operations.js', () => ({
  bulkClearMetadata: bulkClearMetadataMock,
  bulkClearTranscriptions: bulkClearTranscriptionsMock,
  bulkExtractMetadata: bulkExtractMetadataMock,
  bulkTranscribe: bulkTranscribeMock,
  bulkUpdateFields: bulkUpdateFieldsMock,
}));

vi.mock('../../../services/letter/publication-mutations.js', () => ({
  PUBLICATION_ACTIONS: [
    'PUBLISH_LETTER',
    'HIDE_LETTER',
    'PUBLISH_TRANSCRIPT',
    'HIDE_TRANSCRIPT',
    'PUBLISH_METADATA',
    'HIDE_METADATA',
  ],
  applyBulkPublicationAction: applyBulkPublicationActionMock,
}));

import bulkRouter from '../letters/bulk.js';

const currentId = '11111111-1111-4111-8111-111111111111';
const skippedId = '22222222-2222-4222-8222-222222222222';
const sources = [
  { letterId: currentId, primarySourceRevision: 4 },
  { letterId: skippedId, primarySourceRevision: 7 },
];

describe('admin bulk content visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    'PUBLISH_LETTER',
    'HIDE_LETTER',
    'PUBLISH_TRANSCRIPT',
    'HIDE_TRANSCRIPT',
    'PUBLISH_METADATA',
    'HIDE_METADATA',
  ] as const)('delegates %s to the canonical publication service', async (action) => {
    const serviceResult = {
      requested: 2,
      applied: 1,
      skipped: 1,
      skipReasons: [{
        letterId: skippedId,
        code: action.startsWith('PUBLISH')
          ? 'SOURCE_CHANGED_OR_INELIGIBLE'
          : 'NOT_FOUND',
      }],
    };
    applyBulkPublicationActionMock.mockResolvedValueOnce(serviceResult);

    const response = await invokeRouter(bulkRouter, {
      method: 'PATCH',
      url: '/content-visibility',
      body: { sources, action },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(serviceResult);
    expect(applyBulkPublicationActionMock).toHaveBeenCalledWith(
      sources,
      action,
      'admin',
    );
  });

  it('rejects duplicate source entries before invoking the service', async () => {
    const response = await invokeRouter(bulkRouter, {
      method: 'PATCH',
      url: '/content-visibility',
      body: {
        sources: [sources[0], sources[0]],
        action: 'PUBLISH_LETTER',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(applyBulkPublicationActionMock).not.toHaveBeenCalled();
  });

  it('bounds mutation work before opening transactions', async () => {
    const letterIds = Array.from(
      { length: 1_001 },
      (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    );

    const mutationResponse = await invokeRouter(bulkRouter, {
      method: 'PATCH',
      url: '/content-visibility',
      body: {
        sources: letterIds.map((letterId) => ({
          letterId,
          primarySourceRevision: 1,
        })),
        action: 'PUBLISH_LETTER',
      },
    });

    expect(mutationResponse.statusCode).toBe(400);
    expect(applyBulkPublicationActionMock).not.toHaveBeenCalled();
  });

  it('returns reload-required conflict semantics for legacy letterIds clients', async () => {
    const response = await invokeRouter(bulkRouter, {
      method: 'PATCH',
      url: '/content-visibility',
      body: {
        letterIds: [currentId, skippedId],
        visibility: 'PUBLISHED',
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({
      error: expect.stringContaining('reload the dashboard'),
      code: 'SOURCE_REVISION_CHANGED',
    });
    expect(applyBulkPublicationActionMock).not.toHaveBeenCalled();
  });

  it('requires one explicit action instead of accepting legacy visibility fields', async () => {
    const response = await invokeRouter(bulkRouter, {
      method: 'PATCH',
      url: '/content-visibility',
      body: {
        sources,
        transcriptPublished: true,
        metadataPublished: true,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(applyBulkPublicationActionMock).not.toHaveBeenCalled();
  });

  it('requires the observed source revision for every bulk identity edit', async () => {
    const response = await invokeRouter(bulkRouter, {
      method: 'PATCH',
      url: '/update-fields',
      body: {
        updates: [{
          letterId: currentId,
          sender: 'Mabel',
        }],
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({
      error: expect.stringContaining('reload the dashboard'),
      code: 'SOURCE_REVISION_CHANGED',
    });
    expect(bulkUpdateFieldsMock).not.toHaveBeenCalled();
  });

  it.each([
    {
      url: '/transcribe',
      body: { sources, overwrite: true },
      service: bulkTranscribeMock,
      args: [sources, true],
    },
    {
      url: '/extract-metadata',
      body: { sources },
      service: bulkExtractMetadataMock,
      args: [sources],
    },
    {
      url: '/clear-transcriptions',
      body: { sources },
      service: bulkClearTranscriptionsMock,
      args: [sources],
    },
    {
      url: '/clear-metadata',
      body: { sources },
      service: bulkClearMetadataMock,
      args: [sources],
    },
  ])('forwards observed source pairs through POST $url', async ({
    url,
    body,
    service,
    args,
  }) => {
    const serviceResult = {
      requested: 2,
      applied: 1,
      queued: 1,
      skipped: 1,
      skipReasons: [{
        letterId: skippedId,
        code: 'SOURCE_CHANGED',
        reason: 'Letter source changed; refresh and reselect',
      }],
    };
    service.mockResolvedValueOnce(serviceResult);

    const response = await invokeRouter(bulkRouter, {
      method: 'POST',
      url,
      body,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(serviceResult);
    expect(service).toHaveBeenCalledWith(...args);
  });

  it.each([
    ['/transcribe', bulkTranscribeMock],
    ['/extract-metadata', bulkExtractMetadataMock],
    ['/clear-transcriptions', bulkClearTranscriptionsMock],
    ['/clear-metadata', bulkClearMetadataMock],
  ])('returns reload-required conflict semantics for legacy POST %s', async (
    url,
    service,
  ) => {
    const response = await invokeRouter(bulkRouter, {
      method: 'POST',
      url,
      body: { letterIds: [currentId, skippedId] },
    });

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({
      error: expect.stringContaining('reload the dashboard'),
      code: 'SOURCE_REVISION_CHANGED',
    });
    expect(service).not.toHaveBeenCalled();
  });
});
