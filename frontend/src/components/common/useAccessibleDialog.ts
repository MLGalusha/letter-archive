import { useCallback, useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const canReceiveRestoredFocus = (
  element: HTMLElement | null,
): element is HTMLElement => (
  Boolean(element?.isConnected)
  && !element!.matches(':disabled')
);

interface AccessibleDialogOptions {
  isOpen: boolean;
  onClose: () => void;
  isolateBackground?: boolean;
}

export function useAccessibleDialog({
  isOpen,
  onClose,
  isolateBackground = false,
}: AccessibleDialogOptions) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const deferRestoreRef = useRef(false);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const restoreFocus = useCallback(() => {
    const opener = openerRef.current;
    if (!canReceiveRestoredFocus(opener)) return false;

    const currentDialog = dialogRef.current;
    const otherDialogs = Array.from(
      document.querySelectorAll<HTMLElement>('[aria-modal="true"]'),
    ).filter((dialog) => dialog !== currentDialog);
    if (
      otherDialogs.length > 0
      && !otherDialogs.some((dialog) => dialog.contains(opener))
    ) {
      return false;
    }

    opener.focus({ preventScroll: true });
    return document.activeElement === opener;
  }, []);

  const deferFocusRestore = useCallback(() => {
    deferRestoreRef.current = true;
  }, []);

  const restoreFocusAfterUpdate = useCallback(() => {
    const attemptRestore = () => {
      const activeElement = document.activeElement;
      const documentOwnsFocus = (
        !activeElement
        || activeElement === document.body
        || activeElement === document.documentElement
        || activeElement === dialogRef.current
      );
      const anotherModalOwnsFocus = Array.from(
        document.querySelectorAll<HTMLElement>('[aria-modal="true"]'),
      ).some((dialog) => dialog !== dialogRef.current);
      if (!documentOwnsFocus || anotherModalOwnsFocus) return true;

      return restoreFocus();
    };

    queueMicrotask(() => {
      if (
        !attemptRestore()
        && typeof requestAnimationFrame === 'function'
      ) {
        requestAnimationFrame(attemptRestore);
      }
    });
  }, [restoreFocus]);

  useEffect(() => {
    if (!isOpen) return;

    deferRestoreRef.current = false;
    openerRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    const dialog = dialogRef.current;
    // Isolate siblings along the portal's ancestor path without making the
    // dialog itself inert. Preserve pre-existing inert state on cleanup.
    const isolated: Element[] = [];
    if (isolateBackground && dialog) {
      let branch: Element = dialog;
      while (branch.parentElement) {
        for (const sibling of branch.parentElement.children) {
          if (sibling !== branch && !sibling.hasAttribute('inert')) {
            sibling.setAttribute('inert', '');
            isolated.push(sibling);
          }
        }
        if (branch.parentElement === document.body) break;
        branch = branch.parentElement;
      }
    }
    const focusable = () => Array.from(
      dialog?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [],
    ).filter(element => element.tabIndex >= 0
      && !element.matches(':disabled')
      && !element.closest('[hidden], [inert]')
      && getComputedStyle(element).display !== 'none'
      && getComputedStyle(element).visibility !== 'hidden');
    (focusable()[0] ?? dialog)?.focus({ preventScroll: true });

    const isTopmostDialog = () => {
      const dialogs = document.querySelectorAll<HTMLElement>(
        '[aria-modal="true"]',
      );
      return dialogs.length > 0 && dialogs[dialogs.length - 1] === dialog;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isTopmostDialog()) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const controls = focusable();
      if (controls.length === 0) {
        event.preventDefault();
        dialog?.focus();
        return;
      }

      // Own the whole modal tab sequence, including Safari configurations
      // that otherwise skip buttons and move focus into browser chrome.
      event.preventDefault();
      const current = controls.indexOf(document.activeElement as HTMLElement);
      const next = current < 0
        ? (event.shiftKey ? controls.length - 1 : 0)
        : (current + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
      controls[next].focus();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      isolated.forEach(element => element.removeAttribute('inert'));
      if (!deferRestoreRef.current) {
        restoreFocus();
      }
    };
  }, [isOpen, isolateBackground, restoreFocus]);

  return {
    dialogRef,
    restoreFocus,
    restoreFocusAfterUpdate,
    deferFocusRestore,
  } as const;
}
