const BUFFER_SIZE = 200;

export interface ImageLoadEntry {
  url: string;
  tier: 'thumb' | 'mid' | 'full';
  context: string;
  durationMs: number;
  cached: boolean;
  timestamp: number;
}

const buffer: ImageLoadEntry[] = [];
let writeIndex = 0;
let totalEntries = 0;

export function recordImageLoad(entry: Omit<ImageLoadEntry, 'timestamp'>): void {
  const full: ImageLoadEntry = { ...entry, timestamp: Date.now() };
  if (totalEntries < BUFFER_SIZE) {
    buffer.push(full);
  } else {
    buffer[writeIndex % BUFFER_SIZE] = full;
  }
  writeIndex = (writeIndex + 1) % BUFFER_SIZE;
  totalEntries++;
}

function getEntries(): ImageLoadEntry[] {
  return buffer.slice();
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

export interface PerfSummary {
  context: string;
  tier: string;
  count: number;
  p50: number;
  p75: number;
  p95: number;
  cachedPct: number;
}

export function getImagePerfSummary(): PerfSummary[] {
  const entries = getEntries();
  const groups = new Map<string, ImageLoadEntry[]>();

  for (const e of entries) {
    const key = `${e.context}|${e.tier}`;
    const list = groups.get(key);
    if (list) list.push(e);
    else groups.set(key, [e]);
  }

  const summaries: PerfSummary[] = [];
  for (const [key, list] of groups) {
    const [context, tier] = key.split('|');
    const durations = list.map(e => e.durationMs).sort((a, b) => a - b);
    const cached = list.filter(e => e.cached).length;
    summaries.push({
      context,
      tier,
      count: list.length,
      p50: Math.round(percentile(durations, 50)),
      p75: Math.round(percentile(durations, 75)),
      p95: Math.round(percentile(durations, 95)),
      cachedPct: Math.round((cached / list.length) * 100),
    });
  }

  return summaries.sort((a, b) => a.context.localeCompare(b.context) || a.tier.localeCompare(b.tier));
}

export function getRecentEntries(n = 20): ImageLoadEntry[] {
  return getEntries().slice(-n);
}

// ── Beacon telemetry ────────────────────────────────────────

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3002';
const FLUSH_INTERVAL_MS = 60_000;
let lastFlushIndex = 0;

function getUnflushedEntries(): ImageLoadEntry[] {
  const all = getEntries();
  // Only send entries recorded since last flush
  const unflushed = all.filter((e) => e.timestamp > lastFlushIndex);
  return unflushed;
}

function flushToServer() {
  const entries = getUnflushedEntries();
  if (entries.length === 0) return;

  lastFlushIndex = Date.now();

  const payload = JSON.stringify(
    entries.map(({ url, tier, context, durationMs, cached }) => ({
      url, tier, context, durationMs, cached,
    })),
  );

  // Use sendBeacon for reliability during page unload
  if (navigator.sendBeacon) {
    navigator.sendBeacon(
      `${API_BASE_URL}/images/perf`,
      new Blob([payload], { type: 'application/json' }),
    );
  }
}

// Flush on page hide (tab switch, navigation away)
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushToServer();
  });

  // Periodic flush while page is active
  setInterval(() => {
    if (document.visibilityState === 'visible') flushToServer();
  }, FLUSH_INTERVAL_MS);
}

// Expose in dev mode for console inspection
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__imagePerf = {
    getSummary: getImagePerfSummary,
    getRecent: getRecentEntries,
    getAll: getEntries,
    flush: flushToServer,
  };
}
