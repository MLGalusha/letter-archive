import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkDuplicates,
  uploadFiles,
  type UploadSourceExpectation,
} from '../upload';

const fetchMock = vi.fn();
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
let consoleDebugSpy: ReturnType<typeof vi.spyOn>;

const expectation: UploadSourceExpectation = {
  pageId: 'page-1',
  primarySourceRevision: 7,
  storagePath: 'storage/current.jpg',
  checksumSha256: 'checksum-current',
};

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  consoleErrorSpy.mockRestore();
  consoleDebugSpy.mockRestore();
});

describe('admin upload api', () => {
  it('preserves exact duplicate-check expectations', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      duplicates: { '009-19470810-L01-01.jpg': true },
      sourceExpectations: {
        '009-19470810-L01-01.jpg': expectation,
      },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await expect(checkDuplicates([
      '009-19470810-L01-01.jpg',
    ])).resolves.toMatchObject({
      sourceExpectations: {
        '009-19470810-L01-01.jpg': expectation,
      },
    });
  });

  it('sends the observed source with a force-uploaded file', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      success: 0,
      failed: 0,
      results: [],
      summary: {
        accepted: 0,
        failed: 0,
        changed: 0,
        unchanged: 0,
        created: 0,
        replaced: 0,
        affectedLetters: 0,
      },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await uploadFiles(
      [new File(['image-bytes'], '009-19470810-L01-01.jpg', {
        type: 'image/jpeg',
      })],
      true,
      { '009-19470810-L01-01.jpg': expectation },
    );

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = init.body as FormData;
    expect(body.get('sourceExpectations')).toBe(JSON.stringify({
      '009-19470810-L01-01.jpg': expectation,
    }));
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://localhost:3002/admin/uploads?force=true',
    );
  });
});
