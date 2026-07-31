import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addNote,
  confirmTranscript,
  generateReadingView,
  getPageGeometry,
  processLetter,
  regenerateEntities,
  regenerateMetadata,
  reExtractLetter,
  savePageLineSegments,
  unverifyMetadata,
  unverifyTranscript,
  updateNoteStatus,
  verifyMetadata,
  verifyTranscript,
} from '../letters';

const fetchMock = vi.fn();
let consoleDebugSpy: ReturnType<typeof vi.spyOn>;
let consoleInfoSpy: ReturnType<typeof vi.spyOn>;
let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
  consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
  consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  consoleDebugSpy.mockRestore();
  consoleInfoSpy.mockRestore();
  consoleWarnSpy.mockRestore();
  consoleErrorSpy.mockRestore();
});

describe('admin letter verification api', () => {
  it.each([
    {
      action: () => processLetter('letter-1', 7),
      path: 'process',
      body: { primarySourceRevision: 7 },
    },
    {
      action: () => confirmTranscript(
        'letter-1',
        7,
        'transcript-digest-1',
        {
          confirmedSender: 'Mabel',
          confirmedRecipient: 'Theo',
        },
      ),
      path: 'confirm-transcript',
      body: {
        confirmedSender: 'Mabel',
        confirmedRecipient: 'Theo',
        primarySourceRevision: 7,
        transcriptDigest: 'transcript-digest-1',
      },
    },
    {
      action: () => generateReadingView('letter-1', 7),
      path: 'generate-reading-view',
      body: { primarySourceRevision: 7 },
    },
    {
      action: () => verifyTranscript('letter-1', 7),
      path: 'verify-transcript',
      body: { primarySourceRevision: 7 },
    },
    {
      action: () => unverifyTranscript('letter-1', 7),
      path: 'unverify-transcript',
      body: { primarySourceRevision: 7 },
    },
    {
      action: () => verifyMetadata('letter-1', 7),
      path: 'verify-metadata',
      body: { primarySourceRevision: 7 },
    },
    {
      action: () => unverifyMetadata('letter-1', 7),
      path: 'unverify-metadata',
      body: { primarySourceRevision: 7 },
    },
    {
      action: () => regenerateMetadata('letter-1', 7, {
        confirmedSender: 'Mabel',
      }),
      path: 'regenerate-metadata',
      body: {
        confirmedSender: 'Mabel',
        primarySourceRevision: 7,
      },
    },
    {
      action: () => regenerateEntities('letter-1', 7),
      path: 'regenerate-entities',
      body: { primarySourceRevision: 7 },
    },
    {
      action: () => reExtractLetter('letter-1', {
        primarySourceRevision: 7,
        confirmedRecipient: 'Theo',
        mode: 'metadata_only',
      }),
      path: 're-extract',
      body: {
        primarySourceRevision: 7,
        confirmedRecipient: 'Theo',
        mode: 'metadata_only',
      },
    },
  ])('sends the source revision when calling $path', async ({
    action,
    path,
    body,
  }) => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'letter-1' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await action();

    expect(fetchMock).toHaveBeenCalledWith(
      `http://localhost:3002/admin/letters/letter-1/${path}`,
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify(body),
      }),
    );
  });

  it('reports an aborted confirmation as status zero without reconciling state', async () => {
    const timeoutSignal = new AbortController().signal;
    const timeoutSpy = vi
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(timeoutSignal);
    fetchMock.mockRejectedValueOnce(
      new DOMException('The operation was aborted.', 'AbortError'),
    );

    const error = await confirmTranscript(
      'letter-1',
      7,
      'transcript-digest-1',
      { confirmedSender: 'Mabel' },
    ).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      name: 'ApiError',
      status: 0,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3002/admin/letters/letter-1/confirm-transcript',
      expect.objectContaining({
        method: 'POST',
        signal: timeoutSignal,
      }),
    );
    expect(timeoutSpy).toHaveBeenCalledOnce();
    expect(timeoutSpy).toHaveBeenCalledWith(20_000);
    timeoutSpy.mockRestore();
  });

  it('sends the source revision when adding and updating notes', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'letter-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'letter-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));

    await addNote('letter-1', 7, {
      content: 'Check sender',
      category: 'identity',
      priority: 'high',
    });
    await updateNoteStatus('letter-1', 7, 'note-1', 'dismissed');

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://localhost:3002/admin/letters/letter-1/notes',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({
          content: 'Check sender',
          category: 'identity',
          priority: 'high',
          primarySourceRevision: 7,
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://localhost:3002/admin/letters/letter-1/notes/note-1',
      expect.objectContaining({
        method: 'PATCH',
        credentials: 'include',
        body: JSON.stringify({
          primarySourceRevision: 7,
          status: 'dismissed',
        }),
      }),
    );
  });
});

describe('page geometry api contract', () => {
  const geometryChecksum = 'a'.repeat(64);
  const projectionChecksum = 'b'.repeat(64);
  const segment = {
    id: 'segment-1',
    line: 1,
    baseline: [[10, 20], [110, 20]] as [number, number][],
    bbox: [10, 10, 110, 30] as [number, number, number, number],
    ocrText: 'Dear Sadie',
    geometryProvenance: {
      source: 'machine' as const,
      operation: 'detected' as const,
      parentSegmentIds: [],
    },
  };
  const envelope = {
    lineSegments: [segment],
    geometryRevision: 3,
    geometryChecksumSha256: geometryChecksum,
    lineSegmentsChecksumSha256: projectionChecksum,
    reviewState: {
      trustState: 'unverified' as const,
      approvedGeometryRevision: null,
      approvedGeometryChecksumSha256: null,
      approvedBy: null,
      approvedAt: null,
    },
  };

  it('requires the complete projection identity when loading geometry', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      ...envelope,
      lineSegmentsChecksumSha256: undefined,
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await expect(getPageGeometry('page-1')).rejects.toThrow(
      'The page geometry response was incomplete',
    );
  });

  it('rejects a trusted response without its exact approval receipt', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      ...envelope,
      reviewState: {
        ...envelope.reviewState,
        trustState: 'trusted',
      },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await expect(getPageGeometry('page-1')).rejects.toThrow(
      'The page geometry response was incomplete',
    );
  });

  it('sends both geometry and full-projection expectations when saving', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(envelope), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await expect(savePageLineSegments('page-1', [segment], {
      primarySourceRevision: 7,
      sourceChecksum: 'c'.repeat(64),
      expectedGeometryRevision: 2,
      expectedLineSegmentsChecksumSha256: 'd'.repeat(64),
    })).resolves.toEqual(envelope);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3002/admin/letters/pages/page-1/line-segments',
      expect.objectContaining({
        method: 'PATCH',
        credentials: 'include',
        body: JSON.stringify({
          lineSegments: [segment],
          primarySourceRevision: 7,
          sourceChecksum: 'c'.repeat(64),
          expectedGeometryRevision: 2,
          expectedLineSegmentsChecksumSha256: 'd'.repeat(64),
        }),
      }),
    );
  });
});
