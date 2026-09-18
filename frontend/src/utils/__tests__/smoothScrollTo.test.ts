import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { smoothScrollToY } from '../smoothScrollTo';

let frames: Map<number, FrameRequestCallback>;
let frameId: number;
let now: number;
function advance(ms: number) {
  now += ms;
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach(frame => frame(now));
}
beforeEach(() => {
  frames = new Map(); frameId = 0; now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => { frames.set(++frameId, cb); return frameId; });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id); });
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
  vi.spyOn(window, 'scrollTo').mockImplementation((_x, y) => { Object.defineProperty(window, 'scrollY', { configurable: true, value: y }); });
  Object.defineProperty(window, 'scrollY', { configurable: true, value: 2000 });
  vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(5000);
  vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(800);
});
afterEach(() => { window.dispatchEvent(new Event('wheel')); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('gives control back on user input and finishes exactly once', () => {
  const onFinish = vi.fn();
  const cancel = smoothScrollToY(200, { onFinish });
  advance(100);
  const interrupted = window.scrollY;
  window.dispatchEvent(new Event('wheel'));
  advance(1000);
  expect(window.scrollY).toBe(interrupted);
  cancel();
  expect(onFinish.mock.calls).toEqual([[true]]);
});

it('supersedes the old action and late cancellation cannot finish twice', () => {
  const first = vi.fn(), second = vi.fn();
  smoothScrollToY(200, { onFinish: first });
  advance(100);
  const cancel = smoothScrollToY(900, { onFinish: second });
  advance(1000);
  cancel();
  expect(window.scrollY).toBe(900);
  expect(first.mock.calls).toEqual([[true]]);
  expect(second.mock.calls).toEqual([[false]]);
});

it.each(['touchstart', 'pointerdown', 'pagehide'])('cancels on %s without preventing the input', type => {
  const onFinish = vi.fn();
  smoothScrollToY(0, { onFinish });
  const event = new Event(type, { cancelable: true });
  window.dispatchEvent(event);
  advance(1000);
  expect(onFinish).toHaveBeenCalledWith(true);
  expect(window.scrollY).toBe(2000);
  expect(event.defaultPrevented).toBe(false);
});

it('cancels for keyboard navigation', () => {
  const onFinish = vi.fn();
  smoothScrollToY(0, { onFinish });
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
  advance(1000);
  expect(onFinish).toHaveBeenCalledWith(true);
  expect(window.scrollY).toBe(2000);
});

it('clamps the destination and honors reduced motion without queued frames', () => {
  vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList);
  const onFinish = vi.fn();
  const cancel = smoothScrollToY(9999, { onFinish });
  expect(window.scrollY).toBe(4200);
  expect(frames.size).toBe(0);
  cancel();
  expect(onFinish.mock.calls).toEqual([[false]]);
});
