import { useCallback, useEffect, useReducer, useRef } from 'react';

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
  restoreFocusTo?: HTMLElement | null;
}

export function useAccessibleDialog({
  isOpen,
  onClose,
  isolateBackground = false,
  restoreFocusTo,
}: AccessibleDialogOptions) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const deferRestoreRef = useRef(false);
  const pendingRestoreRef = useRef(false);
  const [, requestRestoreCommit] = useReducer((value: number) => value + 1, 0);

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

    opener.focus({ preventScroll: isolateBackground });
    return document.activeElement === opener;
  }, [isolateBackground]);

  const deferFocusRestore = useCallback(() => {
    deferRestoreRef.current = true;
  }, []);

  const restoreFocusAfterUpdate = useCallback(() => {
    pendingRestoreRef.current = true;
    requestRestoreCommit();
  }, []);

  // Retry on React commits rather than assuming a disabled opener becomes
  // available within one animation frame. No timer survives an unmount.
  useEffect(() => {
    if (!pendingRestoreRef.current || isOpen) return;
    const activeElement = document.activeElement;
    const documentOwnsFocus = (
      !activeElement
      || activeElement === document.body
      || activeElement === document.documentElement
    );
    const anotherModalOwnsFocus = Boolean(
      document.querySelector('[aria-modal="true"]'),
    );
    if (!documentOwnsFocus || anotherModalOwnsFocus || restoreFocus()) {
      pendingRestoreRef.current = false;
    }
  });

  useEffect(() => {
    if (!isOpen) return;

    pendingRestoreRef.current = false;
    deferRestoreRef.current = false;
    openerRef.current = restoreFocusTo ?? (document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null);

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
    ).filter(element => element.tabIndex >= 0 && !element.matches(':disabled') && !element.closest('[inert], [hidden]'));
    (focusable()[0] ?? dialog)?.focus({ preventScroll: isolateBackground });

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
      isolated.forEach(element => element.removeAttribute('inert'));
      if (!deferRestoreRef.current) {
        restoreFocus();
      }
    };
  }, [isOpen, isolateBackground, restoreFocus, restoreFocusTo]);

  return {
    dialogRef,
    restoreFocus,
    restoreFocusAfterUpdate,
    deferFocusRestore,
  } as const;
}
