import { startupTiming } from './utils/startup-timing.js';

// Keep this entry free of application imports so their evaluation is included.
startupTiming.markBootstrap();
// Do not catch: import/startup failures retain Node's nonzero termination.
await import('./index.js');
