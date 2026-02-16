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
});
