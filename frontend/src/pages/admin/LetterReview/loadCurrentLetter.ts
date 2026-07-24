import type { Letter } from '../../../types/Letter';

interface LoadCurrentLetterOptions {
  requestedLetterId: string;
  isCurrent: () => boolean;
  getLetter: (letterId: string) => Promise<Letter>;
  adoptAndHydrate: (letter: Letter) => void;
}

/**
 * Delivers a route load only while it still owns the active request.
 *
 * Adoption and draft hydration intentionally share one guarded callback so a
 * late response can update neither half of the editor.
 */
export async function loadCurrentLetter({
  requestedLetterId,
  isCurrent,
  getLetter,
  adoptAndHydrate,
}: LoadCurrentLetterOptions): Promise<boolean> {
  const foundLetter = await getLetter(requestedLetterId);
  if (!isCurrent() || foundLetter.id !== requestedLetterId) {
    return false;
  }

  adoptAndHydrate(foundLetter);
  return true;
}
