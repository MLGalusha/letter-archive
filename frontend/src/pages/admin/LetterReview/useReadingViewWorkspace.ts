import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { generateReadingView } from '../../../api/admin';
import { useToast } from '../../../contexts/ToastContext';
import type { Letter } from '../../../types/Letter';
import { getPrimaryImageType } from '../../../utils/letterContent';
import type { ExecuteLetterReviewMutation } from './useLetterReviewMutationExecutor';
import type { LetterReviewVisit } from './useLetterReviewVisit';

interface UseReadingViewWorkspaceOptions {
  visit: LetterReviewVisit;
  letter: Letter | null;
  transcriptText: string;
  surfaceActive: boolean;
  executeLetterMutation: ExecuteLetterReviewMutation;
}

interface ReadingViewSession {
  owner: LetterReviewVisit;
  readingViewOpen: boolean;
  generating: boolean;
}

const sessionFrom = (owner: LetterReviewVisit): ReadingViewSession => ({
  owner,
  readingViewOpen: false,
  generating: false,
});

/**
 * Owns Reading View state and generation for one Letter Review visit.
 *
 * The guarded Letter remains the only reading-text source, while the shared
 * mutation executor owns save ordering and authoritative DTO adoption.
 */
export function useReadingViewWorkspace({
  visit,
  letter,
  transcriptText,
  surfaceActive,
  executeLetterMutation,
}: UseReadingViewWorkspaceOptions) {
  const { showToast } = useToast();
  const hideReadingView = !letter
    || getPrimaryImageType(letter) !== 'letter';
  const canOpen = surfaceActive
    && !hideReadingView
    && transcriptText.trim().length > 0;
  const canOpenRef = useRef(canOpen);
  const [storedSession, setStoredSession] = useState(
    () => sessionFrom(visit),
  );
  const sessionIsCurrent = storedSession.owner === visit;
  const session = sessionIsCurrent
    ? storedSession
    : sessionFrom(visit);
  const readingViewOpen = canOpen && session.readingViewOpen;

  useLayoutEffect(() => {
    canOpenRef.current = canOpen;
    setStoredSession((current) => {
      const owned = current.owner === visit
        ? current
        : sessionFrom(visit);
      return !canOpen && owned.readingViewOpen
        ? { ...owned, readingViewOpen: false }
        : owned;
    });
  }, [canOpen, visit]);

  const updateSession = useCallback((
    patch: Partial<Omit<ReadingViewSession, 'owner'>>,
  ) => {
    setStoredSession((current) => (
      current.owner === visit
        ? { ...current, ...patch }
        : current
    ));
  }, [visit]);

  const setReadingViewOpen = useCallback((open: boolean) => {
    if (!visit.isActive() || (open && !canOpenRef.current)) {
      return;
    }
    updateSession({ readingViewOpen: open });
  }, [updateSession, visit]);

  const generate = useCallback(async (): Promise<boolean> => {
    if (!visit.isActive() || !letter || !canOpenRef.current) {
      return false;
    }

    let accepted = false;
    let started = false;

    try {
      await executeLetterMutation({
        request: () => {
          started = true;
          updateSession({ generating: true });
          return generateReadingView(
            letter.id,
            letter.primarySourceRevision,
          );
        },
        failureMessage: 'Failed to generate reading view',
        afterAdopt: () => {
          if (!visit.isActive()) return;
          accepted = true;
          showToast('Reading view generated', 'success');
        },
      });
      return accepted;
    } finally {
      if (started) {
        updateSession({ generating: false });
      }
    }
  }, [
    executeLetterMutation,
    letter,
    showToast,
    updateSession,
    visit,
  ]);
  const onGenerateReadingView = useCallback(() => {
    void generate();
  }, [generate]);

  return {
    readingViewOpen,
    generate,
    sectionProps: {
      readingViewOpen,
      onReadingViewOpenChange: setReadingViewOpen,
      readerText: letter?.readingText ?? '',
      hideReadingView,
      onGenerateReadingView,
      readingViewGenerating: session.generating,
    },
  } as const;
}
