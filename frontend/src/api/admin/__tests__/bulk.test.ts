import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiPatchMock = vi.fn();
const apiPostMock = vi.fn();

vi.mock('../../client', () => ({
  apiPatch: (...args: unknown[]) => apiPatchMock(...args),
  apiPost: (...args: unknown[]) => apiPostMock(...args),
}));

import {
  bulkClearMetadata,
  bulkClearTranscriptions,
  bulkExtractMetadata,
  bulkTranscribe,
  bulkUpdateContentVisibility,
  bulkUpdateFields,
} from '../bulk';

describe('admin bulk API', () => {
  beforeEach(() => {
    apiPatchMock.mockReset();
    apiPostMock.mockReset();
  });

  it('sends source revisions and one explicit content-visibility action', async () => {
    const sources = [
      { letterId: 'letter-1', primarySourceRevision: 4 },
      { letterId: 'letter-2', primarySourceRevision: 9 },
    ];
    const response = {
      requested: 2,
      applied: 1,
      skipped: 1,
      skipReasons: [{
        letterId: 'letter-2',
        code: 'SOURCE_CHANGED_OR_INELIGIBLE' as const,
      }],
    };
    apiPatchMock.mockResolvedValueOnce(response);

    const result = await bulkUpdateContentVisibility(
      sources,
      'PUBLISH_TRANSCRIPT',
    );

    expect(apiPatchMock).toHaveBeenCalledWith(
      '/admin/letters/bulk/content-visibility',
      {
        sources,
        action: 'PUBLISH_TRANSCRIPT',
      },
    );
    expect(result).toBe(response);
  });

  it('sends the observed source revision with every bulk identity edit', async () => {
    const updates = [
      {
        letterId: 'letter-1',
        primarySourceRevision: 4,
        sender: 'Jimmy',
      },
    ];
    const response = {
      requested: 1,
      applied: 1,
      skipped: 0,
      updated: 1,
      skipReasons: [],
    };
    apiPatchMock.mockResolvedValueOnce(response);

    await expect(bulkUpdateFields(updates)).resolves.toBe(response);

    expect(apiPatchMock).toHaveBeenCalledWith(
      '/admin/letters/bulk/update-fields',
      { updates },
    );
  });

  it.each([
    {
      path: '/admin/letters/bulk/transcribe',
      invoke: (sources: Array<{ letterId: string; primarySourceRevision: number }>) =>
        bulkTranscribe(sources, true),
      body: (sources: Array<{ letterId: string; primarySourceRevision: number }>) => ({
        sources,
        overwrite: true,
      }),
    },
    {
      path: '/admin/letters/bulk/extract-metadata',
      invoke: bulkExtractMetadata,
      body: (sources: Array<{ letterId: string; primarySourceRevision: number }>) => ({
        sources,
      }),
    },
    {
      path: '/admin/letters/bulk/clear-transcriptions',
      invoke: bulkClearTranscriptions,
      body: (sources: Array<{ letterId: string; primarySourceRevision: number }>) => ({
        sources,
      }),
    },
    {
      path: '/admin/letters/bulk/clear-metadata',
      invoke: bulkClearMetadata,
      body: (sources: Array<{ letterId: string; primarySourceRevision: number }>) => ({
        sources,
      }),
    },
  ])('sends selection-time source pairs to $path', async ({
    path,
    invoke,
    body,
  }) => {
    const sources = [
      { letterId: 'letter-1', primarySourceRevision: 4 },
      { letterId: 'letter-2', primarySourceRevision: 9 },
    ];
    const response = {
      requested: 2,
      applied: 1,
      queued: 1,
      skipped: 1,
      skipReasons: [{
        letterId: 'letter-2',
        code: 'SOURCE_CHANGED' as const,
        reason: 'Letter source changed; refresh and reselect',
      }],
    };
    apiPostMock.mockResolvedValueOnce(response);

    await expect(invoke(sources)).resolves.toBe(response);

    expect(apiPostMock).toHaveBeenCalledWith(path, body(sources));
  });
});
