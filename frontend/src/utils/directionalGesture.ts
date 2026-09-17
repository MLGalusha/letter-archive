export type GestureAxis = 'undecided' | 'horizontal' | 'vertical';

/** Preserve the page swipe's conservative intent threshold; callers freeze the result. */
export function decideGestureAxis(dx: number, dy: number): GestureAxis {
  if (Math.abs(dx) < 20 && Math.abs(dy) < 20) return 'undecided';
  return Math.abs(dx) > Math.abs(dy) * 1.8 ? 'horizontal' : 'vertical';
}
