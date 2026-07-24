import { useCallback, useEffect, useMemo, useRef } from 'react';
import { createVersion, updateLetter } from '../../../api/admin';
import type {
  EmotionalTone,
  Letter,
  RelationshipType,
} from '../../../types/Letter';
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

type HandleMutationError = (error: unknown, fallback: string) => boolean;

export interface AutoSaveData {
  transcriptionText?: string;
  sender?: string | null;
  recipient?: string | null;
  extractedDate?: string | null;
  locationWritten?: string | null;
  hook?: string | null;
  summary?: string | null;
  emotionalTone?: EmotionalTone | null;
  senderRecipientRelationship?: RelationshipType | null;
  primaryTopics?: string[] | null;
  notes?: string | null;
  readingText?: string | null;
}

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
    fieldType: 'transcript' | 'metadata',
    content: string | Record<string, unknown>,
  ) => {
    if (visit.isActive() && isMutationBlocked()) return;

    try {
      await createVersion(
        targetLetter.id,
        targetLetter.primarySourceRevision,
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
            'transcript',
            snapshot.transcriptionText,
          );
        }

        if (
          snapshot.sender !== undefined
          || snapshot.recipient !== undefined
          || snapshot.extractedDate !== undefined
          || snapshot.locationWritten !== undefined
          || snapshot.hook !== undefined
          || snapshot.summary !== undefined
          || snapshot.emotionalTone !== undefined
          || snapshot.senderRecipientRelationship !== undefined
          || snapshot.primaryTopics !== undefined
        ) {
          await recordVersion(
            targetLetter,
            'metadata',
            {
              sender: snapshot.sender !== undefined
                ? snapshot.sender
                : updated.metadata.sender,
              recipient: snapshot.recipient !== undefined
                ? snapshot.recipient
                : updated.metadata.recipient,
              extractedDate: snapshot.extractedDate !== undefined
                ? snapshot.extractedDate
                : updated.metadata.extractedDate,
              locationWritten: snapshot.locationWritten !== undefined
                ? snapshot.locationWritten
                : updated.metadata.location,
              hook: snapshot.hook !== undefined
                ? snapshot.hook
                : updated.metadata.hook,
              summary: snapshot.summary !== undefined
                ? snapshot.summary
                : updated.metadata.description,
              emotionalTone: snapshot.emotionalTone !== undefined
                ? snapshot.emotionalTone
                : updated.metadata.emotionalTone,
              senderRecipientRelationship:
                snapshot.senderRecipientRelationship !== undefined
                  ? snapshot.senderRecipientRelationship
                  : updated.metadata.senderRecipientRelationship,
              primaryTopics: snapshot.primaryTopics !== undefined
                ? snapshot.primaryTopics
                : updated.metadata.primaryTopics,
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
    autoSaveStatus,
    identityUpdateSecondsRemaining,
    identityUpdateState,
    retagState,
    scheduleDebouncedSave,
    flushPendingSaves,
    triggerAutoSave,
  };
}
