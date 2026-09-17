import { act, createEvent, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import useSwipeNavigation from '../useSwipeNavigation';

function Harness({ navigate }: { navigate: () => void }) {
  const { ref, offset, isSwiping } = useSwipeNavigation({ onSwipeLeft: navigate, onSwipeRight: navigate });
  return <div ref={ref} data-testid="surface" data-offset={offset} data-swiping={isSwiping}>
    <div data-swipe-ignore data-testid="ignored">Carousel</div><input aria-label="Search" />
  </div>;
}
function start(surface: Element) { fireEvent.touchStart(surface, { touches: [{ clientX: 300, clientY: 100 }] }); }
function move(surface: Element, x: number, y: number) {
  const event = createEvent.touchMove(surface, { touches: [{ clientX: x, clientY: y }], cancelable: true });
  fireEvent(surface, event);
  return event.defaultPrevented;
}
afterEach(() => { vi.useRealTimers(); });

describe('page swipe intent', () => {
  it('retains the 20px threshold and conservative locked direction', () => {
    const navigate = vi.fn();
    render(<Harness navigate={navigate} />);
    const surface = screen.getByTestId('surface');
    start(surface);
    expect(move(surface, 281, 100)).toBe(false);
    expect(move(surface, 270, 125)).toBe(false);
    expect(move(surface, 100, 130)).toBe(false);
    fireEvent.touchEnd(surface, { touches: [] });
    expect(navigate).not.toHaveBeenCalled();
    expect(surface).toHaveAttribute('data-offset', '0');
  });

  it('still commits a clearly horizontal page swipe', () => {
    vi.useFakeTimers();
    const navigate = vi.fn();
    render(<Harness navigate={navigate} />);
    const surface = screen.getByTestId('surface');
    Object.defineProperty(surface, 'clientWidth', { value: 400 });
    start(surface);
    expect(move(surface, 280, 101)).toBe(true);
    expect(move(surface, 150, 170)).toBe(true);
    fireEvent.touchEnd(surface, { touches: [] });
    act(() => { vi.advanceTimersByTime(400); });
    expect(navigate).toHaveBeenCalledOnce();
  });

  it.each(['cancel', 'pinch'])('never navigates from the remainder of a %s gesture', (reason) => {
    vi.useFakeTimers();
    const navigate = vi.fn();
    render(<Harness navigate={navigate} />);
    const surface = screen.getByTestId('surface');
    Object.defineProperty(surface, 'clientWidth', { value: 400 });
    start(surface);
    expect(move(surface, 100, 100)).toBe(true);
    if (reason === 'cancel') fireEvent.touchCancel(surface, { touches: [] });
    else fireEvent.touchStart(surface, { touches: [{ clientX: 100, clientY: 100 }, { clientX: 130, clientY: 100 }] });
    expect(move(surface, 80, 100)).toBe(false);
    fireEvent.touchEnd(surface, { touches: [] });
    act(() => { vi.advanceTimersByTime(400); });
    expect(navigate).not.toHaveBeenCalled();
    expect(surface).toHaveAttribute('data-offset', '0');
    expect(surface).toHaveAttribute('data-swiping', 'false');
  });

  it('retains ignored-carousel and focused-text exclusions', () => {
    const navigate = vi.fn();
    render(<Harness navigate={navigate} />);
    const surface = screen.getByTestId('surface');
    start(screen.getByTestId('ignored'));
    expect(move(surface, 100, 100)).toBe(false);
    fireEvent.touchEnd(surface, { touches: [] });
    screen.getByRole('textbox').focus();
    start(surface);
    expect(move(surface, 100, 100)).toBe(false);
    fireEvent.touchEnd(surface, { touches: [] });
    expect(navigate).not.toHaveBeenCalled();
  });
});
