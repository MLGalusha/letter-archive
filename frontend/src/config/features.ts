/**
 * The layout benchmark reads local immutable artifacts and is hidden from the
 * hosted admin by default. An operator who deliberately enables the backend
 * can opt the production frontend in at build time with the matching Vite flag.
 */
export const layoutBenchmarkEnabled = (
  import.meta.env.DEV
  || import.meta.env.VITE_LAYOUT_BENCHMARK_ENABLED === 'true'
);
