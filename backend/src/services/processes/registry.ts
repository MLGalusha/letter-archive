import { transcriptionProcess } from './transcription.js';
import { metadataProcess } from './metadata.js';
import { entityExtractionProcess } from './entity-extraction.js';
import { extraContentProcess } from './extra-content.js';
import { backgroundWorkerProcess } from './background-worker.js';
import type { ProcessConfig, ProcessKey } from './types.js';
import { ProcessingError } from './types.js';

// ============================================================================
// Process registry — single source of truth for what the admin Processing
// page can see and control. Adding a new process is one entry here.
// ============================================================================

// We intentionally widen the generic when storing configs in the map —
// the routes/runner only need the common surface, and each entry knows
// its own filter shape internally.
type AnyProcessConfig = ProcessConfig<object>;

const registry = new Map<ProcessKey, AnyProcessConfig>();

function register(config: ProcessConfig<object>): void {
  registry.set(config.key, config);
}

register(transcriptionProcess as unknown as AnyProcessConfig);
register(metadataProcess as unknown as AnyProcessConfig);
register(entityExtractionProcess as unknown as AnyProcessConfig);
register(extraContentProcess as unknown as AnyProcessConfig);
register(backgroundWorkerProcess as unknown as AnyProcessConfig);

/**
 * Retrieve a process config by key. Throws a 404 ProcessingError if unknown.
 */
export function getProcess(key: string): AnyProcessConfig {
  const config = registry.get(key as ProcessKey);
  if (!config) {
    throw new ProcessingError(`Unknown process: ${key}`, 404);
  }
  return config;
}

/** All registered processes in `order` ascending. */
export function orderedProcesses(): AnyProcessConfig[] {
  return Array.from(registry.values()).sort((a, b) => a.order - b.order);
}

/** All process keys in order. */
export function allProcessKeys(): ProcessKey[] {
  return orderedProcesses().map(p => p.key);
}
