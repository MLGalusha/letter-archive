import { useRef } from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { usePretextFontSize } from '../usePretextFontSize';

const { prepare, layout } = vi.hoisted(() => ({
  prepare: vi.fn(() => ({})),
  layout: vi.fn(() => ({ lines: [{ width: 200 }] })),
}));
vi.mock('@chenglou/pretext', () => ({ prepareWithSegments: prepare, layoutWithLines: layout }));

const originalResizeObserver = globalThis.ResizeObserver;
afterEach(() => { vi.restoreAllMocks(); globalThis.ResizeObserver = originalResizeObserver; });

it('measures the committed font and reuses its widths when only the container resizes', () => {
  let resize!: ResizeObserverCallback;
  let width = 100;
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width);
  globalThis.ResizeObserver = class {
    constructor(callback: ResizeObserverCallback) { resize = callback; }
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  function Preview({ text }: { text: string }) {
    const container = useRef<HTMLDivElement>(null);
    const fontSize = usePretextFontSize(container, text);
    return <div ref={container}><div className="transcript-text" style={{ fontFamily: 'Georgia' }} /><output>{fontSize}</output></div>;
  }
  const view = render(<Preview text="First text" />);
  expect(prepare).toHaveBeenLastCalledWith('First text', '17.6px Georgia', { whiteSpace: 'pre-wrap' });
  expect(screen.getByRole('status')).toHaveTextContent('0.55rem');
  width = 200;
  act(() => resize([], {} as ResizeObserver));
  expect(screen.getByRole('status')).toHaveTextContent('1.1rem');
  expect(prepare).toHaveBeenCalledTimes(1);
  layout.mockReturnValueOnce({ lines: [{ width: 400 }] });
  view.rerender(<Preview text="Replacement text" />);
  expect(prepare).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('status')).toHaveTextContent('0.55rem');
});
