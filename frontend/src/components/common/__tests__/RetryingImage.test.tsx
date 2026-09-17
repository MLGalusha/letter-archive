import { createRef } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RetryingImage } from '../RetryingImage';

afterEach(() => vi.useRealTimers());

describe('RetryingImage', () => {
  it('preserves the img, ref and attributes while retrying the same variant at most twice', () => {
    vi.useFakeTimers();
    const ref = createRef<HTMLImageElement>();
    const onLoad = vi.fn();
    const onError = vi.fn();
    const { container } = render(<RetryingImage ref={ref} src="/images/private?w=200" alt="Page" className="thumb" loading="lazy" style={{ opacity: 0.5 }} onLoad={onLoad} onError={onError} />);
    const first = screen.getByAltText('Page');
    expect(container.children).toHaveLength(1);
    expect(container.firstChild).toBe(first);
    expect(ref.current).toBe(first);
    expect(first).toHaveAttribute('class', 'thumb');
    expect(first).toHaveAttribute('loading', 'lazy');
    fireEvent.error(first);
    expect(first).not.toBeVisible();
    act(() => vi.advanceTimersByTime(1000));
    const second = screen.getByAltText('Page');
    expect(second).not.toBe(first);
    expect(ref.current).toBe(second);
    expect(second).toHaveAttribute('src', '/images/private?w=200');
    expect(second).toHaveStyle({ opacity: '0.5' });
    expect(second).toBeVisible();
    fireEvent.error(second);
    act(() => vi.advanceTimersByTime(2000));
    const third = screen.getByAltText('Page');
    fireEvent.error(third);
    act(() => vi.advanceTimersByTime(60000));
    expect(screen.getByAltText('Page')).toBe(third);
    expect(third).not.toBeVisible();
    expect(onError).toHaveBeenCalledTimes(3);
    fireEvent.load(third);
    expect(third).toBeVisible();
    expect(onLoad).toHaveBeenCalledOnce();
  });

  it('cancels pending work on source change and unmount, restoring the caller visibility', () => {
    vi.useFakeTimers();
    const { rerender, unmount } = render(<RetryingImage src="/images/a?w=300" alt="Page" />);
    fireEvent.error(screen.getByAltText('Page'));
    rerender(<RetryingImage src="/images/b?w=300" alt="Page" style={{ visibility: 'collapse' }} />);
    const replacement = screen.getByAltText('Page');
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.getByAltText('Page')).toBe(replacement);
    expect(replacement).toHaveStyle({ visibility: 'collapse' });
    fireEvent.error(replacement);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
