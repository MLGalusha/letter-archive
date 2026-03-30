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
import {
  retagMetadata,
  type RetagMetadataChange,
  updateIdentity,
} from '../../../api/admin/letters';
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

type IdentityUpdateState = 'idle' | 'pending' | 'saving';

interface PendingIdentityUpdate {
  oldSender: string | null;
  oldRecipient: string | null;
  sender?: string | null;
  recipient?: string | null;
}

const IDENTITY_SAVE_DELAY_MS = 10_000;
const IDENTITY_COUNTDOWN_INTERVAL_MS = 250;

function hasPendingIdentityChanges(pending: PendingIdentityUpdate): boolean {
  const nextSender = pending.sender !== undefined ? pending.sender : pending.oldSender;
  const nextRecipient = pending.recipient !== undefined ? pending.recipient : pending.oldRecipient;

  return nextSender !== pending.oldSender || nextRecipient !== pending.oldRecipient;
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
  const [identityUpdateState, setIdentityUpdateState] = useState<IdentityUpdateState>('idle');
  const [identityUpdateSecondsRemaining, setIdentityUpdateSecondsRemaining] = useState(0);
  const [retagState, setRetagState] = useState<'idle' | 'retagging' | 'done'>('idle');
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const identitySaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const identityCountdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const identityDeadlineRef = useRef<number | null>(null);
  const pendingIdentityUpdateRef = useRef<PendingIdentityUpdate | null>(null);
  const statusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retagTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retagAbortRef = useRef<AbortController | null>(null);
  const retagRequestIdRef = useRef(0);

  const clearPendingAutoSave = useCallback(() => {
    if (!autoSaveTimerRef.current) {
      return;
    }

    clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = null;
  }, []);

  const clearPendingIdentitySave = useCallback(() => {
    if (!identitySaveTimerRef.current) {
      return;
    }

    clearTimeout(identitySaveTimerRef.current);
    identitySaveTimerRef.current = null;
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

  const clearIdentityCountdown = useCallback(() => {
    if (identityCountdownIntervalRef.current) {
      clearInterval(identityCountdownIntervalRef.current);
      identityCountdownIntervalRef.current = null;
    }

    identityDeadlineRef.current = null;
  }, []);

  const resetIdentityPendingState = useCallback(() => {
    clearPendingIdentitySave();
    clearIdentityCountdown();
    pendingIdentityUpdateRef.current = null;
    setIdentityUpdateState('idle');
    setIdentityUpdateSecondsRemaining(0);
  }, [clearIdentityCountdown, clearPendingIdentitySave]);

  const startIdentityCountdown = useCallback(
    (delayMs: number) => {
      clearIdentityCountdown();

      const deadline = Date.now() + delayMs;
      identityDeadlineRef.current = deadline;
      setIdentityUpdateState('pending');

      const updateCountdown = () => {
        const remainingMs = Math.max(0, deadline - Date.now());
        setIdentityUpdateSecondsRemaining(Math.max(1, Math.ceil(remainingMs / 1000)));
      };

      updateCountdown();
      identityCountdownIntervalRef.current = setInterval(
        updateCountdown,
        IDENTITY_COUNTDOWN_INTERVAL_MS,
      );
    },
    [clearIdentityCountdown],
  );

  const clearRetagTimeout = useCallback(() => {
    if (!retagTimeoutRef.current) {
      return;
    }

    clearTimeout(retagTimeoutRef.current);
    retagTimeoutRef.current = null;
  }, []);

  const abortInFlightRetag = useCallback(() => {
    if (retagAbortRef.current) {
      retagAbortRef.current.abort();
      retagAbortRef.current = null;
    }

    clearRetagTimeout();
  }, [clearRetagTimeout]);

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

      const hasSenderChange = data.sender !== undefined;
      const hasRecipientChange = data.recipient !== undefined;

      if (hasSenderChange || hasRecipientChange) {
        const pendingIdentity = pendingIdentityUpdateRef.current
          ? {
              ...pendingIdentityUpdateRef.current,
              ...(hasSenderChange ? { sender: data.sender ?? null } : {}),
              ...(hasRecipientChange ? { recipient: data.recipient ?? null } : {}),
            }
          : {
              oldSender: letter.metadata.sender ?? null,
              oldRecipient: letter.metadata.recipient ?? null,
              ...(hasSenderChange ? { sender: data.sender ?? null } : {}),
              ...(hasRecipientChange ? { recipient: data.recipient ?? null } : {}),
            };

        if (!hasPendingIdentityChanges(pendingIdentity)) {
          resetIdentityPendingState();
          setRetagState('idle');
          return;
        }

        pendingIdentityUpdateRef.current = pendingIdentity;
        abortInFlightRetag();
        setRetagState('idle');
        setAutoSaveStatus('idle');
        clearPendingIdentitySave();
        startIdentityCountdown(IDENTITY_SAVE_DELAY_MS);

        identitySaveTimerRef.current = setTimeout(async () => {
          const pending = pendingIdentityUpdateRef.current;
          pendingIdentityUpdateRef.current = null;
          clearIdentityCountdown();

          if (!pending) {
            setIdentityUpdateState('idle');
            setIdentityUpdateSecondsRemaining(0);
            return;
          }

          const nextSender = pending.sender !== undefined ? pending.sender : pending.oldSender;
          const nextRecipient = pending.recipient !== undefined ? pending.recipient : pending.oldRecipient;
          const senderChanged = pending.sender !== undefined && nextSender !== pending.oldSender;
          const recipientChanged = pending.recipient !== undefined && nextRecipient !== pending.oldRecipient;

          if (!senderChanged && !recipientChanged) {
            setIdentityUpdateState('idle');
            setIdentityUpdateSecondsRemaining(0);
            return;
          }

          setIdentityUpdateState('saving');
          setAutoSaveStatus('saving');

          try {
            const identityData: { sender?: string; recipient?: string } = {};
            if (pending.sender !== undefined) {
              identityData.sender = pending.sender ?? '';
            }
            if (pending.recipient !== undefined) {
              identityData.recipient = pending.recipient ?? '';
            }

            const updated = await updateIdentity(letterId, identityData);
            setLetter(updated);
            syncIdentityMetadata(updated);
            setIdentityUpdateState('idle');
            setIdentityUpdateSecondsRemaining(0);
            setAutoSaveStatus('saved');

            abortInFlightRetag();
            setRetagState('retagging');

            const change: RetagMetadataChange = {
              field: senderChanged && recipientChanged ? 'both' : senderChanged ? 'sender' : 'recipient',
              ...(senderChanged ? { oldSender: pending.oldSender, newSender: nextSender } : {}),
              ...(recipientChanged ? { oldRecipient: pending.oldRecipient, newRecipient: nextRecipient } : {}),
            };

            const controller = new AbortController();
            const requestId = retagRequestIdRef.current + 1;
            retagRequestIdRef.current = requestId;
            retagAbortRef.current = controller;

            try {
              const retagged = await retagMetadata(letterId, change, controller.signal);

              if (controller.signal.aborted || retagRequestIdRef.current !== requestId) {
                return;
              }

              setLetter(retagged);
              syncIdentityMetadata(retagged);
              setRetagState('done');
              clearRetagTimeout();
              retagTimeoutRef.current = setTimeout(() => {
                if (retagRequestIdRef.current === requestId) {
                  setRetagState('idle');
                }
              }, 2000);
            } catch (error) {
              if (controller.signal.aborted || retagRequestIdRef.current !== requestId) {
                return;
              }

              setRetagState('idle');
              showToast(getErrorMessage(error, 'Failed to update metadata references'), 'error');
            } finally {
              if (retagAbortRef.current === controller) {
                retagAbortRef.current = null;
              }
            }
          } catch (error) {
            setIdentityUpdateState('idle');
            setIdentityUpdateSecondsRemaining(0);
            setAutoSaveStatus('error');
            showToast(getErrorMessage(error, 'Failed to update name'), 'error');
          }
        }, IDENTITY_SAVE_DELAY_MS);

        return;
      }

      clearPendingAutoSave();

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
      abortInFlightRetag,
      clearIdentityCountdown,
      clearPendingIdentitySave,
      clearPendingAutoSave,
      clearRetagTimeout,
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
      resetIdentityPendingState();
      abortInFlightRetag();

      if (statusTimeoutRef.current) {
        clearTimeout(statusTimeoutRef.current);
      }
    },
    [abortInFlightRetag, clearPendingAutoSave, resetIdentityPendingState],
  );

  return {
    autoSaveStatus,
    identityUpdateSecondsRemaining,
    identityUpdateState,
    retagState,
    scheduleDebouncedSave,
    scheduleStatusReset,
    triggerAutoSave,
  };
}
