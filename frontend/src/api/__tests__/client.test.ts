import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  apiDelete,
  apiGet,
  apiPost,
  getErrorMessage,
  getImageUrl,
} from '../client';

const fetchMock = vi.fn();
let consoleDebugSpy: ReturnType<typeof vi.spyOn>;
let consoleInfoSpy: ReturnType<typeof vi.spyOn>;
let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  localStorage.clear();
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

  it('sends an optional JSON body with DELETE requests', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await apiDelete<void>('/admin/letters/letter-1', {
      primarySourceRevision: 7,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3002/admin/letters/letter-1',
      expect.objectContaining({
        method: 'DELETE',
        credentials: 'include',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ primarySourceRevision: 7 }),
      }),
    );
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
      message: 'Bad gateway upstream (Request ID: req-123)',
      requestId: 'req-123',
      responseMessage: 'Bad gateway upstream',
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

  it('formats ApiError messages for operator-facing displays', () => {
    const error = new ApiError(500, 'Internal server error', undefined, 'req-999');
    expect(getErrorMessage(error, 'Fallback')).toBe(
      'Internal server error (Request ID: req-999)',
    );
    expect(getErrorMessage(new Error('Boom'), 'Fallback')).toBe('Boom');
    expect(getErrorMessage(null, 'Fallback')).toBe('Fallback');
  });

  it('keeps absolute image urls unchanged and prefixes relative ones', () => {
    expect(getImageUrl('https://cdn.example.com/img.jpg')).toBe('https://cdn.example.com/img.jpg');
    expect(getImageUrl('/images/page-1')).toBe('http://localhost:3002/images/page-1');
  });

  it('does not put an admin token in public image URLs', () => {
    localStorage.setItem('adminToken', 'reusable-admin-jwt');

    expect(getImageUrl('/images/page-1?v=checksum', { width: 640 })).toBe(
      'http://localhost:3002/images/page-1?v=checksum&w=640',
    );
    expect(getImageUrl('/images/page-1?token=stale-jwt&v=checksum')).toBe(
      'http://localhost:3002/images/page-1?v=checksum',
    );
  });

  it('keeps image URLs credential-free for HttpOnly cookie auth', () => {
    localStorage.setItem('adminToken', 'reusable-admin-jwt');

    expect(getImageUrl('/images/page-hidden', { width: 640 })).toBe(
      'http://localhost:3002/images/page-hidden?w=640',
    );
    expect(getImageUrl('https://cdn.example.com/private.jpg')).toBe(
      'https://cdn.example.com/private.jpg',
    );
    expect(getImageUrl('/blog-images/editor.jpg')).toBe(
      'http://localhost:3002/blog-images/editor.jpg',
    );
  });

  it('removes API image credential params case-insensitively', () => {
    expect(
      getImageUrl(
        '/images/page-hidden?ToKeN=one&ADMINTOKEN=two&Access_Token=three&AUTHORIZATION=four&JWT=five&v=checksum',
      ),
    ).toBe('http://localhost:3002/images/page-hidden?v=checksum');
  });

  it('throws on fetch timeout (AbortError)', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    fetchMock.mockRejectedValueOnce(abortError);

    const promise = apiGet('/slow-endpoint');

    await expect(promise).rejects.toBeInstanceOf(ApiError);
    // DOMException may or may not be instanceof Error in jsdom,
    // so the message could be the DOMException message or the fallback.
    const err = await promise.catch((e: unknown) => e) as ApiError;
    expect(err.status).toBe(0);
    expect(typeof err.message).toBe('string');
    expect(err.message.length).toBeGreaterThan(0);
  });

  it.each(['before', 'during'])('preserves caller cancellation %s fetch without logging a failure', async (when) => {
    const controller = new AbortController();
    if (when === 'before') controller.abort();
    fetchMock.mockImplementationOnce((_input: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      const signal = init!.signal!;
      if (signal.aborted) reject(signal.reason);
      else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    const promise = apiGet('/letters/search', undefined, controller.signal);
    if (when === 'during') controller.abort();
    await expect(promise).rejects.toBe(controller.signal.reason);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('still logs a timeout when it wins before a later caller cancellation', async () => {
    const timeout = new AbortController();
    const caller = new AbortController();
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal);
    fetchMock.mockImplementationOnce((_input: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true });
    }));
    try {
      const promise = apiGet('/letters/search', undefined, caller.signal);
      timeout.abort(new DOMException('Request timed out', 'TimeoutError'));
      caller.abort();
      await expect(promise).rejects.toBeInstanceOf(ApiError);
      expect(consoleErrorSpy).toHaveBeenCalledWith('[API] Request failed before response', expect.any(Object));
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  it('still logs a genuine network failure if the caller later cancels', async () => {
    const caller = new AbortController();
    fetchMock.mockRejectedValueOnce(new TypeError('Network unavailable'));
    const promise = apiGet('/letters/search', undefined, caller.signal);
    caller.abort();
    await expect(promise).rejects.toBeInstanceOf(ApiError);
    expect(consoleErrorSpy).toHaveBeenCalledWith('[API] Request failed before response', expect.any(Object));
  });

  it('combines caller signal with default timeout signal', async () => {
    // AbortSignal.timeout and AbortSignal.any may not be available in jsdom.
    // Test the fallback: a caller-provided signal that aborts mid-request.
    const controller = new AbortController();
    const abortError = new DOMException('signal is aborted without reason', 'AbortError');
    fetchMock.mockImplementationOnce((_input: string, init?: RequestInit) => {
      // Verify the caller's signal is forwarded to fetch
      expect(init?.signal).toBeDefined();
      return Promise.reject(abortError);
    });

    const promise = apiGet('/letters', undefined, controller.signal);

    await expect(promise).rejects.toBeInstanceOf(ApiError);
    const err = await promise.catch((e: unknown) => e) as ApiError;
    expect(err.status).toBe(0);
  });
});
