import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ActiveFilterChips from "../ActiveFilterChips";

describe("ActiveFilterChips", () => {
  it("renders result count, chips, and clear all from the chip list", async () => {
    const user = userEvent.setup();
    const onRemoveVisibility = vi.fn();
    const onClearAllFilters = vi.fn();

    render(
      <ActiveFilterChips
        paginationTotal={14}
        activeFilterChips={[
          { key: "visibility", label: "Published", onRemove: onRemoveVisibility },
        ]}
        onClearAllFilters={onClearAllFilters}
      />,
    );

    expect(screen.getByText("14 letters")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Published/ }));
    await user.click(screen.getByRole("button", { name: "Clear all" }));

    expect(onRemoveVisibility).toHaveBeenCalled();
    expect(onClearAllFilters).toHaveBeenCalled();
  });

  it("hides clear all without chips", () => {
    render(
      <ActiveFilterChips
        paginationTotal={3}
        activeFilterChips={[]}
        onClearAllFilters={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Clear all" })).not.toBeInTheDocument();
  });
});
