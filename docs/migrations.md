# Database Migrations

## Default Workflow

```
schema.ts → drizzle:generate → drizzle:migrate
```

1. Edit `backend/src/db/schema.ts`
2. Run `npm run drizzle:generate` to create a migration SQL file
3. Run `npm run drizzle:migrate` to apply it

Use generated migrations for ordinary schema changes. A hand-authored migration is
reserved for a reviewed rollout contract that Drizzle cannot express safely—such as
expand/drain compatibility, triggers, or staged legacy behavior. In that case it must:

- be registered explicitly in `meta/_journal.json`;
- stay consistent with `schema.ts`;
- include filesystem validation and a fresh PostgreSQL regression;
- document mixed-version behavior and the later contraction step.

**Never** use `db:push`—it applies changes directly without a migration artifact and
causes drift between local state and the migration journal.

## Command Reference

| Command | What it does | When to use |
|---------|-------------|-------------|
| `npm run drizzle:generate` | Diffs `schema.ts` against the latest snapshot and creates a new `.sql` migration file + snapshot | After editing `schema.ts` |
| `npm run drizzle:migrate` | Runs all unapplied migrations from the journal against the database | After generating, or on fresh DB setup |
| `npm run db:validate-migrations` | Runs filesystem-based validation tests (no DB needed) | Before committing migration changes |
| `npm run db:test-migrations` | Spins up a temporary Postgres container and runs all migrations from scratch | To verify migrations work on a clean database |
| `npm run db:up` / `db:down` | Start/stop the local Postgres container | Local development |

## Journal Structure

Drizzle tracks applied migrations via `backend/src/db/migrations/meta/_journal.json`:

```json
{
  "entries": [
    { "idx": 0, "tag": "0000_serious_clint_barton", ... },
    { "idx": 1, "tag": "0001_aberrant_ender_wiggin", ... }
  ]
}
```

**Rules:**
- `idx` values must be sequential starting from 0 (no gaps, no duplicates)
- `tag` must match a `.sql` file in the migrations directory (e.g. `0001_aberrant_ender_wiggin` → `0001_aberrant_ender_wiggin.sql`)
- Every `.sql` file must have a corresponding journal entry, and vice versa
- Snapshot files in `meta/` are used by `drizzle:generate` to compute diffs — don't delete them

## PostgreSQL Pitfalls

### Enum Type Changes

PostgreSQL enums cannot be altered in-place. To change an enum's values, follow this exact order:

1. Drop constraints referencing the enum
2. Drop column default (it holds a type dependency)
3. Cast column to `text`
4. Drop old enum type
5. Create new enum type
6. Cast column back to new enum
7. Restore default

```sql
-- Example: changing visibility_state enum values
ALTER TABLE "letters" DROP CONSTRAINT IF EXISTS "published_requires_review";
ALTER TABLE "letters" ALTER COLUMN "visibility" DROP DEFAULT;
ALTER TABLE "letters" ALTER COLUMN "visibility" SET DATA TYPE text;
DROP TYPE "public"."visibility_state";
CREATE TYPE "public"."visibility_state" AS ENUM('PUBLISHED', 'HIDDEN');
ALTER TABLE "letters" ALTER COLUMN "visibility" SET DATA TYPE "public"."visibility_state"
  USING "visibility"::"public"."visibility_state";
ALTER TABLE "letters" ALTER COLUMN "visibility" SET DEFAULT 'HIDDEN'::"public"."visibility_state";
```

Skipping any step will produce errors like `cannot drop type because other objects depend on it`.

### Extension Dependencies

Extensions like `pg_trgm` must be created **before** any indexes that use them:

```sql
-- Must come first
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Now this works
CREATE INDEX "idx_name_trgm" ON "table" USING gin ("col" gin_trgm_ops);
```

If the extension creation is in a later migration than the index, fresh databases will fail.

### Duplicate Column Additions

When a reviewed hand-authored rollout migration accompanies generated history, it is
easy to add a column twice. This causes `column already exists` errors on fresh
databases. Search the complete journal first and prove the full migration chain on a
disposable PostgreSQL instance. Do not use `IF NOT EXISTS` to hide unexpected drift.

## Automated Validation

The test suite at `backend/src/db/__tests__/migrations.test.ts` validates migration integrity without needing a database:

- Every SQL file is registered in the journal (catches orphan files)
- Every journal entry has a matching SQL file (catches deleted files)
- Journal indexes are sequential with no gaps or duplicates
- No duplicate `ADD COLUMN` statements across migrations
- `gin_trgm_ops` indexes have a preceding `CREATE EXTENSION pg_trgm`

Run with: `npm run db:validate-migrations`

## CI

Migrations run against a fresh Postgres instance in CI. This catches:

- Orphan SQL files not in the journal (they never execute)
- `db:push` drift (local DB has changes that migration files don't)
- Missing extensions or incorrect ordering
- Duplicate column additions

If CI fails but local works, it almost always means `db:push` was used locally or a migration file isn't registered in the journal.
