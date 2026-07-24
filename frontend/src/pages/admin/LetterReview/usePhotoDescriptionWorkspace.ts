import {
  startTransition,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
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

type Options = {
  letter: Letter | null;
  saving: boolean;
  setSaving: Dispatch<SetStateAction<boolean>>;
  tryAdoptLetter: (letter: Letter) => boolean;
  scheduleDebouncedSave: ScheduleDebouncedSave;
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
  letter,
  saving,
  setSaving,
  tryAdoptLetter,
  scheduleDebouncedSave,
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
  const isActive = () => activeOwner.current === owner;

  const describe = async () => {
    if (!letter) return;
    update({ generating: true });

    try {
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
    }
  };

  const toggleVerification = async () => {
    if (!letter) return;
    const verified = letter.photoDescriptionStatus === 'VERIFIED';
    setSaving(true);

    try {
      const updated = await (verified
        ? unverifyPhotoDescription
        : verifyPhotoDescription)(letter.id, letter.primarySourceRevision);
      if (!isActive() || !tryAdoptLetter(updated)) return;

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
      setSaving(false);
    }
  };

  const changeDescription = (description: string) => {
    startTransition(() => update({ description }));
    if (!letter) return;

    scheduleDebouncedSave(
      async () => {
        try {
          const updated = await updatePhotoDescription(
            letter.id,
            description,
            letter.primarySourceRevision,
          );
          if (isActive()) tryAdoptLetter(updated);
        } catch (error) {
          // The shared scheduler owns current-session errors. A stale session
          // resolves quietly so its captured mutation owner cannot poison a
          // later visit to the same letter.
          if (isActive()) throw error;
        }
      },
      {
        errorMessage: 'Failed to save photo description',
        onError: (error) => {
          console.error('Photo description auto-save error:', error);
        },
      },
    );
  };

  return {
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
