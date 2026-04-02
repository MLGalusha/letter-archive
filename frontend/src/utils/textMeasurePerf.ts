/**
 * Dev-only performance instrumentation for text measurement.
 * Tracks prepare() vs resize timing so you can verify Pretext improvements.
 *
 * Usage in browser console:
 *   window.__textMeasurePerf.summary()
 *   window.__textMeasurePerf.entries   // raw data
 *   window.__textMeasurePerf.clear()
 */

type EntryKind = 'prepare' | 'resize';

interface PerfEntry {
  kind: EntryKind;
  durationMs: number;
  timestamp: number;
  label?: string;
}

const MAX_ENTRIES = 200;

const entries: PerfEntry[] = [];

function record(kind: EntryKind, durationMs: number, label?: string) {
  entries.push({ kind, durationMs, timestamp: Date.now(), label });
  if (entries.length > MAX_ENTRIES) entries.shift();
}

export function measurePerf<T>(kind: EntryKind, fn: () => T, label?: string): T {
  const start = performance.now();
  const result = fn();
  record(kind, performance.now() - start, label);
  return result;
}

function avg(nums: number[]): string {
  if (nums.length === 0) return '0ms';
  return (nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(3) + 'ms';
}

function max(nums: number[]): string {
  if (nums.length === 0) return '0ms';
  return Math.max(...nums).toFixed(3) + 'ms';
}

function summary() {
  const prepare = entries.filter(e => e.kind === 'prepare').map(e => e.durationMs);
  const resize = entries.filter(e => e.kind === 'resize').map(e => e.durationMs);
  return {
    prepareCount: prepare.length,
    prepareAvg: avg(prepare),
    prepareMax: max(prepare),
    resizeCount: resize.length,
    resizeAvg: avg(resize),
    resizeMax: max(resize),
  };
}

function clear() {
  entries.length = 0;
}

// Expose on window in dev mode
if (import.meta.env.DEV) {
  (window as any).__textMeasurePerf = { entries, summary, clear };
}
