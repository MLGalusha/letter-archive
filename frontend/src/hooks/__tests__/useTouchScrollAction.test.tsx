import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import useTouchScrollAction from '../useTouchScrollAction';

function Control({ action }: { action: () => void }) {
  const ref = useTouchScrollAction(action);
  return <button ref={ref} onClick={action}>Scroll</button>;
}
const touch = { identifier: 1, clientX: 100, clientY: 100 };
function send(button: HTMLElement, type: string, touches: object[], changedTouches = touches, cancelable = true) {
  const event = new Event(type, { bubbles: true, cancelable });
  Object.defineProperties(event, { touches: { value: touches }, changedTouches: { value: changedTouches } });
  fireEvent(button, event);
  return event;
}

describe('floating scroll control touch activation', () => {
  it('waits for an unmoved touch to finish and prevents a duplicate click', () => {
    const action = vi.fn();
    render(<Control action={action} />);
    const button = screen.getByRole('button');
    expect(send(button, 'touchstart', [touch]).defaultPrevented).toBe(false);
    expect(action).not.toHaveBeenCalled();
    expect(send(button, 'touchend', [], [touch]).defaultPrevented).toBe(true);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('leaves a swipe alone even if the finger returns to its starting point', () => {
    const action = vi.fn();
    render(<Control action={action} />);
    const button = screen.getByRole('button');
    send(button, 'touchstart', [touch]);
    expect(send(button, 'touchmove', [{ ...touch, clientY: 140 }]).defaultPrevented).toBe(false);
    expect(send(button, 'touchend', [], [touch]).defaultPrevented).toBe(false);
    expect(action).not.toHaveBeenCalled();
  });

  it('rejects displaced endings even without an intermediate move event', () => {
    const action = vi.fn();
    render(<Control action={action} />);
    const button = screen.getByRole('button');
    send(button, 'touchstart', [touch]);
    send(button, 'touchend', [], [{ ...touch, clientY: 140 }]);
    expect(action).not.toHaveBeenCalled();
  });

  it('leaves multi-touch and canceled touches alone', () => {
    const action = vi.fn();
    render(<Control action={action} />);
    const button = screen.getByRole('button');
    send(button, 'touchstart', [touch, { ...touch, identifier: 2 }]);
    send(button, 'touchend', [], [touch]);
    send(button, 'touchstart', [touch]);
    send(button, 'touchcancel', [], [touch]);
    send(button, 'touchend', [], [touch]);

    expect(action).not.toHaveBeenCalled();
  });

  it('keeps normal click activation and removes listeners on unmount', () => {
    const action = vi.fn();
    const { unmount } = render(<Control action={action} />);
    const button = screen.getByRole('button');
    fireEvent.click(button);
    expect(action).toHaveBeenCalledTimes(1);
    unmount();
    send(button, 'touchstart', [touch]);
    send(button, 'touchend', [], [touch]);
    expect(action).toHaveBeenCalledTimes(1);
  });
});

it('activates noncancelable touch endings once and preserves keyboard activation', () => {
  const action = vi.fn();
  render(<Control action={action} />);
  const button = screen.getByRole('button');
  send(button, 'touchstart', [touch]);
  send(button, 'touchend', [], [touch], false);
  fireEvent.click(button, { detail: 1 });
  expect(action).toHaveBeenCalledTimes(1);
  fireEvent.click(button, { detail: 0 });
  expect(action).toHaveBeenCalledTimes(2);
});
