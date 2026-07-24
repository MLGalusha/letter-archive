import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  regenerateTranscription,
  transcribeLetter,
} from '../transcription';

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

function successfulResponse() {
  return new Response(JSON.stringify({
    letter: { id: 'letter-1' },
    transcribed: { pageCount: 1, textLength: 12 },
    regenerated: { mainTranscript: true, extras: true, extrasCount: 1 },
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('admin transcription api', () => {
  it('sends the source revision for direct letter transcription', async () => {
    fetchMock.mockResolvedValueOnce(successfulResponse());

    await transcribeLetter('letter-1', 7);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3002/admin/letters/letter-1/transcribe-letter',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ primarySourceRevision: 7 }),
      }),
    );
  });

  it('sends one source revision for combined transcription regeneration', async () => {
    fetchMock.mockResolvedValueOnce(successfulResponse());

    await regenerateTranscription('letter-1', 7, true);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3002/admin/letters/letter-1/regenerate-transcription?includeExtras=true',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ primarySourceRevision: 7 }),
      }),
    );
  });
});
