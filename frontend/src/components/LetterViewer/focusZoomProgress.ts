/** Page chrome and centering follow the first 25% of direct zoom. Smooth the
 * endpoints without delaying the scan's actual scale behind the gesture. */
export function focusZoomProgress(scale: number) {
  const progress = Math.min(1, Math.max(0, (scale - 1) / .25));
  return progress * progress * (3 - 2 * progress);
}
