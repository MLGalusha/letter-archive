import type { ComponentProps } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import DashboardDateFilterControl from "../DashboardDateFilterControl";

describe("DashboardDateFilterControl", () => {
  function renderDateFilterControl(overrides: Partial<ComponentProps<typeof DashboardDateFilterControl>> = {}) {
    const props: ComponentProps<typeof DashboardDateFilterControl> = {
      dateMode: "specific" as const,
      setDateMode: vi.fn(),
      hasDateFilter: true,
      yearFilter: 1886,
      setYearFilter: vi.fn(),
      monthFilter: 3,
      setMonthFilter: vi.fn(),
      dayFilter: 14,
      setDayFilter: vi.fn(),
      dateFromFilter: null,
      setDateFromFilter: vi.fn(),
      dateToFilter: null,
      setDateToFilter: vi.fn(),
      clearDateFilters: vi.fn(),
      getDateButtonText: () => "Mar 14, 1886",
      dateRawToDisplay: (dateRaw: string | null) => dateRaw ?? "",
      displayToDateRaw: (display: string) => display || null,
      ...overrides,
    };

    render(<DashboardDateFilterControl {...props} />);
    return props;
  }

  it("renders date fields inline instead of behind a dropdown trigger", () => {
    renderDateFilterControl();

    expect(screen.getByText("Date")).toBeInTheDocument();
    expect(screen.getByText("Mar 14, 1886")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Date year" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Date/i })).not.toBeInTheDocument();
  });

  it("clears incompatible fields when switching modes", async () => {
    const user = userEvent.setup();
    const props = renderDateFilterControl();

    await user.click(screen.getByRole("button", { name: "Range" }));

    expect(props.setDateMode).toHaveBeenCalledWith("range");
    expect(props.setYearFilter).toHaveBeenCalledWith(null);
    expect(props.setMonthFilter).toHaveBeenCalledWith(null);
    expect(props.setDayFilter).toHaveBeenCalledWith(null);
  });

  it("shows the clear action only when a date filter is active", () => {
    const { rerender } = render(
      <DashboardDateFilterControl
        dateMode="specific"
        setDateMode={vi.fn()}
        hasDateFilter={false}
        yearFilter={null}
        setYearFilter={vi.fn()}
        monthFilter={null}
        setMonthFilter={vi.fn()}
        dayFilter={null}
        setDayFilter={vi.fn()}
        dateFromFilter={null}
        setDateFromFilter={vi.fn()}
        dateToFilter={null}
        setDateToFilter={vi.fn()}
        clearDateFilters={vi.fn()}
        getDateButtonText={() => "Date"}
        dateRawToDisplay={(dateRaw) => dateRaw ?? ""}
        displayToDateRaw={(display) => display || null}
      />,
    );

    expect(screen.queryByRole("button", { name: "Clear" })).not.toBeInTheDocument();

    rerender(
      <DashboardDateFilterControl
        dateMode="specific"
        setDateMode={vi.fn()}
        hasDateFilter
        yearFilter={1886}
        setYearFilter={vi.fn()}
        monthFilter={null}
        setMonthFilter={vi.fn()}
        dayFilter={null}
        setDayFilter={vi.fn()}
        dateFromFilter={null}
        setDateFromFilter={vi.fn()}
        dateToFilter={null}
        setDateToFilter={vi.fn()}
        clearDateFilters={vi.fn()}
        getDateButtonText={() => "1886"}
        dateRawToDisplay={(dateRaw) => dateRaw ?? ""}
        displayToDateRaw={(display) => display || null}
      />,
    );

    expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument();
  });
});
