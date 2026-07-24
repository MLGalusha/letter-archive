import {
  startTransition,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  describePhoto,
  unverifyPhotoDescription,
  updatePhotoDescription,
  verifyPhotoDescription,
} from '../../../api/admin';
import { useToast } from '../../../contexts/ToastContext';
import type { Letter } from '../../../types/Letter';
import type { ScheduleDebouncedSave } from './useAutoSave';
import type { BeginLetterSaving } from './useLetterSavingState';
import type { LetterReviewVisit } from './useLetterReviewVisit';

type Options = {
  visit: LetterReviewVisit;
  letter: Letter | null;
  saving: boolean;
  beginSaving: BeginLetterSaving;
  tryAdoptLetter: (letter: Letter) => boolean;
  scheduleDebouncedSave: ScheduleDebouncedSave;
  flushPendingSaves: () => Promise<boolean>;
  handleMutationError: (error: unknown, fallback: string) => boolean;
};

type State = {
  owner: symbol;
  description: string;
  draftContext: string;
  dialogOpen: boolean;
  generating: boolean;
};

const identityOf = (letter: Letter | null) =>
  letter ? `${letter.id}:${letter.primarySourceRevision}` : '';

const stateFrom = (letter: Letter | null, owner: symbol): State => ({
  owner,
  description: letter?.photoDescription ?? '',
  draftContext: letter?.photoDescriptionContext ?? '',
  dialogOpen: false,
  generating: false,
});

export function usePhotoDescriptionWorkspace({
  visit,
  letter,
  saving,
  beginSaving,
  tryAdoptLetter,
  scheduleDebouncedSave,
  flushPendingSaves,
  handleMutationError,
}: Options) {
  const { showToast } = useToast();
  const identity = identityOf(letter);
  const owner = useMemo(() => Symbol(identity), [identity]);
  const activeOwner = useRef(owner);
  const [stored, setStored] = useState(() => stateFrom(letter, owner));
  const state = stored.owner === owner ? stored : stateFrom(letter, owner);

  useLayoutEffect(() => {
    activeOwner.current = owner;
    setStored((current) => (
      current.owner === owner ? current : stateFrom(letter, owner)
    ));
    // `owner` is the session boundary. Same-owner Letter DTO updates must not
    // overwrite a local draft, so the full object is intentionally excluded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner]);

  const update = (patch: Partial<State>) => {
    setStored((current) => ({
      ...(current.owner === owner ? current : stateFrom(letter, owner)),
      ...patch,
    }));
  };
  const isActive = () => (
    visit.isActive() && activeOwner.current === owner
  );
  const hydratePersistedLetter = useCallback((updatedLetter: Letter) => {
    if (!visit.isActive() || activeOwner.current !== owner) return;
    setStored((current) => ({
      ...(current.owner === owner
        ? current
        : stateFrom(updatedLetter, owner)),
      description: updatedLetter.photoDescription ?? '',
      draftContext: updatedLetter.photoDescriptionContext ?? '',
    }));
  }, [owner, visit]);

  const describe = async () => {
    if (!letter) return;
    update({ generating: true });
    const releaseSaving = beginSaving();

    try {
      if (!isActive() || !await flushPendingSaves()) return;

      const result = await describePhoto(
        letter.id,
        state.draftContext,
        letter.primarySourceRevision,
      );
      if (!isActive() || !tryAdoptLetter(result.letter)) return;

      update({
        description: result.letter.photoDescription ?? '',
        draftContext: result.letter.photoDescriptionContext ?? '',
        dialogOpen: false,
      });
      const generated = result.describedCount > 0;
      showToast(
        generated
          ? `Generated ${result.describedCount} photo description draft(s)`
          : 'No photo description was generated',
        generated ? 'success' : 'info',
      );
    } catch (error) {
      if (isActive()) {
        handleMutationError(error, 'Failed to describe photo');
      }
    } finally {
      if (isActive()) update({ generating: false });
      releaseSaving();
    }
  };

  const toggleVerification = async () => {
    if (!letter) return;
    const verified = letter.photoDescriptionStatus === 'VERIFIED';
    const releaseSaving = beginSaving();

    try {
      if (!isActive() || !await flushPendingSaves()) return;

      const updated = await (verified
        ? unverifyPhotoDescription
        : verifyPhotoDescription)(letter.id, letter.primarySourceRevision);
      if (!isActive() || !tryAdoptLetter(updated)) return;
      hydratePersistedLetter(updated);

      showToast(
        verified
          ? 'Photo description verification removed'
          : 'Photo description verified',
        verified ? 'info' : 'success',
      );
    } catch (error) {
      if (isActive()) {
        handleMutationError(
          error,
          `Failed to ${verified ? 'unverify' : 'verify'} photo description`,
        );
      }
    } finally {
      releaseSaving();
    }
  };

  const changeDescription = (description: string) => {
    startTransition(() => update({ description }));
    if (!letter) return;

    scheduleDebouncedSave(
      async () => {
        const updated = await updatePhotoDescription(
          letter.id,
          description,
          letter.primarySourceRevision,
        );
        if (isActive()) tryAdoptLetter(updated);
      },
      {
        lane: 'photo-description',
        errorMessage: 'Failed to save photo description',
        onError: (error) => {
          console.error('Photo description auto-save error:', error);
        },
      },
    );
  };

  return {
    hydratePersistedLetter,
    sectionProps: {
      letter: {
        photoDescriptionStatus: letter?.photoDescriptionStatus,
        photoDescriptionVerifiedAt: letter?.photoDescriptionVerifiedAt,
        photoDescriptionContext: letter?.photoDescriptionContext,
      },
      photoDescription: state.description,
      photoDescriptionGenerating: state.generating,
      saving,
      onDescribePhoto: () => update({
        draftContext: letter?.photoDescriptionContext ?? '',
        dialogOpen: true,
      }),
      onVerifyPhotoDescription: () => void toggleVerification(),
      onPhotoDescriptionChange: changeDescription,
    },
    dialogProps: {
      view: {
        isOpen: state.dialogOpen,
        hasDescription: Boolean(state.description.trim()),
        hasSavedContext: Boolean(letter?.photoDescriptionContext?.trim()),
        draftContext: state.draftContext,
        generating: state.generating,
      },
      onContextChange: (draftContext: string) => update({ draftContext }),
      onCancel: () => {
        if (!state.generating) update({ dialogOpen: false });
      },
      onSubmit: () => void describe(),
    },
  };
}
