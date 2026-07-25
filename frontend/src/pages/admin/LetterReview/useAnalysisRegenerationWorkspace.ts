import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  regenerateMetadata,
  reExtractLetter,
} from '../../../api/admin/letters';
import { useToast } from '../../../contexts/ToastContext';
import type { Letter } from '../../../types/Letter';
import { trackEdit } from '../../../utils/recentEdits';
import type { ExecuteLetterReviewMutation } from './useLetterReviewMutationExecutor';
import type { ScheduleLetterReviewStatusReset } from './useLetterReviewStatusResets';
import type { LetterReviewVisit } from './useLetterReviewVisit';

export type AnalysisRegenerationChoice =
  | 'metadata'
  | 'entities'
  | 'both';

export interface AnalysisRegenerationChoiceResult {
  accepted: boolean;
  shouldRestoreFocus: boolean;
}

type AnalysisProgress =
  | { phase: 'idle' }
  | { phase: 'working'; attempt: symbol }
  | { phase: 'done'; attempt: symbol };

type ProgressLane = 'metadata' | 'entity';

interface CorrectionDraft {
  sender: string;
  recipient: string;
}

interface AnalysisRegenerationSession {
  owner: LetterReviewVisit;
  dialog: CorrectionDraft | null;
  progress: Record<ProgressLane, AnalysisProgress>;
}

interface UseAnalysisRegenerationWorkspaceOptions {
  visit: LetterReviewVisit;
  letter: Letter | null;
  sender: string;
  recipient: string;
  executeLetterMutation: ExecuteLetterReviewMutation;
  scheduleStatusReset: ScheduleLetterReviewStatusReset;
}

const sessionFrom = (
  owner: LetterReviewVisit,
): AnalysisRegenerationSession => ({
  owner,
  dialog: null,
  progress: {
    metadata: { phase: 'idle' },
    entity: { phase: 'idle' },
  },
});

const withProgress = (
  session: AnalysisRegenerationSession,
  lane: ProgressLane,
  progress: AnalysisProgress,
): AnalysisRegenerationSession => ({
  ...session,
  progress: {
    ...session.progress,
    [lane]: progress,
  },
});

/**
 * Owns analysis regeneration for one committed Letter Review visit.
 *
 * The mutation executor remains the sole owner of saving leases, autosave
 * ordering, guarded adoption, hydration, and request-failure reporting. This
 * workspace owns the domain intent, request envelopes, progress, success
 * feedback, and recent-edit publication that follow an accepted response.
 */
export function useAnalysisRegenerationWorkspace({
  visit,
  letter,
  sender,
  recipient,
  executeLetterMutation,
  scheduleStatusReset,
}: UseAnalysisRegenerationWorkspaceOptions) {
  const { showToast } = useToast();
  const [storedSession, setStoredSession] = useState(
    () => sessionFrom(visit),
  );
  const activeAttemptsRef = useRef<Record<ProgressLane, symbol | null>>({
    metadata: null,
    entity: null,
  });
  const session = storedSession.owner === visit
    ? storedSession
    : sessionFrom(visit);

  useLayoutEffect(() => {
    activeAttemptsRef.current = {
      metadata: null,
      entity: null,
    };
    setStoredSession((current) => (
      current.owner === visit
        ? current
        : sessionFrom(visit)
    ));

    return () => {
      activeAttemptsRef.current = {
        metadata: null,
        entity: null,
      };
    };
  }, [visit]);

  const updateSession = useCallback((
    update: (
      current: AnalysisRegenerationSession,
    ) => AnalysisRegenerationSession,
  ) => {
    setStoredSession((current) => update(
      current.owner === visit
        ? current
        : sessionFrom(visit),
    ));
  }, [visit]);

  const openDialog = useCallback(() => {
    if (!visit.isActive() || !letter) return;
    updateSession((current) => ({
      ...current,
      dialog: {
        sender: sender || '',
        recipient: recipient || '',
      },
    }));
  }, [
    letter,
    recipient,
    sender,
    updateSession,
    visit,
  ]);

  const closeDialog = useCallback(() => {
    if (!visit.isActive()) return;
    updateSession((current) => ({
      ...current,
      dialog: null,
    }));
  }, [updateSession, visit]);

  const changeDialogField = useCallback((
    field: keyof CorrectionDraft,
    value: string,
  ) => {
    if (!visit.isActive()) return;
    updateSession((current) => (
      current.dialog
        ? {
            ...current,
            dialog: {
              ...current.dialog,
              [field]: value,
            },
          }
        : current
    ));
  }, [updateSession, visit]);

  const scheduleDoneReset = useCallback((
    lane: ProgressLane,
    attempt: symbol,
  ) => {
    scheduleStatusReset(
      lane === 'metadata'
        ? 'metadata-regeneration'
        : 'entity-reextract',
      () => {
        setStoredSession((current) => {
          const progress = current.progress[lane];
          if (
            current.owner !== visit
            || progress.phase !== 'done'
            || progress.attempt !== attempt
          ) {
            return current;
          }
          return withProgress(current, lane, { phase: 'idle' });
        });
      },
      2_000,
    );
  }, [scheduleStatusReset, visit]);

  const regenerate = useCallback(async (
    choice: AnalysisRegenerationChoice,
    corrections?: CorrectionDraft,
  ): Promise<boolean> => {
    if (!visit.isActive() || !letter) return false;

    const target = {
      id: letter.id,
      primarySourceRevision: letter.primarySourceRevision,
      confirmedSender: choice === 'metadata'
        ? corrections?.sender || undefined
        : corrections?.sender || sender || undefined,
      confirmedRecipient: choice === 'metadata'
        ? corrections?.recipient || undefined
        : corrections?.recipient || recipient || undefined,
    };
    const lane: ProgressLane | null = choice === 'metadata'
      ? 'metadata'
      : choice === 'entities'
        ? 'entity'
        : null;
    const attempt = Symbol(`analysis-regeneration-${choice}`);
    let accepted = false;
    let started = false;

    try {
      await executeLetterMutation({
        request: async () => {
          started = true;
          if (lane) {
            activeAttemptsRef.current[lane] = attempt;
            updateSession((current) => withProgress(
              current,
              lane,
              { phase: 'working', attempt },
            ));
          }

          if (choice === 'metadata') {
            return regenerateMetadata(
              target.id,
              target.primarySourceRevision,
              {
                confirmedSender: target.confirmedSender,
                confirmedRecipient: target.confirmedRecipient,
              },
            );
          }

          return reExtractLetter(target.id, {
            primarySourceRevision: target.primarySourceRevision,
            confirmedSender: target.confirmedSender,
            confirmedRecipient: target.confirmedRecipient,
            mode: choice === 'entities' ? 'entities_only' : 'full',
          });
        },
        failureMessage: choice === 'metadata'
          ? 'Failed to regenerate metadata'
          : 'Re-extraction failed',
        afterAdopt: (updatedLetter) => {
          if (!visit.isActive()) return;
          if (
            lane
            && activeAttemptsRef.current[lane] !== attempt
          ) {
            return;
          }

          accepted = true;
          if (lane) {
            activeAttemptsRef.current[lane] = null;
            updateSession((current) => withProgress(
              current,
              lane,
              { phase: 'done', attempt },
            ));
          }

          if (choice === 'metadata') {
            showToast('Metadata regenerated', 'success');
            scheduleDoneReset('metadata', attempt);
            return;
          }

          if (choice === 'entities') {
            showToast('Entities re-extracted', 'success');
            scheduleDoneReset('entity', attempt);
          } else {
            showToast(
              'Metadata re-extracted with corrections',
              'success',
            );
          }

          trackEdit({
            id: updatedLetter.id,
            metadata: updatedLetter.metadata,
            collectionCode: updatedLetter.collectionCode,
          });
        },
      });
      return accepted;
    } finally {
      if (
        lane
        && started
        && !accepted
        && visit.isActive()
        && activeAttemptsRef.current[lane] === attempt
      ) {
        activeAttemptsRef.current[lane] = null;
        updateSession((current) => {
          const progress = current.progress[lane];
          if (
            progress.phase !== 'working'
            || progress.attempt !== attempt
          ) {
            return current;
          }
          return withProgress(current, lane, { phase: 'idle' });
        });
      }
    }
  }, [
    executeLetterMutation,
    letter,
    recipient,
    scheduleDoneReset,
    sender,
    showToast,
    updateSession,
    visit,
  ]);

  const choose = useCallback(async (
    choice: AnalysisRegenerationChoice,
  ): Promise<AnalysisRegenerationChoiceResult> => {
    if (!visit.isActive() || !session.dialog) {
      return {
        accepted: false,
        shouldRestoreFocus: false,
      };
    }
    const corrections = session.dialog;
    updateSession((current) => ({
      ...current,
      dialog: null,
    }));
    const accepted = await regenerate(choice, corrections);
    return {
      accepted,
      shouldRestoreFocus: visit.isActive(),
    };
  }, [
    regenerate,
    session.dialog,
    updateSession,
    visit,
  ]);

  const requestEntityRegeneration = useCallback(() => {
    if (!visit.isActive() || !letter) return;
    if (!window.confirm(
      'Re-extract entities from the transcript? This will overwrite current entity data.',
    )) {
      return;
    }
    void regenerate('entities');
  }, [letter, regenerate, visit]);

  return {
    metadataSectionProps: {
      regenerateState: session.progress.metadata.phase === 'working'
        ? 'regenerating'
        : session.progress.metadata.phase,
      onRegenerateMetadata: openDialog,
    },
    entitySectionProps: {
      reExtractState: session.progress.entity.phase === 'working'
        ? 'extracting'
        : session.progress.entity.phase,
      onReExtractEntities: requestEntityRegeneration,
    },
    dialogProps: {
      isOpen: session.dialog !== null,
      sender: session.dialog?.sender ?? '',
      recipient: session.dialog?.recipient ?? '',
      onSenderChange: (value: string) => {
        changeDialogField('sender', value);
      },
      onRecipientChange: (value: string) => {
        changeDialogField('recipient', value);
      },
      onChoose: choose,
      onClose: closeDialog,
    },
  } as const;
}
