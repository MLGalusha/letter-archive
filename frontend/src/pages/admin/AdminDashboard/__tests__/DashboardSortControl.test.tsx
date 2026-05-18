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

  it("renders sort rules inside the shared manager dialog and closes with escape", async () => {
    const user = userEvent.setup();
    render(
      <SortControlHarness
        initialSort={[{ field: "lastOpenedAt", direction: "desc" }]}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Sort/i }));

    expect(screen.getByRole("dialog", { name: "Sort rules" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sort" })).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "Sort rules" })).not.toBeInTheDocument();
  });

  it("discards unapplied draft changes when reopened", async () => {
    const user = userEvent.setup();
    render(
      <SortControlHarness
        initialSort={[{ field: "letterDate", direction: "asc" }]}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Sort/i }));

    await user.click(screen.getByRole("button", {
      name: /Letter date is sorted oldest first/i,
    }));
    expect(screen.getByRole("button", {
      name: /Letter date is sorted newest first/i,
    })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: /Sort/i }));

    expect(screen.getByRole("button", {
      name: /Letter date is sorted oldest first/i,
    })).toBeInTheDocument();
  });

  it("adds a draft sort rule through the add-rule picker", async () => {
    const user = userEvent.setup();
    render(
      <SortControlHarness
        initialSort={[{ field: "lastOpenedAt", direction: "desc" }]}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Sort/i }));
    await user.click(screen.getByRole("button", { name: "Add sort rule" }));
    await user.click(screen.getByRole("option", { name: /Letter date/i }));

    expect(screen.queryByRole("listbox", { name: "Add sort rule" })).not.toBeInTheDocument();
    expect(screen.getByText("then by")).toBeInTheDocument();
    expect(screen.getByText("Letter date")).toBeInTheDocument();
  });

  it("closes when clicking outside the shared manager boundary", async () => {
    const user = userEvent.setup();
    render(
      <>
        <SortControlHarness
          initialSort={[{ field: "lastOpenedAt", direction: "desc" }]}
        />
        <button type="button">Outside action</button>
      </>,
    );

    await user.click(screen.getByRole("button", { name: /Sort/i }));
    expect(screen.getByRole("dialog", { name: "Sort rules" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Outside action" }));

    expect(screen.queryByRole("dialog", { name: "Sort rules" })).not.toBeInTheDocument();
  });
});
