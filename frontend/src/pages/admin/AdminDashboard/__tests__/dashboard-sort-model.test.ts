import { describe, expect, it } from "vitest";
import {
  areSortColumnsEqual,
  getDefaultDirection,
  getDirectionLabel,
  getFieldLabel,
  getSortButtonSummary,
} from "../dashboardSortModel";

describe("dashboardSortModel", () => {
  it("summarizes empty, single, and multi-rule sort stacks", () => {
    expect(getSortButtonSummary([])).toEqual({ label: "Sort" });
    expect(getSortButtonSummary([{ field: "letterDate", direction: "asc" }])).toEqual({
      label: "Sort",
      detail: "Letter date, oldest first",
    });
    expect(getSortButtonSummary([
      { field: "letterDate", direction: "asc" },
      { field: "sender", direction: "desc" },
    ])).toEqual({ label: "Sorted by 2 rules" });
  });

  it("keeps sort equality tied to field, direction, and rule order", () => {
    expect(areSortColumnsEqual(
      [{ field: "sender", direction: "asc" }],
      [{ field: "sender", direction: "asc" }],
    )).toBe(true);
    expect(areSortColumnsEqual(
      [{ field: "sender", direction: "asc" }],
      [{ field: "sender", direction: "desc" }],
    )).toBe(false);
    expect(areSortColumnsEqual(
      [{ field: "sender", direction: "asc" }, { field: "recipient", direction: "asc" }],
      [{ field: "recipient", direction: "asc" }, { field: "sender", direction: "asc" }],
    )).toBe(false);
  });

  it("labels sort fields, default directions, and direction copy by field type", () => {
    expect(getFieldLabel("lastOpenedAt")).toBe("Last opened");
    expect(getDefaultDirection("lastOpenedAt")).toBe("desc");
    expect(getDefaultDirection("sender")).toBe("asc");
    expect(getDirectionLabel("flagged", "desc")).toBe("flagged first");
    expect(getDirectionLabel("letters", "asc")).toBe("low to high");
    expect(getDirectionLabel("visibility", "desc")).toBe("public first");
  });
});
