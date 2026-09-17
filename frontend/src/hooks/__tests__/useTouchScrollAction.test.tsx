import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import useTouchScrollAction from '../useTouchScrollAction';

function Control({ action }: { action: () => void }) {
  const ref = useTouchScrollAction(action);
  return <button ref={ref} onClick={action}>Scroll</button>;
}

describe('floating scroll control touch activation', () => {
  it('acts on the first cancelable touch and prevents a synthesized click', () => {
    const action = vi.fn();
    render(<Control action={action} />);
    const touch = new Event('touchstart', { bubbles: true, cancelable: true });
    Object.defineProperty(touch, 'touches', { value: [{}] });
    fireEvent(screen.getByRole('button'), touch);
    expect(action).toHaveBeenCalledTimes(1);
    expect(touch.defaultPrevented).toBe(true);
  });

  it('leaves multi-touch and noncancelable gestures alone', () => {
    const action = vi.fn();
    render(<Control action={action} />);
    fireEvent.touchStart(screen.getByRole('button'), { touches: [{}, {}], cancelable: true });
    fireEvent.touchStart(screen.getByRole('button'), { touches: [{}], cancelable: false });
    expect(action).not.toHaveBeenCalled();
  });

  it('keeps normal click activation and removes its listener on unmount', () => {
    const action = vi.fn();
    const { unmount } = render(<Control action={action} />);
    const button = screen.getByRole('button');
    fireEvent.click(button);
    expect(action).toHaveBeenCalledTimes(1);
    unmount();
    fireEvent.touchStart(button, { touches: [{}], cancelable: true });
    expect(action).toHaveBeenCalledTimes(1);
  });
});
