import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

const connectionString = process.env.DATABASE_URL || 'postgresql://app:app@localhost:5432/app';
const isProduction = process.env.NODE_ENV === 'production';

// The postgres driver ignores ?host= in the URL and passes it to PG as a config param.
// Extract it for the socket option and strip it from the URL.
function parseCloudSqlUrl(url: string): { cleanUrl: string; socketHost?: string } {
  try {
    const parsed = new URL(url);
    const host = parsed.searchParams.get('host');
    if (host?.startsWith('/')) {
      parsed.searchParams.delete('host');
      return { cleanUrl: parsed.toString(), socketHost: host };
    }
  } catch { /* not a valid URL, use as-is */ }
  return { cleanUrl: url };
}

const { cleanUrl, socketHost } = parseCloudSqlUrl(connectionString);

const client = postgres(cleanUrl, {
  max: isProduction ? 10 : 20,
  idle_timeout: isProduction ? 30 : 20,
  connect_timeout: isProduction ? 15 : 10,
  ...(socketHost && { host: socketHost }),
  connection: {
    application_name: 'letter-archive',
  },
  onnotice: () => {},
});

export const sql = client;
export const db = drizzle(client, { schema });

export type Database = typeof db;

let closePromise: Promise<void> | null = null;

/**
 * Close the database pool after the owning process has drained its work.
 *
 * This is deliberately explicit rather than a module-level signal listener:
 * the API must first drain requests, and the worker must keep its execution
 * heartbeat and stage terminal writes available until the active job settles.
 */
export function closeDatabase(): Promise<void> {
  if (!closePromise) {
    closePromise = client.end({ timeout: 3 });
  }
  return closePromise;
}

export * from './schema.js';
