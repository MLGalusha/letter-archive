import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

const connectionString = process.env.DATABASE_URL || 'postgresql://app:app@localhost:5432/app';

const client = postgres(connectionString);

export const db = drizzle(client, { schema });

export type Database = typeof db;

export * from './schema.js';
