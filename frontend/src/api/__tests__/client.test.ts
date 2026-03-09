import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  apiDelete,
  apiGet,
  apiPost,
  getImageUrl,
} from '../client';

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

describe('api client', () => {
  it('builds GET query params and includes credentials', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    const result = await apiGet<{ ok: boolean }>('/letters', {
      search: 'alice',
      page: 2,
      empty: '',
      skipped: undefined,
    });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3002/letters?search=alice&page=2',
      expect.objectContaining({
        credentials: 'include',
      }),
    );
  });

  it('returns undefined for 204 responses', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    const result = await apiDelete<void>('/admin/test');
    expect(result).toBeUndefined();
  });

  it('captures request id from headers when an error response is not json', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Bad gateway upstream', {
      status: 502,
      statusText: 'Bad Gateway',
      headers: { 'x-request-id': 'req-123' },
    }));

    await expect(apiGet('/broken')).rejects.toMatchObject({
      name: 'ApiError',
      status: 502,
      message: 'Bad gateway upstream',
      requestId: 'req-123',
    });
  });

  it('throws ApiError for network failures', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));

    const promise = apiPost('/letters', { hello: 'world' });

    await expect(promise).rejects.toBeInstanceOf(ApiError);
    await expect(promise).rejects.toMatchObject({
      status: 0,
      message: 'fetch failed',
    });
  });

  it('keeps absolute image urls unchanged and prefixes relative ones', () => {
    expect(getImageUrl('https://cdn.example.com/img.jpg')).toBe('https://cdn.example.com/img.jpg');
    expect(getImageUrl('/images/page-1')).toBe('http://localhost:3002/images/page-1');
  });
});
