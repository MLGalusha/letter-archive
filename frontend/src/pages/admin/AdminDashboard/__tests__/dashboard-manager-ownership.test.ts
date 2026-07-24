import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sourcePath = (relativePath: string) => path.resolve(
  process.cwd(),
  "src",
  relativePath,
);

async function readSource(relativePath: string) {
  return readFile(sourcePath(relativePath), "utf8");
}

describe("dashboard manager ownership", () => {
  it("composes one manager controller across the route and toolbar", async () => {
    const [route, toolbar] = await Promise.all([
      readSource("pages/admin/AdminDashboard.tsx"),
      readSource("pages/admin/AdminDashboard/DashboardToolbar.tsx"),
    ]);

    expect(route).toContain("useDashboardManagerState()");
    expect(route).not.toMatch(
      /const\s*\[\s*\w*(?:filter|manager|surface)\w*\s*,[^\]]*\]\s*=\s*useState/i,
    );
    expect(toolbar).not.toMatch(/\buseState\s*(?:<[^>]*>)?\s*\(/);
  });

  it("keeps transient menu state and DOM ownership out of column preferences", async () => {
    const columns = await readSource(
      "pages/admin/AdminDashboard/useDashboardColumns.ts",
    );

    expect(columns).not.toMatch(
      /\buseRef\b|\bHTML[A-Za-z]*Element\b|useState\s*(?:<boolean>)?\s*\(\s*false\s*\)/,
    );
  });

  it("does not leave fallback open-state owners in controlled manager leaves", async () => {
    const leaves = await Promise.all([
      readSource("pages/admin/AdminDashboard/SavedViewsMenu.tsx"),
      readSource("pages/admin/AdminDashboard/DashboardSortControl.tsx"),
    ]);

    for (const source of leaves) {
      expect(source).not.toMatch(
        /\buncontrolledOpen\b|\bcontrolledOpen\b|\bopen\?:|\bonOpenChange\?:/,
      );
    }
  });
});
