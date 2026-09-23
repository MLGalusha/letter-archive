import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePageStripMotion } from '../usePageStripMotion';
const select = vi.fn();
const originalObserver = globalThis.ResizeObserver;
function Harness({ selected = 0 }: { selected?: number }) {
  const { root, choose } = usePageStripMotion(selected, select, 3);
  return <div ref={root} data-testid="strip">{[0, 1, 2].map(index => <button key={index} onClick={() => choose.current(index)}>{index}</button>)}</div>;
}
beforeEach(() => {
  select.mockClear();
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.tagName === 'BUTTON') {
      const left = Number(this.textContent) * 64 + 4 - this.parentElement!.scrollLeft;
      return { left, right: left + 56, width: 56 } as DOMRect;
    }
    return { left: 0, right: 128, width: 128 } as DOMRect;
  });
});
afterEach(() => { vi.restoreAllMocks(); globalThis.ResizeObserver = originalObserver; });
describe('thumbnail browsing', () => {
  it('never selects a page because scrolling settled', () => {
    render(<Harness />);
    const strip = screen.getByTestId('strip'); strip.scrollLeft = 64;
    fireEvent.scroll(strip); fireEvent(strip, new Event('scrollend'));
    expect(select).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('2')); expect(select).toHaveBeenCalledExactlyOnceWith(2);
  });
  it('leaves visible choices still and minimally reveals an offscreen selection', () => {
    const view = render(<Harness />);
    const strip = screen.getByTestId('strip'); expect(strip.scrollLeft).toBe(0);
    view.rerender(<Harness selected={1} />); expect(strip.scrollLeft).toBe(0);
    view.rerender(<Harness selected={2} />); expect(strip.scrollLeft).toBe(64);
  });
});
