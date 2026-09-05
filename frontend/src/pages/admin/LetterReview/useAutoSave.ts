import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  createVersion,
  updateLetter,
  type CreateVersionRequest,
} from '../../../api/admin';
import type { Letter } from '../../../types/Letter';
import { trackEdit } from '../../../utils/recentEdits';
import { useIdentityAutoSave } from './useIdentityAutoSave';
import {
  ALL_LETTER_REVIEW_AUTOSAVE_LANES,
  type CancelLetterReviewDebouncedSaves,
  type LetterReviewDebouncedSaveOptions,
  type ScheduleLetterReviewDebouncedSave,
  useLetterReviewAutosaveCoordinator,
} from './useLetterReviewAutosaveCoordinator';
import type { LetterReviewVisit } from './useLetterReviewVisit';
import {
  createMetadataVersionSnapshot,
  hasMetadataVersionPatch,
  type MetadataVersionPatch,
} from './metadataVersionSnapshot';

type HandleMutationError = (error: unknown, fallback: string) => boolean;

export type AutoSaveData = MetadataVersionPatch & {
  transcriptionText?: string;
  notes?: string | null;
};

interface UseAutoSaveOptions {
  visit: LetterReviewVisit;
  letter: Letter | null;
  tryAdoptLetter: (letter: Letter) => boolean;
  handleMutationError: HandleMutationError;
  isMutationBlocked: () => boolean;
  mutationsBlocked: boolean;
  syncIdentityMetadata: (updatedLetter: Letter) => void;
}

export type DebouncedSaveOptions = LetterReviewDebouncedSaveOptions;
export type ScheduleDebouncedSave = ScheduleLetterReviewDebouncedSave;

interface LetterFieldTarget {
  key: string;
  id: string;
  primarySourceRevision: number;
}

interface PendingLetterFields {
  targetKey: string;
  data: AutoSaveData;
}

const hasOwnUpdates = (data: AutoSaveData): boolean =>
  Object.values(data).some((value) => value !== undefined);

export function useAutoSave({
  visit,
  letter,
  tryAdoptLetter,
  handleMutationError,
  isMutationBlocked,
  mutationsBlocked,
  syncIdentityMetadata,
}: UseAutoSaveOptions) {
  const pendingFieldsByVisitRef = useRef(
    new Map<LetterReviewVisit, PendingLetterFields>(),
  );
  const letterId = letter?.id;
  const primarySourceRevision = letter?.primarySourceRevision;
  const target = useMemo(
    (): LetterFieldTarget | null => (
      letterId !== undefined && primarySourceRevision !== undefined
        ? {
            key: `${letterId}:${primarySourceRevision}`,
            id: letterId,
            primarySourceRevision,
          }
        : null
    ),
    [letterId, primarySourceRevision],
  );
  const {
    autoSaveStatus,
    busyLanes,
    scheduleDebouncedSave,
    flushDebouncedSaves,
    cancelDebouncedSaves: cancelCoordinatorSaves,
  } = useLetterReviewAutosaveCoordinator({
    visit,
    targetKey: target?.key ?? null,
    handleMutationError,
    isMutationBlocked,
    mutationsBlocked,
  });

  const cancelDebouncedSaves = useCallback<CancelLetterReviewDebouncedSaves>(
    (lanes) => {
      if (lanes.includes('letter-fields')) {
        pendingFieldsByVisitRef.current.delete(visit);
      }
      cancelCoordinatorSaves(lanes);
    },
    [cancelCoordinatorSaves, visit],
  );

  const syncIdentityMetadataPreservingDraft = useCallback((
    updatedLetter: Letter,
  ) => {
    const pending = pendingFieldsByVisitRef.current.get(visit);
    if (!pending || pending.targetKey !== target?.key) {
      syncIdentityMetadata(updatedLetter);
      return;
    }

    const pendingHook = pending.data.hook;
    const pendingSummary = pending.data.summary;
    if (pendingHook === undefined && pendingSummary === undefined) {
      syncIdentityMetadata(updatedLetter);
      return;
    }

    // Identity retagging may finish while a newer hook/summary edit is queued
    // behind it in the same target pump. Keep that visible draft until its own
    // serialized save runs instead of painting the older retag DTO over it.
    syncIdentityMetadata({
      ...updatedLetter,
      metadata: {
        ...updatedLetter.metadata,
        ...(pendingHook !== undefined
          ? {
              hook: pendingHook ?? undefined,
              taggedHook: pendingHook ?? undefined,
            }
          : {}),
        ...(pendingSummary !== undefined
          ? {
              description: pendingSummary ?? undefined,
              taggedDescription: pendingSummary ?? undefined,
            }
          : {}),
      },
    });
  }, [syncIdentityMetadata, target?.key, visit]);

  const {
    identityUpdateSecondsRemaining,
    identityUpdateState,
    retryPendingIdentityWork,
    retagState,
    scheduleIdentityUpdate,
  } = useIdentityAutoSave({
    visit,
    letter,
    tryAdoptLetter,
    scheduleDebouncedSave,
    cancelDebouncedSaves,
    mutationsBlocked,
    syncIdentityMetadata: syncIdentityMetadataPreservingDraft,
  });

  const recordVersion = useCallback(async (
    targetLetter: LetterFieldTarget,
    request: CreateVersionRequest,
  ) => {
    if (visit.isActive() && isMutationBlocked()) return;

    try {
      await createVersion(targetLetter.id, request);
    } catch (error) {
      console.error('Version history save error:', error);
      handleMutationError(
        error,
        'Changes saved, but version history could not be recorded',
      );
    }
  }, [handleMutationError, isMutationBlocked, visit]);

  const scheduleLetterFields = useCallback((
    targetLetter: LetterFieldTarget,
    data: AutoSaveData,
  ) => {
    // A fresh A visit supersedes a queued first-A job in the coordinator.
    // Its pending patch must be equally visit-owned or the first visit's
    // unsaved fields would leak into the new editor session.
    for (const [owner, pending] of pendingFieldsByVisitRef.current) {
      if (owner !== visit && pending.targetKey === targetLetter.key) {
        pendingFieldsByVisitRef.current.delete(owner);
      }
    }
    const pending = pendingFieldsByVisitRef.current.get(visit);
    pendingFieldsByVisitRef.current.set(visit, {
      targetKey: targetLetter.key,
      data: {
        ...(pending?.targetKey === targetLetter.key ? pending.data : {}),
        ...data,
      },
    });

    scheduleDebouncedSave(
      async () => {
        // Taking and deleting the complete snapshot before awaiting allows
        // edits made during this request to form the next serialized patch.
        const pendingSnapshot = pendingFieldsByVisitRef.current.get(visit);
        if (!pendingSnapshot || pendingSnapshot.targetKey !== targetLetter.key) {
          return;
        }
        pendingFieldsByVisitRef.current.delete(visit);
        const snapshot = pendingSnapshot.data;

        let updated: Letter;
        try {
          updated = await updateLetter(targetLetter.id, {
            ...snapshot,
            primarySourceRevision: targetLetter.primarySourceRevision,
          });
        } catch (error) {
          const newer = pendingFieldsByVisitRef.current.get(visit);
          pendingFieldsByVisitRef.current.set(visit, {
            targetKey: targetLetter.key,
            data: {
              ...snapshot,
              ...(newer?.targetKey === targetLetter.key
                ? newer.data
                : {}),
            },
          });
          throw error;
        }
        tryAdoptLetter(updated);

        if (snapshot.transcriptionText !== undefined) {
          await recordVersion(
            targetLetter,
            {
              primarySourceRevision: targetLetter.primarySourceRevision,
              fieldType: 'transcript',
              content: snapshot.transcriptionText,
              source: 'human',
            },
          );
        }

        if (hasMetadataVersionPatch(snapshot)) {
          await recordVersion(
            targetLetter,
            {
              primarySourceRevision: targetLetter.primarySourceRevision,
              fieldType: 'metadata',
              content: createMetadataVersionSnapshot(snapshot, updated),
              source: 'human',
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
        lane: 'letter-fields',
        errorMessage: 'Save failed',
        onError: (error) => {
          console.error('Auto-save error:', error);
        },
      },
    );
  }, [
    recordVersion,
    scheduleDebouncedSave,
    tryAdoptLetter,
    visit,
  ]);

  const retryPendingLetterFields = useCallback(() => {
    const pending = pendingFieldsByVisitRef.current.get(visit);
    if (
      !target
      || !pending
      || pending.targetKey !== target.key
    ) {
      return;
    }
    scheduleLetterFields(target, {});
  }, [scheduleLetterFields, target, visit]);

  const triggerAutoSave = useCallback((data: AutoSaveData): Promise<void> => {
    if (!visit.isActive() || !target || isMutationBlocked()) {
      return Promise.resolve();
    }

    const hasMetadata = letter?.metadataContentStatus !== 'EMPTY';
    const hasSenderChange = data.sender !== undefined;
    const hasRecipientChange = data.recipient !== undefined;
    let letterFields = data;

    if ((hasSenderChange || hasRecipientChange) && hasMetadata) {
      scheduleIdentityUpdate({
        ...(hasSenderChange ? { sender: data.sender } : {}),
        ...(hasRecipientChange ? { recipient: data.recipient } : {}),
      });
      const remainingFields = { ...data };
      delete remainingFields.sender;
      delete remainingFields.recipient;
      letterFields = remainingFields;
    }

    if (hasOwnUpdates(letterFields)) {
      scheduleLetterFields(target, letterFields);
    }

    return Promise.resolve();
  }, [
    isMutationBlocked,
    letter?.metadataContentStatus,
    scheduleIdentityUpdate,
    scheduleLetterFields,
    target,
    visit,
  ]);

  useEffect(() => {
    if (mutationsBlocked) {
      pendingFieldsByVisitRef.current.delete(visit);
    }
  }, [mutationsBlocked, visit]);

  const flushPendingSaves = useCallback(async () => {
    if (!visit.isActive() || !target) return false;
    retryPendingIdentityWork();
    retryPendingLetterFields();
    return flushDebouncedSaves(ALL_LETTER_REVIEW_AUTOSAVE_LANES);
  }, [
    flushDebouncedSaves,
    retryPendingLetterFields,
    retryPendingIdentityWork,
    target,
    visit,
  ]);

  return {
    hasPendingSaves: busyLanes.size > 0 || autoSaveStatus === 'error',
    autoSaveStatus,
    identityUpdateSecondsRemaining,
    identityUpdateState,
    retagState,
    scheduleDebouncedSave,
    flushPendingSaves,
    triggerAutoSave,
  };
}
