import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { createVersion, updateLetter } from '../../../api/admin';
import { getErrorMessage } from '../../../api/client';
import { updateIdentity } from '../../../api/admin/letters';
import type { Letter } from '../../../types/Letter';
import { trackEdit } from '../../../utils/recentEdits';

type ToastType = 'success' | 'error' | 'info';
type ShowToast = (message: string, type: ToastType) => void;

export interface AutoSaveData {
  transcriptionText?: string;
  sender?: string | null;
  recipient?: string | null;
  locationWritten?: string | null;
  hook?: string | null;
  summary?: string | null;
  notes?: string | null;
  readingText?: string | null;
}

interface UseAutoSaveOptions {
  letterId?: string;
  letter: Letter | null;
  setLetter: Dispatch<SetStateAction<Letter | null>>;
  showToast: ShowToast;
  syncIdentityMetadata: (updatedLetter: Letter) => void;
}

interface DebouncedSaveOptions {
  delayMs?: number;
  errorMessage: string;
  onError?: (error: unknown) => void;
}

export function useAutoSave({
  letterId,
  letter,
  setLetter,
  showToast,
  syncIdentityMetadata,
}: UseAutoSaveOptions) {
  const [autoSaveStatus, setAutoSaveStatus] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle');
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPendingAutoSave = useCallback(() => {
    if (!autoSaveTimerRef.current) {
      return;
    }

    clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = null;
  }, []);

  const scheduleStatusReset = useCallback(
    (callback: () => void, delayMs: number) => {
      if (statusTimeoutRef.current) {
        clearTimeout(statusTimeoutRef.current);
      }

      statusTimeoutRef.current = setTimeout(callback, delayMs);
    },
    [],
  );

  const scheduleDebouncedSave = useCallback(
    (task: () => Promise<void>, options: DebouncedSaveOptions) => {
      clearPendingAutoSave();

      autoSaveTimerRef.current = setTimeout(async () => {
        setAutoSaveStatus('saving');

        try {
          await task();
          setAutoSaveStatus('saved');
        } catch (error) {
          setAutoSaveStatus('error');
          options.onError?.(error);
          showToast(getErrorMessage(error, options.errorMessage), 'error');
        }
      }, options.delayMs ?? 1500);
    },
    [clearPendingAutoSave, showToast],
  );

  const triggerAutoSave = useCallback(
    async (data: AutoSaveData) => {
      if (!letterId || !letter) {
        return;
      }

      clearPendingAutoSave();

      const hasSenderChange = data.sender !== undefined;
      const hasRecipientChange = data.recipient !== undefined;

      if (hasSenderChange || hasRecipientChange) {
        // Debounce identity changes to avoid firing on every keystroke
        scheduleDebouncedSave(
          async () => {
            const identityData: { sender?: string; recipient?: string } = {};
            if (hasSenderChange) {
              identityData.sender = data.sender || '';
            }
            if (hasRecipientChange) {
              identityData.recipient = data.recipient || '';
            }

            const updated = await updateIdentity(letterId, identityData);
            setLetter(updated);
            syncIdentityMetadata(updated);
            showToast('Name updated across metadata', 'success');

            const otherData = { ...data };
            delete otherData.sender;
            delete otherData.recipient;

            if (Object.keys(otherData).length > 0) {
              const finalUpdated = await updateLetter(letterId, otherData);
              setLetter(finalUpdated);
            }
          },
          {
            errorMessage: 'Failed to update name',
          },
        );

        return;
      }

      scheduleDebouncedSave(
        async () => {
          const updated = await updateLetter(letterId, data);
          setLetter(updated);

          if (data.transcriptionText !== undefined) {
            await createVersion(
              letterId,
              'transcript',
              data.transcriptionText,
              'human',
            );
          }

          if (
            data.sender !== undefined ||
            data.recipient !== undefined ||
            data.locationWritten !== undefined ||
            data.hook !== undefined ||
            data.summary !== undefined
          ) {
            await createVersion(
              letterId,
              'metadata',
              {
                sender: data.sender ?? letter.metadata.sender,
                recipient: data.recipient ?? letter.metadata.recipient,
                locationWritten:
                  data.locationWritten ?? letter.metadata.location,
                hook: data.hook ?? letter.metadata.hook,
                summary: data.summary ?? letter.metadata.description,
              },
              'human',
            );
          }

          trackEdit({
            id: updated.id,
            metadata: updated.metadata,
            collectionCode: updated.collectionCode,
          });
        },
        {
          errorMessage: 'Save failed',
          onError: (error) => {
            console.error('Auto-save error:', error);
          },
        },
      );
    },
    [
      clearPendingAutoSave,
      letter,
      letterId,
      scheduleDebouncedSave,
      setLetter,
      showToast,
      syncIdentityMetadata,
    ],
  );

  useEffect(
    () => () => {
      clearPendingAutoSave();

      if (statusTimeoutRef.current) {
        clearTimeout(statusTimeoutRef.current);
      }
    },
    [clearPendingAutoSave],
  );

  return {
    autoSaveStatus,
    scheduleDebouncedSave,
    scheduleStatusReset,
    triggerAutoSave,
  };
}
