import { act, createEvent, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CardCarousel from '../CardCarousel';
import ShowcaseCard from '../ShowcaseCard';

const slides = [<a key="a" href="/one">One</a>, <a key="b" href="/two">Two</a>];
beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 300 });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: function(this: HTMLElement, options: ScrollToOptions) {
    this.scrollLeft = Number(options.left ?? 0); this.dispatchEvent(new Event('scrollend'));
  } });
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('CardCarousel', () => {
  it('renders each item once, with no autoplay and only the current slide interactive', () => {
    vi.useFakeTimers();
    const { container } = render(<CardCarousel label="Highlights">{slides}</CardCarousel>);
    expect(container.querySelectorAll('a')).toHaveLength(2);
    expect(container.querySelectorAll('.card-carousel-slide')[1]).toHaveAttribute('inert');
    act(() => vi.advanceTimersByTime(60000));
    expect(screen.getByLabelText('Slide 1')).toHaveAttribute('aria-current', 'true');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('supports bounded keyboard navigation and dots, and releases focus restrictions on desktop', () => {
    const view = render(<CardCarousel label="Highlights">{slides}</CardCarousel>);
    const first = screen.getByLabelText('Slide 1');
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(screen.getByLabelText('Slide 2')).toHaveAttribute('aria-current', 'true');
    expect(screen.getByLabelText('Slide 2')).toHaveFocus();
    fireEvent.keyDown(screen.getByLabelText('Slide 2'), { key: 'ArrowRight' });
    expect(screen.getByLabelText('Slide 2')).toHaveAttribute('aria-current', 'true');
    view.rerender(<CardCarousel label="Highlights" layout="static">{slides}</CardCarousel>);
    expect(view.container.querySelector('[inert]')).toBeNull();
    view.rerender(<CardCarousel label="Highlights">{slides}</CardCarousel>);
    expect(screen.getByLabelText('Slide 2')).toHaveAttribute('aria-current', 'true');
  });
  it('keeps selected identity when items reorder and recovers when it disappears', () => {
    const view = render(<CardCarousel label="Highlights">{slides}</CardCarousel>);
    fireEvent.click(screen.getByLabelText('Slide 2'));
    view.rerender(<CardCarousel label="Highlights">{[slides[1], slides[0]]}</CardCarousel>);
    expect(screen.getByLabelText('Slide 1')).toHaveAttribute('aria-current', 'true');
    view.rerender(<CardCarousel label="Highlights">{[slides[0], <div key="new">New</div>]}</CardCarousel>);
    expect(screen.getByLabelText('Slide 1')).toHaveAttribute('aria-current', 'true');
  });
  it('does not intercept native touch, wheel, or pinch scrolling', () => {
    const { container } = render(<CardCarousel label="Highlights">{slides}</CardCarousel>);
    const viewport = container.querySelector('.card-carousel-viewport')!;
    for (const event of [createEvent.touchMove(viewport, { cancelable: true, touches: [{ clientX: 100, clientY: 100 }] }),
      createEvent.wheel(viewport, { deltaX: 10, cancelable: true }), createEvent.wheel(viewport, { deltaY: 100, ctrlKey: true, cancelable: true })]) {
      fireEvent(viewport, event); expect(event.defaultPrevented).toBe(false);
    }
  });
  it('renders zero or one item without carousel controls', () => {
    const view = render(<CardCarousel label="Highlights">{[null, false]}</CardCarousel>);
    expect(view.container).toBeEmptyDOMElement();
    view.rerender(<CardCarousel label="Highlights">{[slides[0]]}</CardCarousel>);
    expect(screen.queryByRole('button')).toBeNull();
    view.rerender(<CardCarousel label="Highlights">{slides}</CardCarousel>);
    fireEvent.click(screen.getByLabelText('Slide 2'));
    expect(screen.getByLabelText('Slide 2')).toHaveAttribute('aria-current', 'true');
  });
  it('keeps inner scan selection when switching between mobile and desktop', () => {
    const items = ['one', 'two'].map(id => ({ letterId: id, imageId: id, imageUrl: '', label: id,
      peopleLine: '', date: '', hook: '', mediaType: 'photo' as const }));
    const contents = [<ShowcaseCard key="gallery" items={items} onNavigate={vi.fn()} />, <div key="other">Other</div>];
    const view = render(<CardCarousel label="Highlights">{contents}</CardCarousel>);
    fireEvent.click(screen.getByLabelText('Next'));
    expect(screen.getByText('2/2')).toBeInTheDocument();
    view.rerender(<CardCarousel label="Highlights" layout="static">{contents}</CardCarousel>);
    view.rerender(<CardCarousel label="Highlights">{contents}</CardCarousel>);
    expect(screen.getByText('2/2')).toBeInTheDocument();
    expect(view.container.querySelectorAll('.cd-highlight-card')).toHaveLength(1);
  });
});
