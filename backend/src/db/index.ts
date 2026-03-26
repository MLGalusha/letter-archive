import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

const connectionString = process.env.DATABASE_URL || 'postgresql://app:app@localhost:5432/app';
const isProduction = process.env.NODE_ENV === 'production';

const client = postgres(connectionString, {
  // Cloud SQL basic tier allows ~100 total connections.
  // With max 5 API instances + 1 worker, keep per-instance pool modest.
  max: isProduction ? 10 : 20,
  idle_timeout: isProduction ? 30 : 20,
  connect_timeout: isProduction ? 15 : 10,
  // Cloud SQL connections via Unix socket can be slower to establish
  connection: {
    application_name: 'letter-archive',
  },
  onnotice: () => {},
});

export const sql = client;
export const db = drizzle(client, { schema });

export type Database = typeof db;

// Graceful shutdown — close DB connections so the process can exit
function cleanup() {
  client.end({ timeout: 3 }).catch(() => {});
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

export * from './schema.js';
