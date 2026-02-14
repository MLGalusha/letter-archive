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

Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
  value: () => ({
    measureText: (text: string) => ({ width: text.length * 8 }),
  }),
  writable: true,
});
