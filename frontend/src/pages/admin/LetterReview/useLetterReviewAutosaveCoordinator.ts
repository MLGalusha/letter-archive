import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from 'react';
import {
  LetterReviewAutosaveCoordinator,
  type CancelLetterReviewDebouncedSaves,
  type FlushLetterReviewDebouncedSaves,
  type LetterReviewAutosaveRuntime,
  type ScheduleLetterReviewDebouncedSave,
} from './letterReviewAutosaveCoordinator';

export type {
  CancelLetterReviewDebouncedSaves,
  FlushLetterReviewDebouncedSaves,
  LetterReviewAutosaveLane,
  LetterReviewAutosaveStatus,
  LetterReviewDebouncedSaveOptions,
  ScheduleLetterReviewDebouncedSave,
} from './letterReviewAutosaveCoordinator';
export { ALL_LETTER_REVIEW_AUTOSAVE_LANES } from './letterReviewAutosaveCoordinator';

interface UseLetterReviewAutosaveCoordinatorOptions
  extends LetterReviewAutosaveRuntime {
  mutationsBlocked: boolean;
}

export function useLetterReviewAutosaveCoordinator({
  visit,
  targetKey,
  isMutationBlocked,
  mutationsBlocked,
  handleMutationError,
}: UseLetterReviewAutosaveCoordinatorOptions) {
  const runtime = useRef<LetterReviewAutosaveRuntime>({
    visit,
    targetKey,
    isMutationBlocked,
    handleMutationError,
  });
  const [, render] = useReducer((count: number) => count + 1, 0);
  const [coordinator] = useState(
    () => new LetterReviewAutosaveCoordinator(runtime, render),
  );

  useLayoutEffect(() => {
    runtime.current = {
      visit,
      targetKey,
      isMutationBlocked,
      handleMutationError,
    };
  }, [handleMutationError, isMutationBlocked, targetKey, visit]);

  useEffect(() => {
    coordinator.activate();
    return coordinator.deactivate;
  }, [coordinator]);

  useEffect(() => {
    if (mutationsBlocked && targetKey) {
      coordinator.cancelQueuedTarget(targetKey);
    }
  }, [coordinator, mutationsBlocked, targetKey]);

  const scheduleDebouncedSave = useCallback<ScheduleLetterReviewDebouncedSave>(
    (task, options) => coordinator.schedule(task, options),
    [coordinator],
  );
  const flushDebouncedSaves = useCallback<FlushLetterReviewDebouncedSaves>(
    (lanes) => coordinator.flush(lanes),
    [coordinator],
  );
  const cancelDebouncedSaves = useCallback<CancelLetterReviewDebouncedSaves>(
    (lanes) => coordinator.cancel(lanes),
    [coordinator],
  );
  const { autoSaveStatus, busyLanes } = coordinator.snapshot(visit);

  return {
    autoSaveStatus,
    busyLanes,
    scheduleDebouncedSave,
    flushDebouncedSaves,
    cancelDebouncedSaves,
  } as const;
}
