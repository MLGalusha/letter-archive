import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
    fullFailed: false,
    fullAdmitted: overrides.fullLoaded ?? false,
    onFullLoad: vi.fn(),
    onFullError: vi.fn(),
    currentSrc: '',
    naturalWidth: null,
    naturalHeight: null,
  };
  mockUseProgressiveImage.mockReturnValue({ ...defaults, ...overrides });
}

afterEach(() => vi.useRealTimers());

describe('ProgressiveImage', () => {
  it.each([false, true])('defers image tiers until near the applicable scrollport (nested=%s)', (nested) => {
    let notify: IntersectionObserverCallback;
    let options: IntersectionObserverInit | undefined;
    const scrollRoot = document.createElement('div');
    scrollRoot.id = 'app-scroll';
    document.body.append(scrollRoot);
    const disconnect = vi.fn();
    const OriginalObserver = globalThis.IntersectionObserver;
    globalThis.IntersectionObserver = class {
      constructor(callback: IntersectionObserverCallback, init?: IntersectionObserverInit) { notify = callback; options = init; }
      observe = vi.fn();
      disconnect = disconnect;
    } as unknown as typeof IntersectionObserver;
    try {
      mockHookReturn();
      const { container, unmount } = render(<div data-image-scroll-root={nested ? '' : undefined}><ProgressiveImage src="/full.jpg" thumbSrc="/thumb.jpg" midSrc="/mid.jpg" alt="Lazy scan" loading="lazy" /></div>);
      expect(options).toMatchObject({ root: nested ? container.firstChild : scrollRoot, rootMargin: '200px' });
      expect(mockUseProgressiveImage).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }));
      expect(screen.getByAltText('Lazy scan')).not.toHaveAttribute('src');
      expect(container.querySelector<HTMLElement>('.progressive-image')?.style.aspectRatio).toBe('0.75');
      act(() => notify([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
      expect(mockUseProgressiveImage).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: true }));
      expect(screen.getByAltText('Lazy scan')).not.toHaveAttribute('src');
      unmount();
      expect(disconnect).toHaveBeenCalled();
    } finally {
      globalThis.IntersectionObserver = OriginalObserver;
      scrollRoot.remove();
    }
  });

  it('keeps decoded orientation available to reader layout before and after full readiness', () => {
    mockHookReturn({ midLoaded: true, naturalWidth: 960, naturalHeight: 640 });
    const { container, rerender } = render(<ProgressiveImage src="/scan?v=one" thumbSrc="/thumb" midSrc="/preview" alt="Oriented scan" preferNaturalAspectRatio aspectRatio={640 / 960} />);
    const wrapper = container.querySelector<HTMLElement>('.progressive-image')!;
    expect(wrapper.style.aspectRatio).toBe('1.5');
    expect(wrapper.style.getPropertyValue('--progressive-image-aspect-ratio')).toBe('1.5');
    mockHookReturn({ fullLoaded: true, naturalWidth: 960, naturalHeight: 640 });
    rerender(<ProgressiveImage src="/scan?v=one" thumbSrc="/thumb" midSrc="/preview" alt="Oriented scan" preferNaturalAspectRatio aspectRatio={640 / 960} />);
    expect(wrapper.style.getPropertyValue('--progressive-image-aspect-ratio')).toBe('1.5');
    mockHookReturn();
    rerender(<ProgressiveImage src="/scan?v=two" thumbSrc="/new-thumb" alt="Updated scan" aspectRatio={0.75} />);
    expect(wrapper.style.getPropertyValue('--progressive-image-aspect-ratio')).toBe('0.75');
  });

  it('preserves intentional display ratios for non-reader callers', () => {
    mockHookReturn({ midLoaded: true, naturalWidth: 960, naturalHeight: 640 });
    const { container } = render(<ProgressiveImage src="/photo" thumbSrc="/thumb" alt="Cropped card" aspectRatio={1} />);
    const wrapper = container.querySelector<HTMLElement>('.progressive-image')!;
    expect(wrapper.style.aspectRatio).toBe('1');
    expect(wrapper.style.getPropertyValue('--progressive-image-aspect-ratio')).toBe('1');
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
  it('shows exhausted background failure only when no useful lower tier exists', () => {
    mockHookReturn({ fullFailed: true });
    const props = { src: '/full', thumbSrc: '/thumb', alt: 'Failed scan' };
    const { rerender } = render(<ProgressiveImage {...props} />);
    expect(screen.getByText('Image unavailable')).toBeVisible();
    expect(screen.getByAltText('Failed scan')).not.toHaveAttribute('src');
    mockHookReturn({ fullFailed: true, thumbLoaded: true, currentSrc: '/thumb' });
    rerender(<ProgressiveImage {...props} />);
    expect(screen.queryByText('Image unavailable')).not.toBeInTheDocument();
  });

  it('retries a preloaded image whose visible request fails without a background loader', () => {
    vi.useFakeTimers();
    mockHookReturn({ fullLoaded: true, currentSrc: '/preloaded?w=800' });
    render(<ProgressiveImage src="/preloaded?w=800" thumbSrc="/preloaded?w=32" alt="Preloaded scan" />);
    const first = screen.getByAltText('Preloaded scan');
    fireEvent.error(first);
    act(() => vi.advanceTimersByTime(1000));
    const second = screen.getByAltText('Preloaded scan');
    expect(second).not.toBe(first);
    expect(second).toHaveAttribute('src', '/preloaded?w=800');
    fireEvent.load(second);
    expect(second).toBeVisible();
    expect(screen.queryByText('Image unavailable')).not.toBeInTheDocument();
  });

  it.each(['thumb', 'mid'] as const)('retries the displayed %s after its background load succeeded while full remains unavailable', (tier) => {
    vi.useFakeTimers();
    const src = tier === 'thumb' ? '/scan?w=32' : '/scan?w=480';
    mockHookReturn({ thumbLoaded: true, midLoaded: tier === 'mid', currentSrc: src });
    const props = { src: '/scan?w=800', thumbSrc: '/scan?w=32', midSrc: '/scan?w=480', alt: 'Lower tier' };
    const { container, rerender } = render(<ProgressiveImage {...props} />);
    const first = container.querySelector('.progressive-image__thumb')!;
    fireEvent.error(first);
    // Success from the hidden layer must not cancel the visible layer's retry.
    fireEvent.load(screen.getByAltText('Lower tier'));
    act(() => vi.advanceTimersByTime(1000));
    const retry = container.querySelector('.progressive-image__thumb')!;
    expect(retry).not.toBe(first);
    expect(retry).toHaveAttribute('src', src);
    fireEvent.load(retry);
    expect(screen.queryByText('Image unavailable')).not.toBeInTheDocument();
    // A later full tier gets its own retry budget, without inheriting this source's attempt.
    mockHookReturn({ thumbLoaded: true, midLoaded: true, fullLoaded: true, currentSrc: props.src });
    rerender(<ProgressiveImage {...props} />);
    const full = screen.getByAltText('Lower tier');
    fireEvent.error(full);
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByAltText('Lower tier')).not.toBe(full);
    expect(screen.getByAltText('Lower tier')).toHaveAttribute('src', props.src);
  });

});
