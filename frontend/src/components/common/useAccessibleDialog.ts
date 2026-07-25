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
}

export function useAccessibleDialog({
  isOpen,
  onClose,
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

    opener.focus();
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
    const focusable = () => Array.from(
      dialog?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [],
    );
    (focusable()[0] ?? dialog)?.focus();

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

      const first = controls[0];
      const last = controls[controls.length - 1];
      const activeElement = document.activeElement;
      if (
        event.shiftKey
        && (activeElement === first || !dialog?.contains(activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey
        && (activeElement === last || !dialog?.contains(activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (!deferRestoreRef.current) {
        restoreFocus();
      }
    };
  }, [isOpen, restoreFocus]);

  return {
    dialogRef,
    restoreFocus,
    restoreFocusAfterUpdate,
    deferFocusRestore,
  } as const;
}
