import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PreviewImage } from '../PreviewImage';
import { recordImageLoad } from '../../../utils/imagePerformance';
vi.mock('../../../utils/imagePerformance', () => ({ recordImageLoad: vi.fn() }));

const OriginalObserver = globalThis.IntersectionObserver;
afterEach(() => { globalThis.IntersectionObserver = OriginalObserver; vi.restoreAllMocks(); vi.useRealTimers(); });

describe('PreviewImage', () => {
  it('measures elapsed load time when a long session has no Resource Timing entry', () => {
    globalThis.IntersectionObserver = undefined as unknown as typeof IntersectionObserver;
    vi.spyOn(performance, 'getEntriesByName').mockReturnValue([]);
    const now = vi.spyOn(performance, 'now').mockReturnValue(100);
    render(<PreviewImage src="/late-session-image" alt="Scan" />);
    now.mockReturnValue(350);
    fireEvent.load(screen.getByAltText('Scan'));
    expect(recordImageLoad).toHaveBeenLastCalledWith(expect.objectContaining({ durationMs: 250, cached: false }));
  });

  it('starts one display-size image near the scrollport and leaves it available on return', () => {
    let notify: IntersectionObserverCallback;
    let options: IntersectionObserverInit | undefined;
    const disconnect = vi.fn();
    globalThis.IntersectionObserver = class {
      constructor(callback: IntersectionObserverCallback, init: IntersectionObserverInit) { notify = callback; options = init; }
      observe = vi.fn();
      disconnect = disconnect;
    } as unknown as typeof IntersectionObserver;
    const { container, unmount } = render(<div data-image-scroll-root><PreviewImage src="/images/page?w=480" alt="Scan" /></div>);
    const img = screen.getByAltText('Scan');
    expect(img).not.toHaveAttribute('src');
    expect(options).toMatchObject({ root: container.firstChild, rootMargin: '1200px 0px' });
    act(() => notify([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(img).toHaveAttribute('src', '/images/page?w=480');
    expect(container.querySelectorAll('img')).toHaveLength(1);
    expect(img).not.toHaveAttribute('fetchpriority', 'high');
    act(() => notify([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(img).toHaveAttribute('src', '/images/page?w=480');
    unmount();
    expect(disconnect).toHaveBeenCalled();
  });

  it('loads without IntersectionObserver and recovers when a failed source changes', () => {
    globalThis.IntersectionObserver = undefined as unknown as typeof IntersectionObserver;
    const { rerender } = render(<PreviewImage src="/missing" alt="Scan" />);
    const img = screen.getByAltText('Scan');
    expect(img).toHaveAttribute('src', '/missing');
    vi.useFakeTimers();
    fireEvent.error(img);
    act(() => vi.advanceTimersByTime(1000));
    fireEvent.error(screen.getByAltText('Scan'));
    act(() => vi.advanceTimersByTime(2000));
    fireEvent.error(screen.getByAltText('Scan'));
    expect(screen.getByText('Image unavailable')).toBeVisible();
    expect(screen.getByAltText('Scan')).not.toBeVisible();
    rerender(<PreviewImage src="/replacement" alt="Scan" />);
    expect(screen.getByAltText('Scan')).toHaveAttribute('src', '/replacement');
    expect(screen.getByAltText('Scan')).toBeVisible();
    expect(screen.queryByText('Image unavailable')).not.toBeInTheDocument();
  });
  it('retries the same sized URL at most twice and recovers without an original fallback', () => {
    vi.useFakeTimers();
    globalThis.IntersectionObserver = undefined as unknown as typeof IntersectionObserver;
    const { container } = render(<PreviewImage src="/images/page?w=480" alt="Scan" />);
    const first = screen.getByAltText('Scan');
    fireEvent.error(first);
    expect(first).not.toBeVisible();
    expect(screen.getByText('Image unavailable')).toBeVisible();
    act(() => vi.advanceTimersByTime(999));
    expect(screen.getByAltText('Scan')).toBe(first);
    act(() => vi.advanceTimersByTime(1));
    const second = screen.getByAltText('Scan');
    expect(second).not.toBe(first);
    expect(second).toHaveAttribute('src', '/images/page?w=480');
    expect(second).toBeVisible();
    fireEvent.error(second);
    expect(second).not.toBeVisible();
    expect(screen.getByText('Image unavailable')).toBeVisible();
    act(() => vi.advanceTimersByTime(2000));
    const third = screen.getByAltText('Scan');
    fireEvent.error(third);
    act(() => vi.advanceTimersByTime(60000));
    expect(screen.getByAltText('Scan')).toBe(third);
    expect(container.querySelectorAll('img')).toHaveLength(1);
    expect(screen.getByText('Image unavailable')).toBeVisible();
    fireEvent.load(third);
    expect(screen.queryByText('Image unavailable')).not.toBeInTheDocument();
  });

  it('cancels delayed retries when the source changes or the component unmounts', () => {
    vi.useFakeTimers();
    globalThis.IntersectionObserver = undefined as unknown as typeof IntersectionObserver;
    const { rerender, unmount } = render(<PreviewImage src="/old?w=480" alt="Scan" />);
    fireEvent.error(screen.getByAltText('Scan'));
    rerender(<PreviewImage src="/new?w=480" alt="Scan" />);
    const replacement = screen.getByAltText('Scan');
    act(() => vi.advanceTimersByTime(10000));
    expect(screen.getByAltText('Scan')).toBe(replacement);
    expect(screen.queryByText('Image unavailable')).not.toBeInTheDocument();
    fireEvent.error(replacement);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('starts a fresh bounded attempt when revisiting a previously exhausted source', () => {
    vi.useFakeTimers();
    globalThis.IntersectionObserver = undefined as unknown as typeof IntersectionObserver;
    const { rerender } = render(<PreviewImage src="/a?w=480" alt="Scan" />);
    fireEvent.error(screen.getByAltText('Scan'));
    act(() => vi.advanceTimersByTime(1000));
    fireEvent.error(screen.getByAltText('Scan'));
    act(() => vi.advanceTimersByTime(2000));
    fireEvent.error(screen.getByAltText('Scan'));
    expect(screen.getByText('Image unavailable')).toBeVisible();
    rerender(<PreviewImage src="/b?w=480" alt="Scan" />);
    fireEvent.load(screen.getByAltText('Scan'));
    rerender(<PreviewImage src="/a?w=480" alt="Scan" />);
    const revisited = screen.getByAltText('Scan');
    expect(screen.queryByText('Image unavailable')).not.toBeInTheDocument();
    fireEvent.error(revisited);
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByAltText('Scan')).not.toBe(revisited);
    expect(screen.getByAltText('Scan')).toHaveAttribute('src', '/a?w=480');
  });

});
