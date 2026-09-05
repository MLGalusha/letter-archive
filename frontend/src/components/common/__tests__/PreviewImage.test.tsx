import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PreviewImage } from '../PreviewImage';

const OriginalObserver = globalThis.IntersectionObserver;
afterEach(() => { globalThis.IntersectionObserver = OriginalObserver; });

describe('PreviewImage', () => {
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
    fireEvent.error(img);
    expect(screen.getByText('Image unavailable')).toBeVisible();
    expect(img).not.toBeVisible();
    rerender(<PreviewImage src="/replacement" alt="Scan" />);
    expect(img).toHaveAttribute('src', '/replacement');
    expect(img).toBeVisible();
    expect(screen.queryByText('Image unavailable')).not.toBeInTheDocument();
  });
});
