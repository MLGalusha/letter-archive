import {
  startTransition,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  transcribeExtras,
  unverifyExtraContent,
  updateExtraContent,
  verifyExtraContent,
} from '../../../api/admin';
import { useToast } from '../../../contexts/ToastContext';
import type { Letter } from '../../../types/Letter';
import type { ScheduleDebouncedSave } from './useAutoSave';
import type { ExecuteLetterReviewMutation } from './useLetterReviewMutationExecutor';
import type { LetterReviewVisit } from './useLetterReviewVisit';

interface UseExtraContentWorkspaceOptions {
  visit: LetterReviewVisit;
  letter: Letter | null;
  saving: boolean;
  scheduleDebouncedSave: ScheduleDebouncedSave;
  tryAdoptLetter: (letter: Letter) => boolean;
  executeLetterMutation: ExecuteLetterReviewMutation;
}

interface ExtraContentState {
  owner: symbol;
  content: string;
  persistedContent: string;
  transcribing: boolean;
  lineReviewBlocked: boolean;
}

interface TranscribeExtraContentOptions {
  confirmReplacement?: boolean;
}

const contentFrom = (letter: Letter | null): string =>
  letter?.extraContentTranscript ?? '';

const stateFrom = (
  owner: symbol,
  persistedContent: string,
): ExtraContentState => ({
  owner,
  content: persistedContent,
  persistedContent,
  transcribing: false,
  lineReviewBlocked: false,
});

/**
 * Owns the complete Extra Content editor workflow for one route/source visit.
 *
 * The shared autosave coordinator still owns target-wide save ordering, and
 * the direct-mutation executor still owns lease/flush/adoption ordering. This
 * workspace owns only Extra Content's draft, progress, edit-session gate,
 * response-envelope adaptation, API payloads, and success copy.
 */
export function useExtraContentWorkspace({
  visit,
  letter,
  saving,
  scheduleDebouncedSave,
  tryAdoptLetter,
  executeLetterMutation,
}: UseExtraContentWorkspaceOptions) {
  const { showToast } = useToast();
  const letterId = letter?.id;
  const primarySourceRevision = letter?.primarySourceRevision;
  const authoritativeContent = contentFrom(letter);
  const owner = useMemo(
    () => Symbol(
      `${visit.letterId ?? ''}:${letterId ?? ''}:${primarySourceRevision ?? ''}`,
    ),
    [letterId, primarySourceRevision, visit],
  );
  const activeOwner = useRef(owner);
  const [stored, setStored] = useState(
    () => stateFrom(owner, authoritativeContent),
  );
  const state = stored.owner === owner
    ? stored
    : stateFrom(owner, authoritativeContent);

  useLayoutEffect(() => {
    activeOwner.current = owner;
    setStored((current) => {
      const owned = current.owner === owner
        ? current
        : stateFrom(owner, authoritativeContent);
      if (owned.persistedContent === authoritativeContent) {
        return owned;
      }

      return {
        ...owned,
        content: owned.content === owned.persistedContent
          ? authoritativeContent
          : owned.content,
        persistedContent: authoritativeContent,
      };
    });
  }, [authoritativeContent, owner]);

  const isActive = useCallback(
    () => visit.isActive() && activeOwner.current === owner,
    [owner, visit],
  );

  const update = useCallback((patch: Partial<ExtraContentState>) => {
    setStored((current) => ({
      ...(current.owner === owner
        ? current
        : stateFrom(owner, authoritativeContent)),
      ...patch,
    }));
  }, [authoritativeContent, owner]);

  const hydratePersistedLetter = useCallback((
    updatedLetter: Letter,
    expectedDraft?: string,
  ) => {
    if (!isActive()) return;
    const persistedContent = contentFrom(updatedLetter);
    setStored((current) => {
      const owned = current.owner === owner
        ? current
        : stateFrom(owner, persistedContent);
      return {
        ...owned,
        content: expectedDraft === undefined
          || owned.content === expectedDraft
          ? persistedContent
          : owned.content,
        persistedContent,
      };
    });
  }, [isActive, owner]);

  const changeContent = useCallback((content: string) => {
    if (!isActive()) return;
    startTransition(() => update({ content }));
    if (!letter) return;

    scheduleDebouncedSave(
      async () => {
        const updated = await updateExtraContent(
          letter.id,
          content,
          letter.primarySourceRevision,
        );
        if (tryAdoptLetter(updated)) {
          hydratePersistedLetter(updated, content);
        }
      },
      {
        lane: 'extra-content',
        errorMessage: 'Failed to save extra content',
        onError: (error) => {
          console.error('Extra content auto-save error:', error);
        },
      },
    );
  }, [
    hydratePersistedLetter,
    isActive,
    letter,
    scheduleDebouncedSave,
    tryAdoptLetter,
    update,
  ]);

  const transcribe = useCallback(async ({
    confirmReplacement = true,
  }: TranscribeExtraContentOptions = {}): Promise<boolean> => {
    if (!letter) return false;
    if (
      confirmReplacement
      && state.content.trim()
      && !window.confirm(
        'Replace extra content transcription? This will overwrite the current content.',
      )
    ) {
      return false;
    }

    let accepted = false;
    let started = false;
    let transcribedCount = 0;

    try {
      await executeLetterMutation({
        request: async () => {
          started = true;
          if (isActive()) update({ transcribing: true });
          const result = await transcribeExtras(
            letter.id,
            letter.primarySourceRevision,
          );
          transcribedCount = result.transcribedCount;
          return result.letter;
        },
        failureMessage: 'Failed to transcribe extras',
        afterAdopt: (updatedLetter) => {
          hydratePersistedLetter(updatedLetter);
          accepted = true;
          if (transcribedCount > 0) {
            showToast(
              `Transcribed ${transcribedCount} extra item(s)`,
              'success',
            );
          } else {
            showToast('No transcribable extra content found', 'info');
          }
        },
      });
      return accepted;
    } finally {
      if (started && isActive()) update({ transcribing: false });
    }
  }, [
    executeLetterMutation,
    hydratePersistedLetter,
    isActive,
    letter,
    showToast,
    state.content,
    update,
  ]);

  const toggleVerification = useCallback(async () => {
    if (!letter) return;
    const verified = letter.extraContentStatus === 'VERIFIED';

    await executeLetterMutation({
      request: () => (verified
        ? unverifyExtraContent
        : verifyExtraContent)(
        letter.id,
        letter.primarySourceRevision,
      ),
      failureMessage:
        `Failed to ${verified ? 'unverify' : 'verify'} extra content`,
      afterAdopt: (updatedLetter) => {
        hydratePersistedLetter(updatedLetter);
        update({ lineReviewBlocked: verified });
        showToast(
          verified
            ? 'Extra content verification removed'
            : 'Extra content verified',
          verified ? 'info' : 'success',
        );
      },
    });
  }, [
    executeLetterMutation,
    hydratePersistedLetter,
    letter,
    showToast,
    update,
  ]);

  return {
    lineReviewBlocked: state.lineReviewBlocked,
    transcribe,
    sectionProps: {
      letter: {
        extraContentStatus: letter?.extraContentStatus,
        extraContentVerifiedAt: letter?.extraContentVerifiedAt,
      },
      extraContent: state.content,
      extraContentTranscribing: state.transcribing,
      saving,
      onTranscribeExtras: () => {
        void transcribe();
      },
      onVerifyExtraContent: () => {
        void toggleVerification();
      },
      onExtraContentChange: changeContent,
    },
  } as const;
}
