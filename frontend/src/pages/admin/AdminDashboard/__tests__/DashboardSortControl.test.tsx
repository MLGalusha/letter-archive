import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import DashboardSortControl from "../DashboardSortControl";
import { MAX_DASHBOARD_SORT_RULES } from "../constants";
import { SORT_OPTIONS } from "../dashboardSortModel";
import type { SortColumn } from "../types";

function SortControlHarness({ initialSort }: { initialSort: SortColumn[] }) {
  const [sortColumns, setSortColumns] = useState(initialSort);
  const [open, setOpen] = useState(false);

  return (
    <DashboardSortControl
      sortColumns={sortColumns}
      setSortColumns={setSortColumns}
      open={open}
      onOpenChange={setOpen}
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
    expect(screen.getByText("oldest first")).toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAccessibleName(/Letter date is sorted newest first/i);
    expect(screen.getByText("newest first")).toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAccessibleName(/Letter date is sorted oldest first/i);
    expect(screen.getByText("oldest first")).toBeInTheDocument();
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

  it("commits an applied draft through the controlled owner before closing", async () => {
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
    await user.click(screen.getByRole("button", { name: "Apply sorting" }));

    expect(screen.queryByRole("dialog", { name: "Sort rules" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", {
      name: /Sort Letter date, newest first/i,
    })).toBeInTheDocument();

    await user.click(screen.getByRole("button", {
      name: /Sort Letter date, newest first/i,
    }));
    expect(screen.getByRole("button", {
      name: /Letter date is sorted newest first/i,
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

  it("does not offer a ninth sort rule beyond the server limit", async () => {
    const user = userEvent.setup();
    render(
      <SortControlHarness
        initialSort={SORT_OPTIONS
          .slice(0, MAX_DASHBOARD_SORT_RULES)
          .map((option) => ({
            field: option.value,
            direction: "asc",
          }))}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Sorted by 8 rules/i }));

    expect(screen.queryByRole("button", { name: "Add sort rule" })).not.toBeInTheDocument();
    expect(screen.getByText("Maximum 8 sort rules")).toBeInTheDocument();
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
