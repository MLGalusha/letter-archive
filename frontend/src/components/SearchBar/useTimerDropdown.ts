import { useEffect, useRef } from "react";

interface UseTimerDropdownOptions {
  delay?: number;
  pinned: boolean;
  onClose: () => void;
}

export default function useTimerDropdown({ delay = 300, pinned, onClose }: UseTimerDropdownOptions) {
  const timerRef = useRef<number | null>(null);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const scheduleClose = () => {
    clearTimer();
    if (pinned) return;
    timerRef.current = window.setTimeout(() => {
      onClose();
      timerRef.current = null;
    }, delay);
  };

  useEffect(() => () => clearTimer(), []);

  return { clearTimer, scheduleClose };
}
