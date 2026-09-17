import { useEffect, useRef } from 'react';

/** Handle a cancelable first touch without waiting for a synthesized click.
 * A native non-passive listener can cancel the synthesized click; mouse and
 * keyboard activation continue through the button's ordinary onClick.
 */
export default function useTouchScrollAction(action: () => void) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const button = ref.current;
    if (!button) return;
    const activate = (event: TouchEvent) => {
      if (event.touches.length !== 1 || !event.cancelable) return;
      event.preventDefault();
      action();
    };
    button.addEventListener('touchstart', activate, { passive: false });
    return () => button.removeEventListener('touchstart', activate);
  }, [action]);
  return ref;
}
