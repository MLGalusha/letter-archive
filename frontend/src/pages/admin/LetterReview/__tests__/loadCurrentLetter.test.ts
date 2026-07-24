import { describe, expect, it, vi } from 'vitest';
import type { Letter } from '../../../../types/Letter';
import { loadCurrentLetter } from '../loadCurrentLetter';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function routeLetter(
  id: string,
  transcript: string,
  primarySourceRevision: number,
): Letter {
  return {
    id,
    primarySourceRevision,
    transcript: { fullText: transcript },
  } as Letter;
}

describe('loadCurrentLetter', () => {
  it('keeps fast-B DTO, drafts, and autosave ownership after late A resolves', async () => {
    const requestA = deferred<Letter>();
    const requestB = deferred<Letter>();
    const letterA = routeLetter('letter-a', 'draft from A', 7);
    const letterB = routeLetter('letter-b', 'draft from B', 3);
    const getLetter = vi.fn((letterId: string) => (
      letterId === 'letter-a' ? requestA.promise : requestB.promise
    ));
    const editor = {
      letter: null as Letter | null,
      transcriptDraft: '',
    };
    const autosave = vi.fn();
    const adoptAndHydrate = (letter: Letter) => {
      editor.letter = letter;
      editor.transcriptDraft = letter.transcript.fullText;
    };

    let requestAIsCurrent = true;
    const slowA = loadCurrentLetter({
      requestedLetterId: 'letter-a',
      isCurrent: () => requestAIsCurrent,
      getLetter,
      adoptAndHydrate,
    });

    requestAIsCurrent = false;
    const fastB = loadCurrentLetter({
      requestedLetterId: 'letter-b',
      isCurrent: () => true,
      getLetter,
      adoptAndHydrate,
    });

    requestB.resolve(letterB);
    await expect(fastB).resolves.toBe(true);
    autosave({
      letterId: editor.letter?.id,
      primarySourceRevision: editor.letter?.primarySourceRevision,
      transcript: editor.transcriptDraft,
    });

    requestA.resolve(letterA);
    await expect(slowA).resolves.toBe(false);
    autosave({
      letterId: editor.letter?.id,
      primarySourceRevision: editor.letter?.primarySourceRevision,
      transcript: editor.transcriptDraft,
    });

    expect(editor.letter).toBe(letterB);
    expect(editor.transcriptDraft).toBe('draft from B');
    expect(autosave).toHaveBeenNthCalledWith(1, {
      letterId: 'letter-b',
      primarySourceRevision: 3,
      transcript: 'draft from B',
    });
    expect(autosave).toHaveBeenNthCalledWith(2, {
      letterId: 'letter-b',
      primarySourceRevision: 3,
      transcript: 'draft from B',
    });
  });
});
