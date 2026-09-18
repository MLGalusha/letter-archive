import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import BackToTop from '../BackToTop';
import type { SmoothScrollOptions } from '../../utils/smoothScrollTo';

const { scrollTo } = vi.hoisted(() => ({ scrollTo: vi.fn() }));
vi.mock('../../hooks/useSmoothScroll', () => ({ default: () => scrollTo }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); scrollTo.mockReset(); });
function scroll(y: number) {
  Object.defineProperty(window, 'scrollY', { configurable: true, value: y });
  fireEvent.scroll(window);
}
it('accumulates slow upward movement and releases suppression after cancellation', () => {
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => { cb(0); return 1; });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  scroll(1000);
  render(<BackToTop />);
  const button = screen.getByRole('button', { name: 'Back to top' });
  expect(button).toHaveAttribute('tabindex', '-1');
  for (const y of [995, 990, 985, 980, 975, 970, 965]) scroll(y);
  expect(button).toHaveClass('back-to-top--visible');
  expect(button).toHaveAttribute('tabindex', '0');
  fireEvent.click(button);
  const options = scrollTo.mock.calls[0][1] as SmoothScrollOptions;
  act(() => options.onStep?.(900));
  scroll(900);
  expect(button).not.toHaveClass('back-to-top--visible');
  act(() => options.onFinish?.(true));
  for (const y of [890, 880, 870, 860]) scroll(y);
  expect(button).toHaveClass('back-to-top--visible');
});
