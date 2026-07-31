// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLayoutBenchmarkImageObjectUrl } from '../layoutBenchmark';

describe('layout benchmark API', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('loads prepared evidence privately and exposes only an opaque object URL to the DOM', async () => {
    localStorage.setItem('adminToken', 'test-admin-token');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      new Blob(['png'], { type: 'image/png' }),
      { status: 200, headers: { 'content-type': 'image/png' } },
    ));
    const createObjectUrl = vi.fn((blob: Blob) => {
      expect(blob.type).toBe('image/png');
      return 'blob:opaque-prepared-image';
    });
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectUrl,
    });

    const result = await getLayoutBenchmarkImageObjectUrl(
      '/images/layout-benchmark/runs/provider-specific-run/pages/page/prepared',
    );

    expect(result).toBe('blob:opaque-prepared-image');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        '/images/layout-benchmark/runs/provider-specific-run/pages/page/prepared',
      ),
      expect.objectContaining({
        credentials: 'include',
        headers: { Authorization: 'Bearer test-admin-token' },
      }),
    );
    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    expect(createObjectUrl.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      type: 'image/png',
    }));
  });

  it('rejects non-image responses before creating a DOM object URL', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      '{"error":"unexpected"}',
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    const createObjectUrl = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectUrl,
    });

    await expect(getLayoutBenchmarkImageObjectUrl(
      '/images/layout-benchmark/runs/run-a/pages/page/prepared',
    )).rejects.toThrow('unexpected content type');
    expect(createObjectUrl).not.toHaveBeenCalled();
  });
});
