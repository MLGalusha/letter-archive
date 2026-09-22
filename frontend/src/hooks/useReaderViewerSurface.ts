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
    const rootStyle = getComputedStyle(document.documentElement);
    const gutter = rootStyle.scrollbarGutter.includes('stable') ? rootStyle.scrollbarGutter
      : window.innerWidth > document.documentElement.clientWidth ? 'stable' : 'auto';
    const restoreRoot = setTemporaryStyles(document.documentElement, {
      'background-color': color, 'overflow-x': 'clip', 'overflow-y': 'visible',
      // Preserve the document geometry used as the thumbnail return target.
      // Overlay scrollbars have no gutter. Reserving one would shrink the page
      // during zoom and make it jump back when the lock is released.
      'scrollbar-gutter': gutter,
    });
    // Keep the reader in the document painting layer. A fixed body plus fixed
    // overlay is clipped above Safari's browser controls. Freeze only the
    // underlying application, preserving its layout and React state for return.
    const app = document.getElementById('root');
    const restoreApp = app ? setTemporaryStyles(app, {
      position: 'absolute', top: '0px', width: '100%', height: '0px',
      overflow: 'hidden', visibility: 'hidden',
    }) : () => {};
    const restoreHeaders = [...document.querySelectorAll<HTMLElement>('.header, .header-reader-cover')]
      .map(element => setTemporaryStyles(element, { display: 'none' }));
    const restoreBody = setTemporaryStyles(document.body, {
      position: 'static', width: '100%', 'min-height': '0px',
      'overflow-x': 'clip', 'overflow-y': 'visible', 'background-color': color,
    });
    // Center the viewing surface within real document paint space. Safari can
    // then sample the zoomed image above and below its unobscured viewport.
    const alignSurface = () => {
      if (Math.abs(window.scrollY - backdrop.offsetTop) > 1) appScrollTo(backdrop.offsetTop);
    };
    alignSurface();
    const resize = new ResizeObserver(alignSurface);
    resize.observe(backdrop);
    // Retain modal scroll locking without disabling the document paint layer.
    window.addEventListener('scroll', alignSurface, { passive: true });
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
      resize.disconnect();
      window.removeEventListener('scroll', alignSurface);
      restoreBody();
      restoreApp();
      restoreHeaders.forEach(restore => restore());
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
