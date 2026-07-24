import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteLetter } from '../letters';

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

describe('letter deletion api', () => {
  it('binds deletion to the observed primary source revision', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      message: 'Letter deleted successfully',
      letterId: 'letter-1',
      deletedCount: 2,
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await deleteLetter('letter-1', 7);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3002/admin/letters/letter-1',
      expect.objectContaining({
        method: 'DELETE',
        credentials: 'include',
        body: JSON.stringify({ primarySourceRevision: 7 }),
      }),
    );
  });
});
