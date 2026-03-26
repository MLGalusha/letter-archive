import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

const connectionString = process.env.DATABASE_URL || 'postgresql://app:app@localhost:5432/app';

const client = postgres(connectionString, {
  max: 20,
  idle_timeout: 20,
  connect_timeout: 10,
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
