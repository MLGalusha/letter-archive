import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProgressiveImage } from '../ProgressiveImage';

// Mock the hook so we control what loading state the component sees
vi.mock('../../../hooks/useProgressiveImage', () => ({
  useProgressiveImage: vi.fn(),
}));

import { useProgressiveImage } from '../../../hooks/useProgressiveImage';
const mockUseProgressiveImage = vi.mocked(useProgressiveImage);

function mockHookReturn(overrides: Partial<ReturnType<typeof useProgressiveImage>> = {}) {
  const defaults = {
    thumbLoaded: false,
    midLoaded: false,
    fullLoaded: false,
    currentSrc: '',
    naturalWidth: null,
    naturalHeight: null,
  };
  mockUseProgressiveImage.mockReturnValue({ ...defaults, ...overrides });
}

describe('ProgressiveImage', () => {
  it('defers every image tier and the DOM source until a lazy image is near the viewport', () => {
    let notify: IntersectionObserverCallback;
    const disconnect = vi.fn();
    const OriginalObserver = globalThis.IntersectionObserver;
    globalThis.IntersectionObserver = class {
      constructor(callback: IntersectionObserverCallback) { notify = callback; }
      observe = vi.fn();
      disconnect = disconnect;
    } as unknown as typeof IntersectionObserver;
    try {
      mockHookReturn();
      const { unmount } = render(<ProgressiveImage src="/full.jpg" thumbSrc="/thumb.jpg" midSrc="/mid.jpg" alt="Lazy scan" loading="lazy" />);
      expect(mockUseProgressiveImage).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }));
      expect(screen.getByAltText('Lazy scan')).not.toHaveAttribute('src');
      act(() => notify([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
      expect(mockUseProgressiveImage).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: true }));
      expect(screen.getByAltText('Lazy scan')).toHaveAttribute('src', '/full.jpg');
      unmount();
      expect(disconnect).toHaveBeenCalled();
    } finally {
      globalThis.IntersectionObserver = OriginalObserver;
    }
  });

  it('renders an <img> element with the correct src and alt', () => {
    mockHookReturn({ fullLoaded: true, currentSrc: '/images/full.jpg' });

    render(
      <ProgressiveImage
        src="/images/full.jpg"
        thumbSrc="/images/thumb.jpg"
        alt="A handwritten letter"
      />,
    );

    const img = screen.getByAltText('A handwritten letter');
    expect(img).toBeInTheDocument();
    expect(img.tagName).toBe('IMG');
    expect(img).toHaveAttribute('src', '/images/full.jpg');
  });

  it('shows placeholder/thumb layer when full image has not loaded yet', () => {
    mockHookReturn({ thumbLoaded: true, currentSrc: '/images/thumb.jpg' });

    const { container } = render(
      <ProgressiveImage
        src="/images/full.jpg"
        thumbSrc="/images/thumb.jpg"
        alt="Letter page"
      />,
    );

    // Placeholder img should be present (aria-hidden, alt="")
    const thumbImg = container.querySelector('.progressive-image__thumb');
    expect(thumbImg).toBeInTheDocument();
    expect(thumbImg).toHaveAttribute('src', '/images/thumb.jpg');

    // Full image should have the loading class (opacity 0)
    const fullImg = container.querySelector('.progressive-image__full');
    expect(fullImg).toHaveClass('progressive-image__full--loading');
  });

  it('shows "Image unavailable" fallback when the main img fires onError', () => {
    mockHookReturn({ fullLoaded: true, currentSrc: '/images/full.jpg' });

    const { container } = render(
      <ProgressiveImage
        src="/images/full.jpg"
        thumbSrc="/images/thumb.jpg"
        alt="Letter page"
      />,
    );

    const fullImg = container.querySelector('.progressive-image__full') as HTMLImageElement;
    fireEvent.error(fullImg);

    expect(screen.getByText('Image unavailable')).toBeInTheDocument();
  });

  it('hides the broken image when error fallback is shown', () => {
    mockHookReturn({ fullLoaded: true, currentSrc: '/images/full.jpg' });

    const { container } = render(
      <ProgressiveImage
        src="/images/full.jpg"
        thumbSrc="/images/thumb.jpg"
        alt="Letter page"
      />,
    );

    const fullImg = container.querySelector('.progressive-image__full') as HTMLImageElement;
    fireEvent.error(fullImg);

    // The main img should be hidden
    expect(fullImg).not.toBeVisible();
  });

  it('resets error state when src prop changes', () => {
    mockHookReturn({ fullLoaded: true, currentSrc: '/images/full.jpg' });

    const { container, rerender } = render(
      <ProgressiveImage
        src="/images/full.jpg"
        thumbSrc="/images/thumb.jpg"
        alt="Letter page"
      />,
    );

    const fullImg = container.querySelector('.progressive-image__full') as HTMLImageElement;
    fireEvent.error(fullImg);
    expect(screen.getByText('Image unavailable')).toBeInTheDocument();

    // Re-render with new src
    mockHookReturn({ fullLoaded: true, currentSrc: '/images/full-v2.jpg' });
    rerender(
      <ProgressiveImage
        src="/images/full-v2.jpg"
        thumbSrc="/images/thumb.jpg"
        alt="Letter page"
      />,
    );

    expect(screen.queryByText('Image unavailable')).not.toBeInTheDocument();
    const updatedImg = container.querySelector('.progressive-image__full') as HTMLImageElement;
    expect(updatedImg).toBeVisible();
  });

  it('passes through className prop to container', () => {
    mockHookReturn({ fullLoaded: true, currentSrc: '/images/full.jpg' });

    const { container } = render(
      <ProgressiveImage
        src="/images/full.jpg"
        thumbSrc="/images/thumb.jpg"
        alt="Letter"
        className="my-custom-class"
      />,
    );

    const wrapper = container.querySelector('.progressive-image');
    expect(wrapper).toHaveClass('my-custom-class');
  });

  it('renders with aspectRatio style when provided', () => {
    // fullLoaded = false so aspectRatio style is applied
    mockHookReturn({ thumbLoaded: true, currentSrc: '/images/thumb.jpg' });

    const { container } = render(
      <ProgressiveImage
        src="/images/full.jpg"
        thumbSrc="/images/thumb.jpg"
        alt="Letter"
        aspectRatio={0.75}
      />,
    );

    const wrapper = container.querySelector('.progressive-image') as HTMLElement;
    expect(wrapper.style.aspectRatio).toBe('0.75');
  });
});
