export type GestureAxis = 'undecided' | 'horizontal' | 'vertical';

/** Preserve the page swipe's conservative intent threshold; callers freeze the result. */
export function decideGestureAxis(dx: number, dy: number, threshold = 20, dominance = 1.8): GestureAxis {
  if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return 'undecided';
  return Math.abs(dx) > Math.abs(dy) * dominance ? 'horizontal' : 'vertical';
}
