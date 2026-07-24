import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  describePhoto,
  unverifyPhotoDescription,
  updatePhotoDescription,
  verifyPhotoDescription,
} from '../photoDescriptions';

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

describe('admin photo descriptions api', () => {
  it('sends AI context to the describe-photo route', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ letter: { id: 'letter-1' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await describePhoto('letter-1', 'Likely Jimmy and Molly', 9);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3002/admin/letters/letter-1/describe-photo',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({
          photoDescriptionContext: 'Likely Jimmy and Molly',
          primarySourceRevision: 9,
        }),
      }),
    );
  });

  it('sends photo description updates using the backend route contract', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'letter-1' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await updatePhotoDescription(
      'letter-1',
      'Two children standing on a porch.',
      9,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3002/admin/letters/letter-1/photo-description',
      expect.objectContaining({
        method: 'PUT',
        credentials: 'include',
        body: JSON.stringify({
          photoDescription: 'Two children standing on a porch.',
          primarySourceRevision: 9,
        }),
      }),
    );
  });

  it.each([
    {
      action: verifyPhotoDescription,
      path: 'verify-photo-description',
    },
    {
      action: unverifyPhotoDescription,
      path: 'unverify-photo-description',
    },
  ])('sends the source revision when calling $path', async ({ action, path }) => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'letter-1' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await action('letter-1', 9);

    expect(fetchMock).toHaveBeenCalledWith(
      `http://localhost:3002/admin/letters/letter-1/${path}`,
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ primarySourceRevision: 9 }),
      }),
    );
  });
});
