import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import HeaderScrubber from './HeaderScrubber';

describe('shared header navigation', () => {
  it('implements bounded slider keys without leaking them to page shortcuts', () => {
    const onNavigate = vi.fn();
    const leaked = vi.fn();
    window.addEventListener('keydown', leaked);
    const view = render(<HeaderScrubber position={20} total={80} onNavigate={onNavigate} onPrev={vi.fn()} onNext={vi.fn()} wrap />);
    const slider = screen.getByRole('slider');
    for (const [key, position] of [['ArrowRight', 21], ['ArrowLeft', 19], ['ArrowUp', 21], ['ArrowDown', 19], ['Home', 1], ['End', 80]] as const) {
      fireEvent.keyDown(slider, { key });
      expect(onNavigate).toHaveBeenLastCalledWith(position);
    }
    expect(leaked).not.toHaveBeenCalled();
    view.rerender(<HeaderScrubber position={1} total={2} onNavigate={onNavigate} onPrev={vi.fn()} onNext={vi.fn()} wrap />);
    onNavigate.mockClear();
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(onNavigate).not.toHaveBeenCalled();
    window.removeEventListener('keydown', leaked);
  });

  it('retains focused controls while pending and blocks stale destinations', () => {
    const props = { position: 2, total: 3, onNavigate: vi.fn(), onPrev: vi.fn(), onNext: vi.fn(), wrap: true };
    const view = render(<HeaderScrubber {...props} />);
    const next = screen.getByRole('button', { name: 'Next' });
    next.focus();
    view.rerender(<HeaderScrubber {...props} disabled />);
    expect(next).toHaveFocus();
    expect(next).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(next);
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'End' });
    expect(props.onNext).not.toHaveBeenCalled();
    expect(props.onNavigate).not.toHaveBeenCalled();
    view.rerender(<HeaderScrubber {...props} position={3} />);
    expect(next).toHaveFocus();
    fireEvent.click(next);
    expect(props.onNext).toHaveBeenCalledOnce();
  });
});
