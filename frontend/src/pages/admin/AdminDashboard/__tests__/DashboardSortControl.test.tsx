import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import DashboardSortControl from "../DashboardSortControl";
import type { SortColumn } from "../types";

function SortControlHarness({ initialSort }: { initialSort: SortColumn[] }) {
  const [sortColumns, setSortColumns] = useState(initialSort);

  return (
    <DashboardSortControl
      sortColumns={sortColumns}
      setSortColumns={setSortColumns}
    />
  );
}

describe("DashboardSortControl", () => {
  it("toggles a draft sort rule direction back and forth before applying", async () => {
    const user = userEvent.setup();
    render(
      <SortControlHarness
        initialSort={[{ field: "letterDate", direction: "asc" }]}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Sort/i }));

    const toggle = screen.getByRole("button", {
      name: /Letter date is sorted oldest first/i,
    });

    await user.click(toggle);
    expect(toggle).toHaveAccessibleName(/Letter date is sorted newest first/i);

    await user.click(toggle);
    expect(toggle).toHaveAccessibleName(/Letter date is sorted oldest first/i);
  });
});
