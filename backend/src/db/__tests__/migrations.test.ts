import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(__dirname, "..", "migrations");
const JOURNAL_PATH = join(MIGRATIONS_DIR, "meta", "_journal.json");

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

interface Journal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

function readJournal(): Journal {
  return JSON.parse(readFileSync(JOURNAL_PATH, "utf-8"));
}

function listSqlFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => f.replace(".sql", ""));
}

function readMigrationSql(tag: string): string {
  return readFileSync(join(MIGRATIONS_DIR, `${tag}.sql`), "utf-8");
}

describe("migration validation", () => {
  it("every SQL file is registered in the journal", () => {
    const journal = readJournal();
    const journalTags = new Set(journal.entries.map((e) => e.tag));
    const sqlFiles = listSqlFiles();

    const orphans = sqlFiles.filter((f) => !journalTags.has(f));
    expect(orphans, `Orphan SQL files not in journal: ${orphans.join(", ")}`).toEqual([]);
  });

  it("every journal entry has a matching SQL file", () => {
    const journal = readJournal();
    const sqlFiles = new Set(listSqlFiles());

    const missing = journal.entries
      .filter((e) => !sqlFiles.has(e.tag))
      .map((e) => e.tag);
    expect(missing, `Journal entries missing SQL files: ${missing.join(", ")}`).toEqual([]);
  });

  it("journal indexes are sequential starting from 0", () => {
    const journal = readJournal();
    const indexes = journal.entries.map((e) => e.idx);

    for (let i = 0; i < indexes.length; i++) {
      expect(indexes[i], `Expected idx ${i} but found ${indexes[i]} at position ${i}`).toBe(i);
    }

    const duplicates = indexes.filter((idx, i) => indexes.indexOf(idx) !== i);
    expect(duplicates, `Duplicate journal indexes: ${duplicates.join(", ")}`).toEqual([]);
  });

  it("no duplicate column additions across migrations", () => {
    const journal = readJournal();
    const addColumnPattern = /ALTER\s+TABLE\s+"?(\w+)"?\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?/gi;

    const seen = new Map<string, string>(); // "table.column" -> migration tag
    const duplicates: string[] = [];

    for (const entry of journal.entries) {
      const sql = readMigrationSql(entry.tag);
      let match: RegExpExecArray | null;

      while ((match = addColumnPattern.exec(sql)) !== null) {
        const key = `${match[1].toLowerCase()}.${match[2].toLowerCase()}`;
        const existingTag = seen.get(key);

        // Skip IF NOT EXISTS — those are intentionally safe
        if (match[0].toUpperCase().includes("IF NOT EXISTS")) continue;

        if (existingTag) {
          duplicates.push(`${key} added in both ${existingTag} and ${entry.tag}`);
        } else {
          seen.set(key, entry.tag);
        }
      }
    }

    expect(
      duplicates,
      `Duplicate column additions:\n${duplicates.join("\n")}`
    ).toEqual([]);
  });

  it("gin_trgm_ops indexes have a preceding CREATE EXTENSION pg_trgm", () => {
    const journal = readJournal();

    let extensionCreatedByIdx = -1;
    const trgmIndexes: { tag: string; idx: number; line: string }[] = [];

    for (const entry of journal.entries) {
      const sql = readMigrationSql(entry.tag);

      if (/CREATE\s+EXTENSION\s+(?:IF\s+NOT\s+EXISTS\s+)?pg_trgm/i.test(sql)) {
        extensionCreatedByIdx = entry.idx;
      }

      const lines = sql.split("\n");
      for (const line of lines) {
        if (/gin_trgm_ops/i.test(line)) {
          trgmIndexes.push({ tag: entry.tag, idx: entry.idx, line: line.trim() });
        }
      }
    }

    if (trgmIndexes.length === 0) return; // No trgm indexes, nothing to check

    expect(
      extensionCreatedByIdx,
      "gin_trgm_ops indexes found but CREATE EXTENSION pg_trgm is missing"
    ).toBeGreaterThanOrEqual(0);

    for (const idx of trgmIndexes) {
      expect(
        extensionCreatedByIdx,
        `gin_trgm_ops index in ${idx.tag} (idx ${idx.idx}) but pg_trgm extension created later at idx ${extensionCreatedByIdx}`
      ).toBeLessThanOrEqual(idx.idx);
    }
  });

  it("guards legacy entity JSON array expansion against malformed shapes", () => {
    const sql = readMigrationSql("0051_add_entity_extraction_commit_boundary");
    const expansions = sql.match(/jsonb_array_elements\s*\(/g) ?? [];
    const guardedExpansions = sql.match(
      /jsonb_array_elements\s*\(\s*CASE\s+WHEN\s+jsonb_typeof\(/g,
    ) ?? [];
    const unsafeCoalescedExpansions = sql.match(
      /jsonb_array_elements\s*\(\s*COALESCE/g,
    ) ?? [];

    expect(expansions.length).toBeGreaterThanOrEqual(5);
    expect(guardedExpansions).toHaveLength(expansions.length);
    expect(unsafeCoalescedExpansions).toHaveLength(0);
  });

  it("makes entity extraction ownership an expand-and-drain boundary", () => {
    const sql = readMigrationSql("0051_add_entity_extraction_commit_boundary");

    expect(sql).toContain('ADD CONSTRAINT "entity_extraction_owner_shape"');
    expect(sql).toContain('CREATE TRIGGER entity_extraction_status_transition_guard');
    expect(sql).toContain('entity_extraction_running_requires_owner');
    expect(sql).toContain('entity_extraction_running_owner_cannot_be_stripped');
    expect(sql).toContain('entity_extraction_terminal_requires_owner_reconciliation');

    for (const trigger of [
      "legacy_letter_person_extraction_revision",
      "legacy_letter_place_extraction_revision",
      "legacy_person_relationship_extraction_revision",
      "legacy_review_queue_extraction_revision",
    ]) {
      expect(sql).toContain(`CREATE TRIGGER ${trigger}`);
    }

    expect(sql).toContain("commit_legacy_entity_extraction_projection");
    expect(sql).toContain("discard_legacy_entity_extraction_projection");
    expect(sql).toMatch(
      /OLD\.entity_extraction_status = 'RUNNING'[\s\S]*?OLD\.entity_extraction_run_id IS NULL[\s\S]*?NEW\.entity_extraction_status = 'SUCCESS'[\s\S]*?commit_legacy_entity_extraction_projection/,
    );
    expect(sql).toMatch(
      /NEW\.entity_extraction_status <> 'RUNNING'[\s\S]*?NEW\.entity_extraction_status <> 'SUCCESS'[\s\S]*?discard_legacy_entity_extraction_projection/,
    );
  });

  it("adds nullable, unbackfilled worker execution ownership as one complete tuple", () => {
    const sql = readMigrationSql("0052_add_worker_execution_lease");

    expect(sql).toContain(
      'ADD COLUMN "execution_token" uuid',
    );
    expect(sql).toContain(
      'ADD COLUMN "execution_lease_expires_at" timestamp(3) with time zone',
    );
    expect(sql).toMatch(
      /ADD CONSTRAINT "worker_execution_lease_shape"[\s\S]*\("execution_token" IS NULL\)\s*=\s*\("execution_lease_expires_at" IS NULL\)/,
    );
    expect(sql).toContain(
      'INSERT INTO "worker_state" ("id")',
    );
    expect(sql).toContain('ON CONFLICT DO NOTHING');
    expect(sql).not.toMatch(/\bUPDATE\s+"worker_state"\b/i);
    expect(sql).not.toMatch(/\bCREATE\s+(?:UNIQUE\s+)?INDEX\b/i);
    expect(sql).not.toMatch(/DEFAULT\s+gen_random_uuid/i);
  });

  it("orders entity extraction liveness after the ownership rollout boundaries", () => {
    const journal = readJournal();
    const commitBoundary = journal.entries.find(
      (entry) => entry.tag === "0051_add_entity_extraction_commit_boundary",
    );
    const workerLease = journal.entries.find(
      (entry) => entry.tag === "0052_add_worker_execution_lease",
    );
    const entityLiveness = journal.entries.find(
      (entry) => entry.tag === "0053_add_entity_extraction_liveness",
    );

    expect(commitBoundary).toBeDefined();
    expect(workerLease).toBeDefined();
    expect(entityLiveness).toBeDefined();
    expect(entityLiveness!.idx).toBe(workerLease!.idx + 1);
    expect(entityLiveness!.idx).toBeGreaterThan(commitBoundary!.idx);
    expect(entityLiveness!.breakpoints).toBe(true);
  });

  it("adds entity extraction liveness as an expand-only rollout-safe tuple", () => {
    const sql = readMigrationSql("0053_add_entity_extraction_liveness");

    expect(sql).toContain(
      `CREATE TYPE "public"."entity_extraction_claim_kind" AS ENUM ('QUEUED', 'REQUESTED')`,
    );

    for (const column of [
      '"entity_extraction_lease_expires_at" timestamp(3) with time zone',
      '"entity_extraction_lease_run_id" uuid',
      '"entity_extraction_claim_kind" "entity_extraction_claim_kind"',
    ]) {
      expect(sql).toContain(`ALTER TABLE "letters" ADD COLUMN ${column}`);
      expect(sql).not.toMatch(
        new RegExp(
          `ADD COLUMN ${column.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^;]*(?:NOT NULL|DEFAULT)`,
          "i",
        ),
      );
    }

    expect(sql).not.toMatch(/\bUPDATE\s+"letters"\b/i);
    expect(sql).not.toMatch(/\bALTER\s+COLUMN\b/i);
    expect(sql).not.toMatch(/\bVALIDATE\s+CONSTRAINT\b/i);

    const tupleConstraint = sql.match(
      /ADD CONSTRAINT "entity_extraction_lease_metadata_valid"([\s\S]*?)NOT VALID;/,
    )?.[1];
    expect(tupleConstraint).toBeDefined();
    expect(tupleConstraint).toMatch(
      /\("entity_extraction_lease_expires_at" IS NULL\)\s*=\s*\("entity_extraction_lease_run_id" IS NULL\)/,
    );
    expect(tupleConstraint).toMatch(
      /\("entity_extraction_lease_expires_at" IS NULL\)\s*=\s*\("entity_extraction_claim_kind" IS NULL\)/,
    );

    // Keep the 0051 rolling-deploy shapes valid: an older binary may own a run
    // without liveness metadata or terminate it while leaving metadata residue.
    expect(tupleConstraint).not.toContain('"entity_extraction_status"');
    expect(tupleConstraint).not.toContain('"entity_extraction_run_id"');

    expect(sql).toMatch(
      /CREATE INDEX "idx_letters_entity_extraction_lease_expires_at"[\s\S]*ON "letters" \("entity_extraction_lease_expires_at"\)[\s\S]*WHERE "entity_extraction_status" = 'RUNNING'[\s\S]*AND "entity_extraction_lease_expires_at" IS NOT NULL/,
    );
  });

  it("adds page, version, and profile source epochs without inventing legacy profile provenance", () => {
    const journal = readJournal();
    const entityLiveness = journal.entries.find(
      (entry) => entry.tag === "0053_add_entity_extraction_liveness",
    );
    const sourceRevisions = journal.entries.find(
      (entry) => entry.tag === "0054_add_page_source_revisions",
    );
    const sql = readMigrationSql("0054_add_page_source_revisions");

    expect(sourceRevisions).toBeDefined();
    expect(sourceRevisions!.idx).toBe(entityLiveness!.idx + 1);
    expect(sourceRevisions!.breakpoints).toBe(true);
    expect(sql).toContain(
      'ADD COLUMN "profile_revision" integer DEFAULT 0 NOT NULL',
    );
    expect(sql).toContain(
      'ADD COLUMN "profile_source_fingerprint" text',
    );
    expect(sql).toContain(
      'ADD COLUMN "primary_source_revision" integer DEFAULT 0 NOT NULL',
    );
    expect(sql.match(
      /ALTER TABLE "letter_versions"\s+ADD COLUMN "primary_source_revision" integer DEFAULT 0 NOT NULL/g,
    )).toHaveLength(1);
    expect(sql).toContain(
      'ADD CONSTRAINT "collection_profile_revision_nonnegative"',
    );
    expect(sql).toContain(
      'ADD CONSTRAINT "collection_profile_source_fingerprint_valid"',
    );
    expect(sql).toContain(
      'ADD CONSTRAINT "primary_source_revision_nonnegative"',
    );
    expect(sql).toContain(
      'ADD CONSTRAINT "letter_version_primary_source_revision_nonnegative"',
    );
    expect(sql).toContain(
      'ADD CONSTRAINT "collections_highlight_image_id_letter_pages_id_fk"',
    );
    expect(sql).toMatch(
      /FOREIGN KEY \("highlight_image_id"\)[\s\S]*REFERENCES "public"\."letter_pages"\("id"\)[\s\S]*ON DELETE SET NULL/,
    );
    expect(sql).toMatch(
      /UPDATE "collections" AS c[\s\S]*"highlight_image_id" = NULL[\s\S]*l\."collection_id" = c\."id"/,
    );
    expect(sql.match(/NOT VALID/g)).toHaveLength(5);
    expect(sql).toMatch(
      /CREATE FUNCTION compute_collection_profile_source_fingerprint\([\s\S]*?l\.type = 'L'[\s\S]*?l\.visibility = 'PUBLISHED'[\s\S]*?l\.metadata_published = true[\s\S]*?LANGUAGE sql|CREATE FUNCTION compute_collection_profile_source_fingerprint\([\s\S]*?LANGUAGE sql[\s\S]*?l\.type = 'L'[\s\S]*?l\.visibility = 'PUBLISHED'[\s\S]*?l\.metadata_published = true/,
    );
    expect(sql).toMatch(
      /RETURNS text\s+LANGUAGE sql\s+STABLE/,
    );
    for (const input of [
      "'title', c.title",
      "'description', c.description",
      "'id', l.id",
      "'letterDate', l.letter_date",
      "'dateRaw', l.date_raw",
      "'sender', l.sender",
      "'recipient', l.recipient",
      "'summary', l.summary",
      "'hook', l.hook",
      "'entityExtractionJson', l.entity_extraction_json",
      "'primarySourceRevision', l.primary_source_revision",
    ]) {
      expect(sql).toContain(input);
    }
    expect(sql).toContain(
      'ORDER BY l.letter_date NULLS LAST, l.date_raw, l.id',
    );
    expect(sql).not.toMatch(
      /\bUPDATE\s+(?:"?letters"?|"?letter_versions"?)\b/i,
    );
    expect(sql.match(/\bUPDATE\s+"collections"\s+AS\s+c/gi)).toHaveLength(1);
    expect(sql).not.toMatch(
      /\bSET[\s\S]*?"profile_source_fingerprint"\s*=/i,
    );
  });

  it("adds replay-safe transcript confirmation persistence behind an old-worker gate", () => {
    const journal = readJournal();
    const sourceRevisions = journal.entries.find(
      (entry) => entry.tag === "0054_add_page_source_revisions",
    );
    const confirmationIntent = journal.entries.find(
      (entry) => entry.tag === "0055_add_transcript_confirmation_intent",
    );
    const sql = readMigrationSql("0055_add_transcript_confirmation_intent");

    expect(confirmationIntent).toBeDefined();
    expect(confirmationIntent!.idx).toBe(sourceRevisions!.idx + 1);
    expect(confirmationIntent!.breakpoints).toBe(true);

    for (const column of [
      '"transcript_confirmation_id" uuid',
      '"transcript_confirmation_intent_hash" text',
      '"transcript_confirmation_source_revision" integer',
      '"transcript_confirmation_transcript_digest" text',
      '"metadata_confirmation_guidance" jsonb',
      '"metadata_guidance_run_id" uuid',
    ]) {
      expect(sql).toContain(`ALTER TABLE "letters" ADD COLUMN ${column}`);
      expect(sql).not.toMatch(
        new RegExp(
          `ADD COLUMN ${column.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^;]*(?:NOT NULL|DEFAULT)`,
          "i",
        ),
      );
    }

    expect(sql).not.toMatch(/\bUPDATE\s+"letters"\b/i);
    expect(sql).not.toMatch(/\bALTER\s+COLUMN\b/i);
    expect(sql).not.toMatch(/\bVALIDATE\s+CONSTRAINT\b/i);
    expect(sql.match(/NOT VALID/g)).toHaveLength(5);

    const identityShape = sql.match(
      /ADD CONSTRAINT "transcript_confirmation_identity_shape"([\s\S]*?)NOT VALID;/,
    )?.[1];
    expect(identityShape).toBeDefined();
    expect(identityShape).toMatch(
      /"transcript_confirmation_id" IS NULL[\s\S]*"transcript_confirmation_intent_hash" IS NULL[\s\S]*"transcript_confirmation_source_revision" IS NULL[\s\S]*"transcript_confirmation_transcript_digest" IS NULL/,
    );
    expect(identityShape).toMatch(
      /"transcript_confirmed_at" IS NOT NULL[\s\S]*"transcript_confirmation_id" IS NOT NULL[\s\S]*"transcript_confirmation_intent_hash" IS NOT NULL[\s\S]*"transcript_confirmation_source_revision" IS NOT NULL[\s\S]*"transcript_confirmation_transcript_digest" IS NOT NULL/,
    );

    expect(sql).toMatch(
      /ADD CONSTRAINT "transcript_confirmation_hashes_valid"[\s\S]*"transcript_confirmation_intent_hash" ~ '\^v1\[.\]\[0-9a-f\]\{64\}\$'[\s\S]*"transcript_confirmation_transcript_digest" ~ '\^\[0-9a-f\]\{64\}\$'[\s\S]*NOT VALID;/,
    );
    expect(sql).toMatch(
      /ADD CONSTRAINT "transcript_confirmation_source_revision_nonnegative"[\s\S]*"transcript_confirmation_source_revision" >= 0[\s\S]*NOT VALID;/,
    );

    const guidanceShape = sql.match(
      /ADD CONSTRAINT "metadata_confirmation_guidance_shape"([\s\S]*?)NOT VALID;/,
    )?.[1];
    expect(guidanceShape).toBeDefined();
    expect(guidanceShape).toContain(
      '"transcript_confirmation_id" IS NOT NULL',
    );
    expect(guidanceShape).toContain(
      `jsonb_typeof("metadata_confirmation_guidance") = 'object'`,
    );
    expect(guidanceShape).toContain(
      `'confirmationId'`,
    );
    expect(guidanceShape).toContain(
      `'metadataInputIdentity'`,
    );
    expect(guidanceShape).toContain(
      `"metadata_confirmation_guidance"->'version' = '1'::jsonb`,
    );
    expect(guidanceShape).toMatch(
      /"metadata_confirmation_guidance"->>'confirmationId'\s*=\s*"transcript_confirmation_id"::text/,
    );
    expect(guidanceShape).toMatch(
      /"metadata_confirmation_guidance"->>'metadataInputIdentity'\s*~ '\^v1\[.\]\[0-9a-f\]\{64\}\$'/,
    );
    expect(guidanceShape).toContain(
      `"metadata_confirmation_guidance" IS NOT NULL`,
    );
    expect(guidanceShape).toContain(
      `"metadata_guidance_run_id" IS NULL`,
    );

    const runningGate = sql.match(
      /ADD CONSTRAINT "metadata_guidance_running_bound_to_run"([\s\S]*?)NOT VALID;/,
    )?.[1];
    expect(runningGate).toBeDefined();
    expect(runningGate).toMatch(
      /"metadata_confirmation_guidance" IS NULL[\s\S]*"metadata_status" <> 'RUNNING'[\s\S]*"metadata_guidance_run_id" IS NOT NULL[\s\S]*"metadata_run_id" IS NOT NULL[\s\S]*"metadata_guidance_run_id" = "metadata_run_id"/,
    );

    expect(sql).toMatch(
      /CREATE UNIQUE INDEX "letters_transcript_confirmation_id_unique"[\s\S]*ON "letters" \("transcript_confirmation_id"\)[\s\S]*WHERE "transcript_confirmation_id" IS NOT NULL/,
    );

    const invalidationFunction = sql.match(
      /CREATE FUNCTION clear_stale_transcript_confirmation_guidance\(\) RETURNS trigger AS \$\$([\s\S]*?)\$\$ LANGUAGE plpgsql;/,
    )?.[1];
    expect(invalidationFunction).toBeDefined();
    expect(invalidationFunction).toMatch(
      /NEW\.transcript_confirmed_at IS NULL[\s\S]*NEW\.primary_source_revision IS DISTINCT FROM OLD\.primary_source_revision[\s\S]*NEW\.transcription_text IS DISTINCT FROM OLD\.transcription_text/,
    );
    for (const field of [
      "transcript_confirmation_id",
      "transcript_confirmation_intent_hash",
      "transcript_confirmation_source_revision",
      "transcript_confirmation_transcript_digest",
      "metadata_confirmation_guidance",
      "metadata_guidance_run_id",
    ]) {
      expect(invalidationFunction).toContain(`NEW.${field} := NULL`);
    }
    for (const field of [
      "type",
      "collection_id",
      "letter_date",
      "date_raw",
      "extra_content_transcript",
      "extra_content_status",
      "extra_content_job_status",
    ]) {
      expect(invalidationFunction).toContain(`NEW.${field}`);
      expect(invalidationFunction).toContain(`OLD.${field}`);
    }
    expect(invalidationFunction).toMatch(
      /NEW\.entity_extraction_status = 'SUCCESS'[\s\S]*OLD\.entity_extraction_status IS DISTINCT FROM 'SUCCESS'[\s\S]*NEW\.metadata_confirmation_guidance := NULL[\s\S]*NEW\.metadata_guidance_run_id := NULL/,
    );
    expect(sql).toMatch(
      /CREATE TRIGGER transcript_confirmation_guidance_invalidation_guard[\s\S]*BEFORE UPDATE OF[\s\S]*transcript_confirmed_at,[\s\S]*primary_source_revision,[\s\S]*transcription_text,[\s\S]*extra_content_transcript,[\s\S]*entity_extraction_status[\s\S]*EXECUTE FUNCTION clear_stale_transcript_confirmation_guidance\(\)/,
    );
  });

  it("retires an identified confirmation when a legacy writer changes its reviewer stamp", () => {
    const sql = readMigrationSql("0055_add_transcript_confirmation_intent");
    const invalidationFunction = sql.match(
      /CREATE FUNCTION clear_stale_transcript_confirmation_guidance\(\) RETURNS trigger AS \$\$([\s\S]*?)\$\$ LANGUAGE plpgsql;/,
    )?.[1];

    expect(invalidationFunction).toBeDefined();
    expect(invalidationFunction).toMatch(
      /OLD\.transcript_confirmation_id IS NOT NULL/,
    );
    expect(invalidationFunction).toMatch(
      /NEW\.transcript_confirmed_at IS DISTINCT FROM OLD\.transcript_confirmed_at/,
    );
    expect(invalidationFunction).toMatch(
      /NEW\.transcript_confirmed_by IS DISTINCT FROM OLD\.transcript_confirmed_by/,
    );

    const legacyIdCondition = invalidationFunction!.indexOf(
      "OLD.transcript_confirmation_id IS NOT NULL",
    );
    const confirmedAtComparison = invalidationFunction!.indexOf(
      "NEW.transcript_confirmed_at IS DISTINCT FROM OLD.transcript_confirmed_at",
    );
    const confirmedByComparison = invalidationFunction!.indexOf(
      "NEW.transcript_confirmed_by IS DISTINCT FROM OLD.transcript_confirmed_by",
    );
    const receiptClearing = invalidationFunction!.indexOf(
      "NEW.transcript_confirmation_id := NULL",
    );
    expect(legacyIdCondition).toBeGreaterThanOrEqual(0);
    expect(confirmedAtComparison).toBeGreaterThan(legacyIdCondition);
    expect(confirmedByComparison).toBeGreaterThan(legacyIdCondition);
    expect(receiptClearing).toBeGreaterThan(confirmedAtComparison);
    expect(receiptClearing).toBeGreaterThan(confirmedByComparison);
    for (const field of [
      "transcript_confirmation_id",
      "transcript_confirmation_intent_hash",
      "transcript_confirmation_source_revision",
      "transcript_confirmation_transcript_digest",
      "metadata_confirmation_guidance",
      "metadata_guidance_run_id",
    ]) {
      expect(invalidationFunction!.indexOf(`NEW.${field} := NULL`))
        .toBeGreaterThan(confirmedByComparison);
    }

    expect(sql).toMatch(
      /CREATE TRIGGER transcript_confirmation_guidance_invalidation_guard[\s\S]*BEFORE UPDATE OF[\s\S]*transcript_confirmed_at,[\s\S]*transcript_confirmed_by,[\s\S]*EXECUTE FUNCTION clear_stale_transcript_confirmation_guidance\(\)/,
    );

    const activeConsumerGuard = invalidationFunction?.match(
      /BEGIN([\s\S]*?)END IF;\s*IF NEW\.transcript_confirmed_at/,
    )?.[1];
    expect(activeConsumerGuard).toBeDefined();
    for (const requiredGuardClause of [
      "OLD.metadata_confirmation_guidance IS NOT NULL",
      "NEW.metadata_status = 'RUNNING'",
      "NEW.entity_extraction_status = 'RUNNING'",
      "NEW.transcript_confirmed_at IS DISTINCT FROM OLD.transcript_confirmed_at",
      "NEW.transcript_confirmed_by IS DISTINCT FROM OLD.transcript_confirmed_by",
      "NEW.extra_content_transcript",
      "OLD.extra_content_transcript",
      "RAISE EXCEPTION",
      "cannot change guided metadata input without superseding its active consumer",
      "ERRCODE = '23514'",
    ]) {
      expect(activeConsumerGuard).toContain(requiredGuardClause);
    }
    expect(activeConsumerGuard).not.toContain(
      "OLD.metadata_guidance_run_id",
    );
    expect(activeConsumerGuard).not.toContain(
      "OLD.metadata_run_id",
    );
    expect(invalidationFunction!.lastIndexOf(
      "NEW.metadata_confirmation_guidance := NULL",
    )).toBeGreaterThan(invalidationFunction!.indexOf("RAISE EXCEPTION"));
  });

  it("protects current entity liveness ownership while allowing renewals and 0051 terminal writers", () => {
    const sql = readMigrationSql("0053_add_entity_extraction_liveness");
    const guardFunction = sql.match(
      /CREATE FUNCTION protect_current_entity_extraction_liveness\(\) RETURNS trigger AS \$\$([\s\S]*?)\$\$ LANGUAGE plpgsql;/,
    )?.[1];

    expect(guardFunction).toBeDefined();
    expect(guardFunction).toMatch(
      /OLD\.entity_extraction_status = 'RUNNING'[\s\S]*OLD\.entity_extraction_run_id IS NOT NULL[\s\S]*OLD\.entity_extraction_lease_expires_at IS NOT NULL[\s\S]*OLD\.entity_extraction_lease_run_id = OLD\.entity_extraction_run_id[\s\S]*OLD\.entity_extraction_claim_kind IS NOT NULL/,
    );
    expect(guardFunction).toMatch(
      /NEW\.entity_extraction_status = 'RUNNING'[\s\S]*NEW\.entity_extraction_run_id = OLD\.entity_extraction_run_id/,
    );
    expect(guardFunction).toMatch(
      /NEW\.entity_extraction_lease_expires_at IS NULL[\s\S]*NEW\.entity_extraction_lease_run_id IS DISTINCT FROM OLD\.entity_extraction_lease_run_id[\s\S]*NEW\.entity_extraction_claim_kind IS DISTINCT FROM OLD\.entity_extraction_claim_kind/,
    );
    expect(guardFunction).not.toMatch(
      /NEW\.entity_extraction_lease_expires_at IS DISTINCT FROM OLD\.entity_extraction_lease_expires_at/,
    );

    expect(sql).toMatch(
      /CREATE TRIGGER entity_extraction_liveness_guard[\s\S]*BEFORE UPDATE OF[\s\S]*entity_extraction_status,[\s\S]*entity_extraction_run_id,[\s\S]*entity_extraction_lease_expires_at,[\s\S]*entity_extraction_lease_run_id,[\s\S]*entity_extraction_claim_kind[\s\S]*EXECUTE FUNCTION protect_current_entity_extraction_liveness\(\)/,
    );
    expect(sql).not.toMatch(/\bDROP\s+(?:TRIGGER|FUNCTION|CONSTRAINT)\b/i);
  });
});
