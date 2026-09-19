const running = new WeakMap<HTMLElement, Animation>();

/** Chrome follows a mode change, never the intermediate zoom amount. Return
 * animations belong to the document nodes so they survive the viewer closing. */
export function animateFocusChrome(shell: HTMLElement, hidden: boolean, duration = 420) {
  const elements = shell.querySelectorAll<HTMLElement>(
    '.header, .header-reader-cover, .scan-slide, .letter-hero-section, .letter-reading-column',
  );
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  elements.forEach(element => {
    const computed = getComputedStyle(element);
    const from = { transform: computed.transform, opacity: computed.opacity };
    running.get(element)?.cancel();
    const header = element.matches('.header, .header-reader-cover');
    const content = element.matches('.letter-hero-section, .letter-reading-column');
    const side = element.matches('.scan-slide') && element.dataset.focusSide !== 'selected';
    const transform = !hidden ? 'none' : header ? 'translateY(-120%)'
      : content ? 'translateY(100vh)' : side ? `translateX(${element.style.getPropertyValue('--reader-focus-exit-x') || '0px'})` : 'none';
    const opacity = hidden && content ? '0' : '1';
    element.style.transform = transform;
    element.style.opacity = opacity;
    const animation = element.animate([from, { transform, opacity }], {
      duration: reduced ? 0 : duration,
      easing: header && hidden ? 'ease-in-out' : 'cubic-bezier(.22,.75,.2,1)',
    });
    running.set(element, animation);
    void animation.finished.then(() => {
      if (running.get(element) !== animation) return;
      running.delete(element);
      if (!hidden) {
        element.style.removeProperty('transform');
        element.style.removeProperty('opacity');
      }
    }).catch(() => { /* A reversed mode change owns the new animation. */ });
  });
}
