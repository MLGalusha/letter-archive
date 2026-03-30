import "@testing-library/jest-dom/vitest";

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (!("ResizeObserver" in globalThis)) {
  Object.defineProperty(globalThis, "ResizeObserver", {
    value: MockResizeObserver,
    writable: true,
  });
}

class MockIntersectionObserver {
  constructor(_callback: IntersectionObserverCallback, _options?: IntersectionObserverInit) {}
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (!("IntersectionObserver" in globalThis)) {
  Object.defineProperty(globalThis, "IntersectionObserver", {
    value: MockIntersectionObserver,
    writable: true,
  });
}

// jsdom ships a scrollTo stub that throws "Not implemented", so replace it.
Object.defineProperty(window, "scrollTo", {
  value: () => {},
  writable: true,
  configurable: true,
});

Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
  value: () => ({
    measureText: (text: string) => ({ width: text.length * 8 }),
  }),
  writable: true,
});
