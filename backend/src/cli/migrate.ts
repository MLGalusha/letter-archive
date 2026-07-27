import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db, sql } from '../db/index.js';
import {
  assertMigrationReleaseAllowed,
  type AppliedMigrationEntry,
  type MigrationJournalEntry,
  type MigrationReleaseMode,
} from '../db/migration-release-policy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(__dirname, '../../src/db/migrations');

async function appliedMigrationLedger(): Promise<AppliedMigrationEntry[]> {
  try {
    const rows = await sql<{
      createdAt: string;
      hash: string;
    }[]>`
      SELECT
        hash,
        created_at::text AS "createdAt"
      FROM drizzle.__drizzle_migrations
      ORDER BY created_at ASC, id ASC
    `;
    return rows.map(({ createdAt, hash }, position) => {
      const parsedCreatedAt = Number(createdAt);
      if (!Number.isSafeInteger(parsedCreatedAt) || parsedCreatedAt < 0) {
        throw new Error(
          `Applied migration timestamp is invalid at position ${position}`,
        );
      }
      return {
        createdAt: parsedCreatedAt,
        hash,
      };
    });
  } catch (error) {
    if (
      typeof error === 'object'
      && error !== null
      && 'code' in error
      && error.code === '42P01'
    ) {
      return [];
    }
    throw error;
  }
}

async function migrationJournal(): Promise<MigrationJournalEntry[]> {
  const source = await readFile(
    path.join(migrationsFolder, 'meta', '_journal.json'),
    'utf8',
  );
  const parsed = JSON.parse(source) as {
    entries?: Omit<MigrationJournalEntry, 'hash'>[];
  };
  if (!Array.isArray(parsed.entries)) {
    throw new Error('Migration journal does not contain an entries array');
  }

  return Promise.all(parsed.entries.map(async (entry) => {
    if (typeof entry.tag !== 'string' || entry.tag.length === 0) {
      throw new Error('Migration journal contains an invalid tag');
    }
    const migrationSql = await readFile(
      path.join(migrationsFolder, `${entry.tag}.sql`),
      'utf8',
    );
    return {
      ...entry,
      hash: createHash('sha256').update(migrationSql).digest('hex'),
    };
  }));
}

async function main(): Promise<void> {
  const mode = process.env.MIGRATION_RELEASE_MODE;
  if (mode !== 'automatic' && mode !== 'maintenance') {
    throw new Error(
      'MIGRATION_RELEASE_MODE must be automatic or maintenance',
    );
  }

  const [journal, appliedMigrations] = await Promise.all([
    migrationJournal(),
    appliedMigrationLedger(),
  ]);
  const pending = assertMigrationReleaseAllowed({
    journal,
    appliedMigrations,
    mode: mode as MigrationReleaseMode,
  });

  console.log(
    `Migration release policy accepted ${pending.length} pending migration(s) `
    + `in ${mode} mode`,
  );
  await migrate(db, { migrationsFolder });
  console.log(`Migrations applied from ${migrationsFolder}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
