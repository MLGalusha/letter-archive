import { useCallback, useEffect, useRef, useState } from 'react';

export interface ReviewTimer {
  elapsedMs: number;
  running: boolean;
  hasStarted: boolean;
  modified: boolean;
  start: () => void;
  pause: () => number;
  reset: () => void;
  markSaved: () => void;
}

export function useReviewTimer(
  identity: string,
  savedElapsedMs = 0,
): ReviewTimer {
  const [elapsedMs, setElapsedMs] = useState(savedElapsedMs);
  const [running, setRunning] = useState(false);
  const [hasStarted, setHasStarted] = useState(savedElapsedMs > 0);
  const [modified, setModified] = useState(false);
  const accumulatedRef = useRef(savedElapsedMs);
  const startedAtRef = useRef<number | null>(null);
  const resumeAfterExternalPauseRef = useRef(false);

  const currentElapsed = useCallback(() => {
    if (startedAtRef.current === null) return accumulatedRef.current;
    return accumulatedRef.current + (performance.now() - startedAtRef.current);
  }, []);

  const start = useCallback(() => {
    if (startedAtRef.current !== null) return;
    startedAtRef.current = performance.now();
    setHasStarted(true);
    setModified(true);
    setRunning(true);
  }, []);

  const pause = useCallback(() => {
    if (startedAtRef.current !== null) {
      accumulatedRef.current = currentElapsed();
      startedAtRef.current = null;
      setElapsedMs(Math.round(accumulatedRef.current));
    }
    setRunning(false);
    return Math.round(accumulatedRef.current);
  }, [currentElapsed]);

  const reset = useCallback(() => {
    accumulatedRef.current = 0;
    startedAtRef.current = null;
    resumeAfterExternalPauseRef.current = false;
    setElapsedMs(0);
    setHasStarted(false);
    setModified(true);
    setRunning(false);
  }, []);

  const markSaved = useCallback(() => {
    setModified(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    accumulatedRef.current = savedElapsedMs;
    startedAtRef.current = null;
    resumeAfterExternalPauseRef.current = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setElapsedMs(savedElapsedMs);
      setHasStarted(savedElapsedMs > 0);
      setModified(false);
      setRunning(false);
    });
    return () => {
      cancelled = true;
    };
  }, [identity, savedElapsedMs]);

  useEffect(() => {
    if (!running) return;
    const interval = window.setInterval(() => {
      setElapsedMs(Math.round(currentElapsed()));
    }, 250);
    return () => window.clearInterval(interval);
  }, [currentElapsed, running]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        resumeAfterExternalPauseRef.current = (
          resumeAfterExternalPauseRef.current
          || startedAtRef.current !== null
        );
        pause();
      } else if (
        resumeAfterExternalPauseRef.current
        && document.hasFocus()
      ) {
        resumeAfterExternalPauseRef.current = false;
        start();
      }
    };
    const handleWindowBlur = () => {
      resumeAfterExternalPauseRef.current = (
        resumeAfterExternalPauseRef.current
        || startedAtRef.current !== null
      );
      pause();
    };
    const handleWindowFocus = () => {
      if (document.hidden || !resumeAfterExternalPauseRef.current) return;
      resumeAfterExternalPauseRef.current = false;
      start();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('focus', handleWindowFocus);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, [pause, start]);

  useEffect(() => () => {
    if (startedAtRef.current !== null) {
      accumulatedRef.current = currentElapsed();
      startedAtRef.current = null;
    }
  }, [currentElapsed]);

  return {
    elapsedMs,
    running,
    hasStarted,
    modified,
    start,
    pause,
    reset,
    markSaved,
  };
}

export function formatReviewTime(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const tenths = Math.floor((milliseconds % 1000) / 100);
  return `${minutes}:${String(seconds).padStart(2, '0')}.${tenths}`;
}
