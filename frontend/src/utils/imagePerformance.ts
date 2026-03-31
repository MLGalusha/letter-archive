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

// Expose in dev mode for console inspection
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__imagePerf = {
    getSummary: getImagePerfSummary,
    getRecent: getRecentEntries,
    getAll: getEntries,
  };
}
