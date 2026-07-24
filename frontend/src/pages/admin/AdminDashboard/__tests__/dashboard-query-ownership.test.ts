import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sourcePath = (relativePath: string) => path.resolve(
  process.cwd(),
  "src",
  relativePath,
);

function countOccurrences(source: string, value: string) {
  return source.split(value).length - 1;
}

describe("dashboard committed query ownership", () => {
  it("creates one memoized query at the dashboard composition boundary", async () => {
    const page = await readFile(
      sourcePath("pages/admin/AdminDashboard.tsx"),
      "utf8",
    );

    expect(countOccurrences(page, "createDashboardCommittedQuery(")).toBe(1);

    const queryOwner = page.match(
      /const\s+([A-Za-z_$][\w$]*)\s*=\s*useMemo\(\s*\(\)\s*=>\s*createDashboardCommittedQuery\(/,
    );
    expect(queryOwner).not.toBeNull();

    const queryName = queryOwner?.[1] ?? "missingCommittedQuery";
    for (const hookName of [
      "useDashboardLettersData",
      "useDashboardFilteredSelection",
    ]) {
      expect(page).toMatch(new RegExp(
        `${hookName}\\(\\{[\\s\\S]{0,800}?query:\\s*${queryName}\\b[\\s\\S]{0,800}?\\}\\)`,
      ));
    }
  });

  it("gives both read hooks the query contract instead of filter-control ownership", async () => {
    const sources = await Promise.all([
      readFile(
        sourcePath("pages/admin/AdminDashboard/useDashboardLettersData.ts"),
        "utf8",
      ),
      readFile(
        sourcePath("pages/admin/AdminDashboard/useDashboardFilteredSelection.ts"),
        "utf8",
      ),
    ]);

    for (const source of sources) {
      expect(source).toContain("DashboardCommittedQuery");
      expect(source).toMatch(/\bquery:\s*DashboardCommittedQuery\s*;/);
      expect(source).not.toContain("DashboardFilterControls");
      expect(source).not.toContain("getDashboardFilterQueryFields");
      expect(source).not.toMatch(/\bfilters:\s*DashboardFilterControls\s*;/);
      expect(source).not.toMatch(/\bsortColumns:\s*SortColumn\[\]\s*;/);
    }
  });
});
