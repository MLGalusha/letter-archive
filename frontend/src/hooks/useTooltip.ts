import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

interface UseTooltipResult {
  show: boolean;
  position: { x: number; y: number };
  ref: RefObject<HTMLDivElement | null>;
  showAt: (x: number, y: number) => void;
  close: () => void;
}

export function useTooltip(autoDismissMs = 3000): UseTooltipResult {
  const [show, setShow] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const ref = useRef<HTMLDivElement>(null);

  const showAt = useCallback((x: number, y: number) => {
    setPosition({ x, y });
    setShow(true);
  }, []);

  const close = useCallback(() => {
    setShow(false);
  }, []);

  useEffect(() => {
    if (!show) {
      return;
    }

    const timer = setTimeout(close, autoDismissMs);
    return () => clearTimeout(timer);
  }, [show, autoDismissMs, close]);

  useEffect(() => {
    if (!show) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        close();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [show, close]);

  return { show, position, ref, showAt, close };
}
