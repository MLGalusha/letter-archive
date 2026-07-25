# Database Migrations

## Current Protected Workflow

```
schema.ts + reviewed SQL + journal entry → validation → drizzle:migrate
```

1. Edit `backend/src/db/schema.ts`
2. Add the next reviewed SQL migration and register it in
   `src/db/migrations/meta/_journal.json`
3. Run `npm run db:validate-migrations`
4. Run `npm run db:test-migrations` against disposable PostgreSQL
5. Run `npm run drizzle:migrate` to apply it locally

`npm run drizzle:generate` is intentionally guarded and exits without writing files.
The SQL journal and `schema.ts` are current through migration 0055, while Drizzle's
snapshot lineage stops at 0013. In that state `drizzle-kit generate` compares the
current schema with a stale snapshot and can propose DDL for changes that migrations
0014–0055 already made.

Until a dedicated snapshot-baseline repair is completed, every migration must:

- be registered explicitly in `meta/_journal.json`;
- stay consistent with `schema.ts`;
- include filesystem validation and a fresh PostgreSQL regression;
- document mixed-version behavior and the later contraction step.

Do not invoke `npx drizzle-kit generate` directly as a workaround. Re-enabling
generation requires reconstructing a current snapshot in an isolated copy, proving it
emits no unexpected historical SQL, then restoring the package script and this
document together.

**Never** use `db:push`—it applies changes directly without a migration artifact and
causes drift between local state and the migration journal.

## Command Reference

| Command | What it does | When to use |
|---------|-------------|-------------|
| `npm run drizzle:generate` | Refuses to generate while snapshot lineage is stale | Do not bypass; see the protected workflow above |
| `npm run drizzle:migrate` | Runs all unapplied migrations from the journal against the database | After the reviewed migration is validated, or on fresh DB setup |
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
- Snapshot files in `meta/` are used by `drizzle:generate` to compute diffs — don't
  delete or fabricate them. The current lineage ends at 0013 and must be repaired in
  an isolated, reviewed follow-up before generation is restored.

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
