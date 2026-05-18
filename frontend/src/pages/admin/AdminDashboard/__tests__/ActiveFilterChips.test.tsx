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
        processingStatus={null}
        selectedCount={0}
        onClearAllFilters={onClearAllFilters}
      />,
    );

    expect(screen.getByText("14 letters")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Published/ }));
    await user.click(screen.getByRole("button", { name: "Clear all" }));

    expect(onRemoveVisibility).toHaveBeenCalled();
    expect(onClearAllFilters).toHaveBeenCalled();
  });

  it("hides clear all without chips and suppresses processing status while rows are selected", () => {
    render(
      <ActiveFilterChips
        paginationTotal={3}
        activeFilterChips={[]}
        processingStatus={{
          isRunning: true,
          isPaused: false,
          shouldAbort: false,
          total: 8,
          completed: 2,
          failed: 0,
          errors: [],
          lastCompletedAt: null,
          currentJob: { letterId: "letter-1", type: "transcription" },
        }}
        selectedCount={1}
        onClearAllFilters={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Clear all" })).not.toBeInTheDocument();
    expect(screen.queryByText("T: 2/8")).not.toBeInTheDocument();
  });
});
