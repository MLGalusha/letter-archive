import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { transcribeLetter } from '../../../api/admin';
import { useToast } from '../../../contexts/ToastContext';
import type { Letter } from '../../../types/Letter';
import type { ExecuteLetterReviewMutation } from './useLetterReviewMutationExecutor';
import type { ScheduleLetterReviewStatusReset } from './useLetterReviewStatusResets';
import type { LetterReviewVisit } from './useLetterReviewVisit';

type TranscriptionProgress =
  | { phase: 'idle' }
  | { phase: 'transcribing'; attempt: symbol }
  | { phase: 'done'; attempt: symbol; pageCount: number };

interface TranscriptionSession {
  owner: LetterReviewVisit;
  regenerationDialogOpen: boolean;
  progress: TranscriptionProgress;
}

interface UseLetterTranscriptionWorkspaceOptions {
  visit: LetterReviewVisit;
  letter: Letter | null;
  transcriptText: string;
  executeLetterMutation: ExecuteLetterReviewMutation;
  scheduleStatusReset: ScheduleLetterReviewStatusReset;
}

const sessionFrom = (
  owner: LetterReviewVisit,
): TranscriptionSession => ({
  owner,
  regenerationDialogOpen: false,
  progress: { phase: 'idle' },
});

const messageFrom = (
  progress: TranscriptionProgress,
): string | null => {
  if (progress.phase === 'transcribing') {
    return 'Transcribing letter...';
  }
  if (progress.phase === 'done') {
    return `Transcribed ${progress.pageCount} page(s)`;
  }
  return null;
};

/**
 * Owns main-letter transcription for one committed Letter Review visit.
 *
 * The route still composes cross-domain Letter/Extras choices. This workspace
 * owns visible-draft replacement intent, response-envelope adaptation,
 * progress, accepted-result truth, and its completion reset.
 */
export function useLetterTranscriptionWorkspace({
  visit,
  letter,
  transcriptText,
  executeLetterMutation,
  scheduleStatusReset,
}: UseLetterTranscriptionWorkspaceOptions) {
  const { showToast } = useToast();
  const [storedSession, setStoredSession] = useState(
    () => sessionFrom(visit),
  );
  const activeAttemptRef = useRef<symbol | null>(null);
  const session = storedSession.owner === visit
    ? storedSession
    : sessionFrom(visit);

  useLayoutEffect(() => {
    activeAttemptRef.current = null;
    setStoredSession((current) => (
      current.owner === visit
        ? current
        : sessionFrom(visit)
    ));

    return () => {
      activeAttemptRef.current = null;
    };
  }, [visit]);

  const updateSession = useCallback((
    update: (current: TranscriptionSession) => TranscriptionSession,
  ) => {
    setStoredSession((current) => update(
      current.owner === visit
        ? current
        : sessionFrom(visit),
    ));
  }, [visit]);

  const closeRegenerationDialog = useCallback(() => {
    if (!visit.isActive()) return;
    updateSession((current) => ({
      ...current,
      regenerationDialogOpen: false,
    }));
  }, [updateSession, visit]);

  const scheduleDoneReset = useCallback((attempt: symbol) => {
    scheduleStatusReset('transcription', () => {
      setStoredSession((current) => {
        if (
          current.owner !== visit
          || current.progress.phase !== 'done'
          || current.progress.attempt !== attempt
        ) {
          return current;
        }
        return {
          ...current,
          progress: { phase: 'idle' },
        };
      });
    }, 3_000);
  }, [scheduleStatusReset, visit]);

  const transcribe = useCallback(async (): Promise<boolean> => {
    if (!visit.isActive() || !letter) return false;

    const attempt = Symbol('letter-transcription');
    let accepted = false;
    let started = false;
    let pageCount = 0;

    try {
      await executeLetterMutation({
        request: async () => {
          started = true;
          activeAttemptRef.current = attempt;
          updateSession((current) => ({
            ...current,
            progress: {
              phase: 'transcribing',
              attempt,
            },
          }));

          const result = await transcribeLetter(
            letter.id,
            letter.primarySourceRevision,
          );
          pageCount = result.transcribed.pageCount;
          return result.letter;
        },
        failureMessage: 'Transcription failed',
        afterAdopt: () => {
          if (
            !visit.isActive()
            || activeAttemptRef.current !== attempt
          ) {
            return;
          }

          accepted = true;
          activeAttemptRef.current = null;
          updateSession((current) => ({
            ...current,
            progress: {
              phase: 'done',
              attempt,
              pageCount,
            },
          }));
          scheduleDoneReset(attempt);
          showToast(
            `Letter transcribed (${pageCount} page(s))`,
            'success',
          );
        },
      });
      return accepted;
    } finally {
      if (
        started
        && !accepted
        && visit.isActive()
        && activeAttemptRef.current === attempt
      ) {
        activeAttemptRef.current = null;
        updateSession((current) => (
          current.progress.phase === 'transcribing'
          && current.progress.attempt === attempt
            ? {
                ...current,
                progress: { phase: 'idle' },
              }
            : current
        ));
      }
    }
  }, [
    executeLetterMutation,
    letter,
    scheduleDoneReset,
    showToast,
    updateSession,
    visit,
  ]);

  const requestTranscription = useCallback(async (): Promise<boolean> => {
    if (!visit.isActive() || !letter) return false;
    if (transcriptText.trim()) {
      updateSession((current) => ({
        ...current,
        regenerationDialogOpen: true,
      }));
      return false;
    }
    return transcribe();
  }, [
    letter,
    transcribe,
    transcriptText,
    updateSession,
    visit,
  ]);

  const onTranscribeLetter = useCallback(() => {
    void requestTranscription();
  }, [requestTranscription]);

  return {
    regenerationDialogOpen: session.regenerationDialogOpen,
    closeRegenerationDialog,
    requestTranscription,
    transcribe,
    sectionProps: {
      letterTranscribeState: session.progress.phase,
      letterTranscribeMessage: messageFrom(session.progress),
      onTranscribeLetter,
    },
  } as const;
}
