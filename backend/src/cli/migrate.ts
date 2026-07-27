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

function isPreflightOnly(): boolean {
  const argumentsAfterScript = process.argv.slice(2);
  const unexpected = argumentsAfterScript.filter(
    (argument) => argument !== '--preflight',
  );
  if (unexpected.length > 0) {
    throw new Error(
      `Unsupported migration argument(s): ${unexpected.join(', ')}`,
    );
  }
  return argumentsAfterScript.includes('--preflight');
}

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

async function assertMigrationDatabasePrivileges(): Promise<void> {
  const [privileges] = await sql<{
    canCreateSchema: boolean;
    canCreateInDrizzle: boolean;
    canCreateInPublic: boolean;
    canWriteLedger: boolean;
  }[]>`
    SELECT
      has_database_privilege(
        current_user,
        current_database(),
        'CREATE'
      ) AS "canCreateSchema",
      CASE
        WHEN to_regnamespace('drizzle') IS NULL THEN true
        ELSE has_schema_privilege(
          current_user,
          'drizzle',
          'USAGE, CREATE'
        )
      END AS "canCreateInDrizzle",
      has_schema_privilege(
        current_user,
        'public',
        'USAGE, CREATE'
      ) AS "canCreateInPublic",
      CASE
        WHEN to_regclass('drizzle.__drizzle_migrations') IS NULL THEN true
        ELSE has_table_privilege(
          current_user,
          'drizzle.__drizzle_migrations',
          'SELECT, INSERT'
        )
      END AS "canWriteLedger"
  `;
  const missingPrivileges = [
    !privileges?.canCreateSchema && 'CREATE on the current database',
    !privileges?.canCreateInDrizzle && 'USAGE/CREATE on schema drizzle',
    !privileges?.canCreateInPublic && 'USAGE/CREATE on schema public',
    !privileges?.canWriteLedger
      && 'SELECT/INSERT on drizzle.__drizzle_migrations',
  ].filter((value): value is string => Boolean(value));
  if (missingPrivileges.length > 0) {
    throw new Error(
      'Migration database role is missing: '
      + missingPrivileges.join(', '),
    );
  }

  const unownedObjects = await sql<{
    objectIdentity: string;
  }[]>`
    WITH migration_objects AS (
      SELECT
        'relation ' || format('%I.%I', namespace.nspname, class.relname)
          AS object_identity,
        class.relowner AS owner_oid
      FROM pg_class AS class
      JOIN pg_namespace AS namespace
        ON namespace.oid = class.relnamespace
      WHERE namespace.nspname IN ('public', 'drizzle')
        AND class.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
        AND NOT EXISTS (
          SELECT 1
          FROM pg_depend AS dependency
          WHERE dependency.classid = 'pg_class'::regclass
            AND dependency.objid = class.oid
            AND dependency.deptype = 'e'
        )

      UNION ALL

      SELECT
        'type ' || format('%I.%I', namespace.nspname, type.typname),
        type.typowner
      FROM pg_type AS type
      JOIN pg_namespace AS namespace
        ON namespace.oid = type.typnamespace
      WHERE namespace.nspname IN ('public', 'drizzle')
        AND type.typtype IN ('d', 'e')
        AND NOT EXISTS (
          SELECT 1
          FROM pg_depend AS dependency
          WHERE dependency.classid = 'pg_type'::regclass
            AND dependency.objid = type.oid
            AND dependency.deptype = 'e'
        )

      UNION ALL

      SELECT
        'function ' || procedure.oid::regprocedure::text,
        procedure.proowner
      FROM pg_proc AS procedure
      JOIN pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
      WHERE namespace.nspname IN ('public', 'drizzle')
        AND NOT EXISTS (
          SELECT 1
          FROM pg_depend AS dependency
          WHERE dependency.classid = 'pg_proc'::regclass
            AND dependency.objid = procedure.oid
            AND dependency.deptype = 'e'
        )
    )
    SELECT object_identity AS "objectIdentity"
    FROM migration_objects
    WHERE NOT pg_has_role(current_user, owner_oid, 'USAGE')
    ORDER BY object_identity
  `;
  if (unownedObjects.length > 0) {
    throw new Error(
      'Migration database role does not own migration-managed objects: '
      + unownedObjects.map(({ objectIdentity }) => objectIdentity).join(', '),
    );
  }

  // Drizzle performs this statement before reading or applying its ledger.
  // The explicit privilege and ownership checks above also prove its ledger
  // insert and pending ALTER/CREATE authority without mutating application data.
  await sql`CREATE SCHEMA IF NOT EXISTS drizzle`;
}

async function main(): Promise<void> {
  const preflightOnly = isPreflightOnly();
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
  await assertMigrationDatabasePrivileges();
  if (preflightOnly) {
    console.log('Migration preflight completed without applying migrations');
    return;
  }
  await migrate(db, { migrationsFolder });
  console.log(`Migrations applied from ${migrationsFolder}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
