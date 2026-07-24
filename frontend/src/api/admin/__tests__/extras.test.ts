import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  transcribeExtras,
  unverifyExtraContent,
  updateAiNotes,
  updateExtraContent,
  verifyExtraContent,
} from '../extras';

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

describe('admin extras api', () => {
  it('sends the source revision when transcribing extra content', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      letter: { id: 'letter-1' },
      transcribedCount: 0,
      extraContentStatus: 'EMPTY',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await transcribeExtras('letter-1', 7);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3002/admin/letters/letter-1/transcribe-extras',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ primarySourceRevision: 7 }),
      }),
    );
  });

  it('sends extra content updates using the backend route contract', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'letter-1' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await updateExtraContent('letter-1', 'Typed by an admin', 7);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3002/admin/letters/letter-1/extra-content',
      expect.objectContaining({
        method: 'PUT',
        credentials: 'include',
        body: JSON.stringify({
          extraContent: 'Typed by an admin',
          primarySourceRevision: 7,
        }),
      }),
    );
  });

  it.each([
    {
      action: verifyExtraContent,
      path: 'verify-extra-content',
    },
    {
      action: unverifyExtraContent,
      path: 'unverify-extra-content',
    },
  ])('sends the source revision when calling $path', async ({ action, path }) => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'letter-1' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await action('letter-1', 7);

    expect(fetchMock).toHaveBeenCalledWith(
      `http://localhost:3002/admin/letters/letter-1/${path}`,
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ primarySourceRevision: 7 }),
      }),
    );
  });

  it('sends the source revision when replacing AI notes', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'letter-1' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await updateAiNotes('letter-1', [], 7);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3002/admin/letters/letter-1/ai-notes',
      expect.objectContaining({
        method: 'PUT',
        credentials: 'include',
        body: JSON.stringify({
          aiNotes: [],
          primarySourceRevision: 7,
        }),
      }),
    );
  });
});
