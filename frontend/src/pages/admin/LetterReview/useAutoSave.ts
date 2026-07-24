import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { createVersion, updateLetter } from '../../../api/admin';
import {
  retagMetadata,
  type RetagMetadataChange,
  updateIdentity,
} from '../../../api/admin/letters';
import type { Letter } from '../../../types/Letter';
import { trackEdit } from '../../../utils/recentEdits';

type HandleMutationError = (error: unknown, fallback: string) => boolean;

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
  handleMutationError: HandleMutationError;
  isMutationBlocked: () => boolean;
  mutationsBlocked: boolean;
  syncIdentityMetadata: (updatedLetter: Letter) => void;
}

interface DebouncedSaveOptions {
  delayMs?: number;
  errorMessage: string;
  onError?: (error: unknown) => void;
}

type IdentityUpdateState = 'idle' | 'pending' | 'saving';

interface PendingIdentityUpdate {
  primarySourceRevision: number;
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
  handleMutationError,
  isMutationBlocked,
  mutationsBlocked,
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

  const recordVersion = useCallback(async (
    id: string,
    primarySourceRevision: number,
    fieldType: 'transcript' | 'metadata',
    content: string | Record<string, unknown>,
  ) => {
    if (isMutationBlocked()) return;
    try {
      await createVersion(
        id,
        primarySourceRevision,
        fieldType,
        content,
        'human',
      );
    } catch (error) {
      console.error('Version history save error:', error);
      handleMutationError(
        error,
        'Changes saved, but version history could not be recorded',
      );
    }
  }, [handleMutationError, isMutationBlocked]);

  const scheduleDebouncedSave = useCallback(
    (task: () => Promise<void>, options: DebouncedSaveOptions) => {
      clearPendingAutoSave();
      if (isMutationBlocked()) return;

      autoSaveTimerRef.current = setTimeout(async () => {
        autoSaveTimerRef.current = null;
        if (isMutationBlocked()) return;
        setAutoSaveStatus('saving');

        try {
          await task();
          setAutoSaveStatus('saved');
        } catch (error) {
          setAutoSaveStatus('error');
          options.onError?.(error);
          handleMutationError(error, options.errorMessage);
        }
      }, options.delayMs ?? 1500);
    },
    [clearPendingAutoSave, handleMutationError, isMutationBlocked],
  );

  const triggerAutoSave = useCallback(
    async (data: AutoSaveData) => {
      if (!letterId || !letter || isMutationBlocked()) {
        return;
      }

      const hasSenderChange = data.sender !== undefined;
      const hasRecipientChange = data.recipient !== undefined;

      // When metadata doesn't exist yet, save sender/recipient as a plain update
      // without the identity countdown + retag flow (there's nothing to retag).
      const hasMetadata = letter.metadataContentStatus !== 'EMPTY';

      if ((hasSenderChange || hasRecipientChange) && hasMetadata) {
        const pendingIdentity = pendingIdentityUpdateRef.current
          ? {
              ...pendingIdentityUpdateRef.current,
              ...(hasSenderChange ? { sender: data.sender ?? null } : {}),
              ...(hasRecipientChange ? { recipient: data.recipient ?? null } : {}),
            }
          : {
              primarySourceRevision: letter.primarySourceRevision,
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
          if (isMutationBlocked()) {
            resetIdentityPendingState();
            return;
          }
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
            const identityData: {
              primarySourceRevision: number;
              expectedSender?: string | null;
              expectedRecipient?: string | null;
              sender?: string;
              recipient?: string;
            } = {
              primarySourceRevision: pending.primarySourceRevision,
            };
            if (pending.sender !== undefined) {
              identityData.expectedSender = pending.oldSender;
              identityData.sender = pending.sender ?? '';
            }
            if (pending.recipient !== undefined) {
              identityData.expectedRecipient = pending.oldRecipient;
              identityData.recipient = pending.recipient ?? '';
            }

            const updated = await updateIdentity(letterId, identityData);
            setLetter(updated);
            syncIdentityMetadata(updated);
            setIdentityUpdateState('idle');
            setIdentityUpdateSecondsRemaining(0);
            setAutoSaveStatus('saved');

            if (isMutationBlocked()) return;
            abortInFlightRetag();
            setRetagState('retagging');

            const change: RetagMetadataChange = {
              // The refreshed DTO is fetched after the identity transaction
              // commits, so a page replacement can win between those two
              // operations. Keep the re-tag bound to the source that actually
              // accepted this identity edit.
              primarySourceRevision: pending.primarySourceRevision,
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
              handleMutationError(
                error,
                'Failed to update metadata references',
              );
            } finally {
              if (retagAbortRef.current === controller) {
                retagAbortRef.current = null;
              }
            }
          } catch (error) {
            setIdentityUpdateState('idle');
            setIdentityUpdateSecondsRemaining(0);
            setAutoSaveStatus('error');
            handleMutationError(error, 'Failed to update name');
          }
        }, IDENTITY_SAVE_DELAY_MS);

        return;
      }

      clearPendingAutoSave();

      scheduleDebouncedSave(
        async () => {
          const updated = await updateLetter(letterId, {
            ...data,
            primarySourceRevision: letter.primarySourceRevision,
          });
          setLetter(updated);

          if (data.transcriptionText !== undefined) {
            await recordVersion(
              letterId,
              letter.primarySourceRevision,
              'transcript',
              data.transcriptionText,
            );
          }

          if (
            data.sender !== undefined ||
            data.recipient !== undefined ||
            data.locationWritten !== undefined ||
            data.hook !== undefined ||
            data.summary !== undefined
          ) {
            await recordVersion(
              letterId,
              letter.primarySourceRevision,
              'metadata',
              {
                sender: data.sender !== undefined
                  ? data.sender
                  : updated.metadata.sender,
                recipient: data.recipient !== undefined
                  ? data.recipient
                  : updated.metadata.recipient,
                locationWritten: data.locationWritten !== undefined
                  ? data.locationWritten
                  : updated.metadata.location,
                hook: data.hook !== undefined
                  ? data.hook
                  : updated.metadata.hook,
                summary: data.summary !== undefined
                  ? data.summary
                  : updated.metadata.description,
              },
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
      isMutationBlocked,
      recordVersion,
      resetIdentityPendingState,
      scheduleDebouncedSave,
      setLetter,
      handleMutationError,
      startIdentityCountdown,
      syncIdentityMetadata,
    ],
  );

  useEffect(() => {
    if (!mutationsBlocked) return;
    clearPendingAutoSave();
    resetIdentityPendingState();
    abortInFlightRetag();
  }, [
    abortInFlightRetag,
    clearPendingAutoSave,
    mutationsBlocked,
    resetIdentityPendingState,
  ]);

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
