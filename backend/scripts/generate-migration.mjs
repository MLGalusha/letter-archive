const message = [
  'Migration generation is temporarily disabled.',
  '',
  'The SQL journal is current through migration 0055, but Drizzle snapshot',
  'lineage stops at 0013. Running drizzle-kit generate would diff the current',
  'schema against that stale snapshot and can propose duplicate historical DDL.',
  '',
  'Follow ../docs/migrations.md for the reviewed hand-authored workflow. Restore',
  'generation only after a dedicated snapshot-baseline repair proves that the',
  'current schema produces no unexpected SQL.',
].join('\n');

console.error(message);
process.exitCode = 1;
