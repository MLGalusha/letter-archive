import { useLayoutEffect, type RefObject } from 'react';
import { appScrollTo, getAppScrollY } from '../utils/appScroll';

function setTemporaryStyles(element: HTMLElement, values: Record<string, string>) {
  const previous = Object.keys(values).map(name => ({
    name, value: element.style.getPropertyValue(name), priority: element.style.getPropertyPriority(name),
  }));
  for (const [name, value] of Object.entries(values)) element.style.setProperty(name, value);
  return () => {
    for (const { name, value, priority } of previous) {
      if (value) element.style.setProperty(name, value, priority);
      else element.style.removeProperty(name);
    }
  };
}

/** The public reader's modal owns document painting and scroll locking together. */
export function useReaderViewerSurface(active: boolean, dialogRef: RefObject<HTMLDivElement | null>, surfaceColor?: string) {
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    const backdrop = dialog?.parentElement;
    if (!active || !dialog || !backdrop) return;

    const savedY = getAppScrollY();
    const openedPath = window.location.pathname;
    // Read the actual surface so the root, body and browser hint cannot drift
    // from the viewer's CSS. Layout effect applies them in the opening commit.
    const color = surfaceColor ?? getComputedStyle(backdrop).backgroundColor;
    const restoreRoot = setTemporaryStyles(document.documentElement, {
      'background-color': color, 'overflow-x': 'hidden', 'overflow-y': 'hidden',
      // Preserve the document geometry used as the thumbnail return target.
      'scrollbar-gutter': 'stable',
    });
    const restoreBody = setTemporaryStyles(document.body, {
      position: 'fixed', top: `-${savedY}px`, width: '100%',
      'overflow-x': 'hidden', 'overflow-y': 'hidden', 'background-color': color,
    });
    const themes = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')]
      .map(element => ({ element, content: element.getAttribute('content') }));
    for (const { element } of themes) element.content = color;

    // Only the image stage and thumbnail scroller own movement. Do not cancel
    // gestures globally: the drawer must retain native scrolling and momentum.
    const preventChromeScroll = (event: Event) => {
      if (event instanceof WheelEvent && event.ctrlKey) return;
      const target = event.target;
      if (target instanceof Element && target.closest('.viewer-container, .viewer-page-drawer')) return;
      if (event.cancelable) event.preventDefault();
    };
    backdrop.addEventListener('touchmove', preventChromeScroll, { passive: false });
    backdrop.addEventListener('wheel', preventChromeScroll, { passive: false });

    return () => {
      backdrop.removeEventListener('touchmove', preventChromeScroll);
      backdrop.removeEventListener('wheel', preventChromeScroll);
      restoreBody();
      restoreRoot();
      for (const { element, content } of themes) {
        if (content === null) element.removeAttribute('content');
        else element.content = content;
      }
      // Router/history restoration owns a different route's position.
      if (window.location.pathname === openedPath) appScrollTo(savedY);
    };
  }, [active, dialogRef, surfaceColor]);
}
