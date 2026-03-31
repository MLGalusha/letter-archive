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

// Graceful shutdown — close DB connections so the process can exit
function cleanup() {
  client.end({ timeout: 3 }).catch(() => {});
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

export * from './schema.js';
