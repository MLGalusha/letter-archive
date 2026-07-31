import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  retagMetadata,
  updateIdentity,
  type RetagMetadataChange,
} from '../../../api/admin/letters';
import type { Letter } from '../../../types/Letter';
import {
  IdentityAutoSaveController,
  type IdentityJob,
  type IdentityUpdateData,
} from './identityAutoSaveController';
import type {
  CancelLetterReviewDebouncedSaves,
  ScheduleLetterReviewDebouncedSave,
} from './useLetterReviewAutosaveCoordinator';
import type { LetterReviewVisit } from './useLetterReviewVisit';

export type { IdentityUpdateData } from './identityAutoSaveController';
export type IdentityUpdateState = 'idle' | 'pending' | 'saving';
export type IdentityRetagState = 'idle' | 'retagging' | 'done';

interface UseIdentityAutoSaveOptions {
  visit: LetterReviewVisit;
  letter: Letter | null;
  tryAdoptLetter: (letter: Letter) => boolean;
  scheduleDebouncedSave: ScheduleLetterReviewDebouncedSave;
  cancelDebouncedSaves: CancelLetterReviewDebouncedSaves;
  mutationsBlocked: boolean;
  syncIdentityMetadata: (updatedLetter: Letter) => void;
}

interface VisibleState {
  visit: LetterReviewVisit;
  targetKey: string | null;
  identityUpdateState: IdentityUpdateState;
  identityUpdateSecondsRemaining: number;
  retagState: IdentityRetagState;
}

interface OwnedTimer {
  visit: LetterReviewVisit;
  targetKey: string;
  generation: number;
  timer: ReturnType<typeof setTimeout>;
}

interface PendingRetag {
  targetKey: string;
  letterId: string;
  generation: number;
  change: RetagMetadataChange;
}

interface OwnedIdentityJob {
  job: IdentityJob;
  visit: LetterReviewVisit;
  targetKey: string;
}

const IDENTITY_SAVE_DELAY_MS = 10_000;
const COUNTDOWN_TICK_MS = 250;
const RETAG_DONE_DURATION_MS = 2_000;

const targetKeyOf = (letter: Letter | null) => (
  letter ? `${letter.id}:${letter.primarySourceRevision}` : null
);

const emptyState = (
  visit: LetterReviewVisit,
  targetKey: string | null,
): VisibleState => ({
  visit,
  targetKey,
  identityUpdateState: 'idle',
  identityUpdateSecondsRemaining: 0,
  retagState: 'idle',
});

export function useIdentityAutoSave({
  visit,
  letter,
  tryAdoptLetter,
  scheduleDebouncedSave,
  cancelDebouncedSaves,
  mutationsBlocked,
  syncIdentityMetadata,
}: UseIdentityAutoSaveOptions) {
  const targetKey = targetKeyOf(letter);
  const [controller] = useState(() => new IdentityAutoSaveController());
  const currentVisitRef = useRef(visit);
  const currentTargetRef = useRef(targetKey);
  const blockedRef = useRef(mutationsBlocked);
  const pendingRetagsByTargetRef = useRef(
    new Map<string, PendingRetag[]>(),
  );
  const latestIdentityJobByTargetRef = useRef(
    new Map<string, OwnedIdentityJob>(),
  );
  const countdownRef = useRef<OwnedTimer | null>(null);
  const retagResetRef = useRef<OwnedTimer | null>(null);
  const [storedState, setStoredState] = useState(
    () => emptyState(visit, targetKey),
  );
  const state = (
    storedState.visit === visit && storedState.targetKey === targetKey
  ) ? storedState : emptyState(visit, targetKey);

  const isVisible = useCallback((
    owner: LetterReviewVisit,
    ownerTarget: string,
  ) => (
    currentVisitRef.current === owner
    && currentTargetRef.current === ownerTarget
    && owner.isActive()
    && !blockedRef.current
  ), []);

  const updateVisible = useCallback((
    owner: LetterReviewVisit,
    ownerTarget: string,
    patch: Partial<
      Pick<
        VisibleState,
        | 'identityUpdateState'
        | 'identityUpdateSecondsRemaining'
        | 'retagState'
      >
    >,
  ) => {
    if (!isVisible(owner, ownerTarget)) return;
    setStoredState((current) => ({
      ...(
        current.visit === owner && current.targetKey === ownerTarget
          ? current
          : emptyState(owner, ownerTarget)
      ),
      ...patch,
    }));
  }, [isVisible]);

  const clearCountdown = useCallback((
    owner?: LetterReviewVisit,
    ownerTarget?: string,
    generation?: number,
  ) => {
    const current = countdownRef.current;
    if (!current) return;
    if (owner && current.visit !== owner) return;
    if (ownerTarget && current.targetKey !== ownerTarget) return;
    if (
      generation !== undefined
      && current.generation !== generation
    ) {
      return;
    }
    clearInterval(current.timer);
    countdownRef.current = null;
  }, []);

  const clearRetagReset = useCallback(() => {
    if (!retagResetRef.current) return;
    clearTimeout(retagResetRef.current.timer);
    retagResetRef.current = null;
  }, []);

  const resetPendingStatus = useCallback((
    owner: LetterReviewVisit,
    ownerTarget: string,
  ) => {
    clearCountdown(owner, ownerTarget);
    updateVisible(owner, ownerTarget, {
      identityUpdateState: 'idle',
      identityUpdateSecondsRemaining: 0,
    });
  }, [clearCountdown, updateVisible]);

  const startCountdown = useCallback((
    owner: LetterReviewVisit,
    ownerTarget: string,
    generation: number,
  ) => {
    clearCountdown();
    if (!isVisible(owner, ownerTarget)) return;
    const deadline = Date.now() + IDENTITY_SAVE_DELAY_MS;

    const tick = () => {
      const current = countdownRef.current;
      if (
        !current
        || current.visit !== owner
        || current.targetKey !== ownerTarget
        || current.generation !== generation
      ) {
        return;
      }
      if (!isVisible(owner, ownerTarget)) {
        clearCountdown();
        return;
      }
      updateVisible(owner, ownerTarget, {
        identityUpdateState: 'pending',
        identityUpdateSecondsRemaining: Math.max(
          1,
          Math.ceil((deadline - Date.now()) / 1_000),
        ),
      });
    };

    countdownRef.current = {
      visit: owner,
      targetKey: ownerTarget,
      generation,
      timer: setInterval(tick, COUNTDOWN_TICK_MS),
    };
    tick();
  }, [clearCountdown, isVisible, updateVisible]);

  const showRetagDone = useCallback((
    owner: LetterReviewVisit,
    ownerTarget: string,
    generation: number,
  ) => {
    if (!isVisible(owner, ownerTarget)) return;
    clearRetagReset();
    updateVisible(owner, ownerTarget, { retagState: 'done' });

    const reset = () => {
      const current = retagResetRef.current;
      if (
        !current
        || current.visit !== owner
        || current.targetKey !== ownerTarget
        || current.generation !== generation
      ) {
        return;
      }
      retagResetRef.current = null;
      updateVisible(owner, ownerTarget, { retagState: 'idle' });
    };
    retagResetRef.current = {
      visit: owner,
      targetKey: ownerTarget,
      generation,
      timer: setTimeout(reset, RETAG_DONE_DURATION_MS),
    };
  }, [clearRetagReset, isVisible, updateVisible]);

  const runPendingRetags = useCallback(async (
    owner: LetterReviewVisit,
    ownerTarget: string,
  ) => {
    let completedGeneration: number | null = null;
    let completedAdopted = false;

    while (true) {
      const queue = pendingRetagsByTargetRef.current.get(ownerTarget);
      const pendingRetag = queue?.[0];
      if (!queue || !pendingRetag) break;

      updateVisible(owner, ownerTarget, { retagState: 'retagging' });
      let retagged: Letter;
      try {
        retagged = await retagMetadata(
          pendingRetag.letterId,
          pendingRetag.change,
        );
      } catch (error) {
        updateVisible(owner, ownerTarget, { retagState: 'idle' });
        throw error;
      }

      if (queue[0] === pendingRetag) queue.shift();
      if (queue.length === 0) {
        pendingRetagsByTargetRef.current.delete(ownerTarget);
      }
      completedGeneration = pendingRetag.generation;

      if (isVisible(owner, ownerTarget)) {
        completedAdopted = tryAdoptLetter(retagged);
        if (completedAdopted) {
          syncIdentityMetadata(
            controller.preservePendingIntent(ownerTarget, retagged),
          );
        }
      }
    }

    if (
      completedGeneration !== null
      && isVisible(owner, ownerTarget)
    ) {
      if (completedAdopted) {
        showRetagDone(owner, ownerTarget, completedGeneration);
      } else {
        updateVisible(owner, ownerTarget, { retagState: 'idle' });
      }
    }
  }, [
    controller,
    isVisible,
    showRetagDone,
    syncIdentityMetadata,
    tryAdoptLetter,
    updateVisible,
  ]);

  const runIdentityUpdate = useCallback(async ({
    job,
    visit: owner,
    targetKey: ownerTarget,
  }: OwnedIdentityJob) => {
    if (!controller.owns(job)) return;
    clearCountdown(owner, ownerTarget, job.generation);
    updateVisible(owner, ownerTarget, {
      identityUpdateState: 'saving',
      identityUpdateSecondsRemaining: 0,
    });

    // A failed repair from an earlier committed identity must succeed before
    // the next compare-and-set. The backend rejects an old→new repair after
    // identity has already advanced to a newer value.
    try {
      if (pendingRetagsByTargetRef.current.get(ownerTarget)?.length) {
        await runPendingRetags(owner, ownerTarget);
      }
    } catch (error) {
      resetPendingStatus(owner, ownerTarget);
      throw error;
    }

    const transaction = controller.begin(job);
    if (!transaction) return;
    const { pending } = transaction;
    const latest = latestIdentityJobByTargetRef.current.get(
      pending.targetKey,
    );
    if (latest?.job.generation === pending.generation) {
      latestIdentityJobByTargetRef.current.delete(pending.targetKey);
    }
    try {
      let updated: Letter;
      try {
        updated = await updateIdentity(
          pending.letterId,
          transaction.updateData,
        );
      } catch (error) {
        const {
          canceledPending,
          retryPending,
        } = controller.reject(transaction);
        if (retryPending) {
          latestIdentityJobByTargetRef.current.set(
            retryPending.targetKey,
            {
              job: {
                targetKey: retryPending.targetKey,
                generation: retryPending.generation,
              },
              visit: retryPending.visit,
              targetKey: retryPending.targetKey,
            },
          );
        }
        if (
          canceledPending
          && isVisible(canceledPending.visit, canceledPending.targetKey)
        ) {
          cancelDebouncedSaves(['identity']);
          const canceledJob = latestIdentityJobByTargetRef.current.get(
            canceledPending.targetKey,
          );
          if (
            canceledJob?.job.generation === canceledPending.generation
          ) {
            latestIdentityJobByTargetRef.current.delete(
              canceledPending.targetKey,
            );
          }
          resetPendingStatus(
            canceledPending.visit,
            canceledPending.targetKey,
          );
        }
        if (isVisible(pending.visit, pending.targetKey)) {
          resetPendingStatus(pending.visit, pending.targetKey);
        }
        throw error;
      }

      const { canceledPending } = controller.accept(
        transaction,
        updated,
      );
      const retags = pendingRetagsByTargetRef.current.get(
        pending.targetKey,
      ) ?? [];
      retags.push({
        targetKey: pending.targetKey,
        letterId: pending.letterId,
        generation: pending.generation,
        change: transaction.retagChange,
      });
      pendingRetagsByTargetRef.current.set(pending.targetKey, retags);

      if (
        canceledPending
        && isVisible(canceledPending.visit, canceledPending.targetKey)
      ) {
        cancelDebouncedSaves(['identity']);
        const canceledJob = latestIdentityJobByTargetRef.current.get(
          canceledPending.targetKey,
        );
        if (
          canceledJob?.job.generation === canceledPending.generation
        ) {
          latestIdentityJobByTargetRef.current.delete(
            canceledPending.targetKey,
          );
        }
        resetPendingStatus(
          canceledPending.visit,
          canceledPending.targetKey,
        );
      }

      if (isVisible(pending.visit, pending.targetKey)) {
        const adopted = tryAdoptLetter(updated);
        if (adopted) {
          syncIdentityMetadata(
            controller.preservePendingIntent(
              pending.targetKey,
              updated,
            ),
          );
        }
        if (!controller.hasPending(pending.targetKey)) {
          resetPendingStatus(pending.visit, pending.targetKey);
        }
        if (adopted) {
          updateVisible(pending.visit, pending.targetKey, {
            retagState: 'retagging',
          });
        }
      }
      await runPendingRetags(pending.visit, pending.targetKey);
    } finally {
      controller.finish(transaction);
    }
  }, [
    cancelDebouncedSaves,
    clearCountdown,
    controller,
    isVisible,
    resetPendingStatus,
    runPendingRetags,
    syncIdentityMetadata,
    tryAdoptLetter,
    updateVisible,
  ]);

  const scheduleIdentityWorkflow = useCallback((
    task: () => Promise<void>,
    delayMs: number,
  ) => {
    scheduleDebouncedSave(task, {
      lane: 'identity',
      delayMs,
      errorMessage: 'Failed to save name and update metadata references',
      onError: (error) => {
        console.error('Identity workflow error:', error);
      },
    });
  }, [scheduleDebouncedSave]);

  const scheduleIdentityUpdate = useCallback((data: IdentityUpdateData) => {
    if (
      !letter
      || !targetKey
      || blockedRef.current
      || (data.sender === undefined && data.recipient === undefined)
    ) {
      return;
    }

    const staged = controller.stage({
      key: targetKey,
      letterId: letter.id,
      visit,
      primarySourceRevision: letter.primarySourceRevision,
      sender: letter.metadata.sender ?? null,
      recipient: letter.metadata.recipient ?? null,
    }, data);
    if (staged.kind === 'cancel') {
      latestIdentityJobByTargetRef.current.delete(targetKey);
      cancelDebouncedSaves(['identity']);
      clearRetagReset();
      resetPendingStatus(visit, targetKey);
      if (pendingRetagsByTargetRef.current.get(targetKey)?.length) {
        scheduleIdentityWorkflow(
          () => runPendingRetags(visit, targetKey),
          0,
        );
      } else {
        updateVisible(visit, targetKey, { retagState: 'idle' });
        // Returning to the persisted baseline intentionally abandons any
        // failed identity intent. A successful no-op in the same lane tells
        // the coordinator that there is no unresolved server work left.
        scheduleIdentityWorkflow(async () => {}, 0);
      }
      return;
    }

    const ownedJob: OwnedIdentityJob = {
      job: staged.job,
      visit,
      targetKey,
    };
    latestIdentityJobByTargetRef.current.set(targetKey, ownedJob);
    clearRetagReset();
    updateVisible(visit, targetKey, { retagState: 'idle' });
    startCountdown(visit, targetKey, staged.job.generation);
    scheduleIdentityWorkflow(
      () => runIdentityUpdate(ownedJob),
      IDENTITY_SAVE_DELAY_MS,
    );
  }, [
    cancelDebouncedSaves,
    clearRetagReset,
    controller,
    letter,
    resetPendingStatus,
    runIdentityUpdate,
    runPendingRetags,
    scheduleIdentityWorkflow,
    startCountdown,
    targetKey,
    updateVisible,
    visit,
  ]);

  useLayoutEffect(() => {
    currentVisitRef.current = visit;
    currentTargetRef.current = targetKey;
    setStoredState((current) => (
      current.visit === visit && current.targetKey === targetKey
        ? current
        : emptyState(visit, targetKey)
    ));
    return () => {
      clearCountdown();
      clearRetagReset();
    };
  }, [
    clearCountdown,
    clearRetagReset,
    targetKey,
    visit,
  ]);

  useLayoutEffect(() => {
    blockedRef.current = mutationsBlocked;
  }, [mutationsBlocked]);

  useEffect(() => {
    if (!mutationsBlocked) return;
    if (targetKey) {
      controller.cancel(targetKey);
      latestIdentityJobByTargetRef.current.delete(targetKey);
      cancelDebouncedSaves(['identity']);
      pendingRetagsByTargetRef.current.delete(targetKey);
    }
    clearCountdown();
    clearRetagReset();
    setStoredState(emptyState(visit, targetKey));
  }, [
    cancelDebouncedSaves,
    clearCountdown,
    clearRetagReset,
    controller,
    mutationsBlocked,
    targetKey,
    visit,
  ]);

  const retryPendingIdentityWork = useCallback(() => {
    if (
      !targetKey
      || !visit.isActive()
      || blockedRef.current
      || (
        !pendingRetagsByTargetRef.current.get(targetKey)?.length
        && !latestIdentityJobByTargetRef.current.has(targetKey)
      )
    ) {
      return;
    }
    scheduleIdentityWorkflow(async () => {
      await runPendingRetags(visit, targetKey);
      const latest = latestIdentityJobByTargetRef.current.get(targetKey);
      if (latest) await runIdentityUpdate(latest);
    }, 0);
  }, [
    runIdentityUpdate,
    runPendingRetags,
    scheduleIdentityWorkflow,
    targetKey,
    visit,
  ]);

  const hasPendingIdentityWork = useCallback(() => (
    Boolean(
      targetKey
      && visit.isActive()
      && !blockedRef.current
      && (
        pendingRetagsByTargetRef.current.get(targetKey)?.length
        || latestIdentityJobByTargetRef.current.has(targetKey)
      ),
    )
  ), [targetKey, visit]);

  return {
    hasPendingIdentityWork,
    identityUpdateState: state.identityUpdateState,
    identityUpdateSecondsRemaining:
      state.identityUpdateSecondsRemaining,
    retagState: state.retagState,
    retryPendingIdentityWork,
    scheduleIdentityUpdate,
  } as const;
}
