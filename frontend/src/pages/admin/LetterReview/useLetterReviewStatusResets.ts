import { useCallback, useEffect, useRef } from 'react';
import type { LetterReviewVisit } from './useLetterReviewVisit';

export type LetterReviewStatusResetLane =
  | 'transcription'
  | 'metadata-regeneration'
  | 'entity-reextract';

type Timer = ReturnType<typeof setTimeout>;

export type ScheduleLetterReviewStatusReset = (
  lane: LetterReviewStatusResetLane,
  callback: () => void,
  delayMs: number,
) => void;

/**
 * Keeps unrelated completion badges from cancelling one another.
 *
 * These timers own UI state only, so route navigation cancels the old visit's
 * callbacks instead of allowing them to reset a new letter's status.
 */
export function useLetterReviewStatusResets(visit: LetterReviewVisit) {
  const timersRef = useRef(new Map<LetterReviewStatusResetLane, Timer>());

  const clearAll = useCallback(() => {
    for (const timer of timersRef.current.values()) {
      clearTimeout(timer);
    }
    timersRef.current.clear();
  }, []);

  const scheduleStatusReset = useCallback<ScheduleLetterReviewStatusReset>((
    lane,
    callback,
    delayMs,
  ) => {
    const currentTimer = timersRef.current.get(lane);
    if (currentTimer) clearTimeout(currentTimer);

    const timer = setTimeout(() => {
      if (timersRef.current.get(lane) !== timer) return;
      timersRef.current.delete(lane);
      if (visit.isActive()) callback();
    }, delayMs);
    timersRef.current.set(lane, timer);
  }, [visit]);

  useEffect(() => clearAll, [clearAll, visit]);

  return scheduleStatusReset;
}
