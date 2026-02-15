import { describe, expect, it } from "vitest";
import {
  filterEntitiesBySearch,
  getCanonicalNameConflicts,
  parseAliasInput,
  toggleSelectedId,
} from "../entity-utils";

describe("entity management utils", () => {
  it("filters entities by canonical name and aliases", () => {
    const entities = [
      { canonicalName: "Alice Baker", aliases: ["A. Baker"] },
      { canonicalName: "Bob Carter", aliases: ["Robert"] },
    ];

    expect(filterEntitiesBySearch(entities, "alice")).toHaveLength(1);
    expect(filterEntitiesBySearch(entities, "robert")).toHaveLength(1);
    expect(filterEntitiesBySearch(entities, "")).toHaveLength(2);
  });

  it("parses comma separated aliases", () => {
    expect(parseAliasInput(" Alice, Bob ,, Charlie ")).toEqual([
      "Alice",
      "Bob",
      "Charlie",
    ]);
  });

  it("toggles selected ids immutably", () => {
    const selected = new Set(["a"]);
    const added = toggleSelectedId(selected, "b");
    const removed = toggleSelectedId(added, "a");

    expect(Array.from(selected)).toEqual(["a"]);
    expect(Array.from(added).sort()).toEqual(["a", "b"]);
    expect(Array.from(removed)).toEqual(["b"]);
  });

  it("finds exact canonical-name conflicts excluding current entity", () => {
    const entities = [
      { id: "a", canonicalName: "John Smith" },
      { id: "b", canonicalName: "JOHN SMITH" },
      { id: "c", canonicalName: "Jane Smith" },
    ];

    const conflicts = getCanonicalNameConflicts(entities, "a", " john smith ");

    expect(conflicts.map((entity) => entity.id)).toEqual(["b"]);
  });
});
