import type { ComponentProps } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import DashboardDateFilterControl from "../DashboardDateFilterControl";

function makeDateProps(
  overrides: Partial<ComponentProps<typeof DashboardDateFilterControl>> = {},
): ComponentProps<typeof DashboardDateFilterControl> {
  return {
    value: {
      dateMode: "specific",
      yearFilter: 1886,
      monthFilter: 3,
      dayFilter: 14,
      dateFromFilter: null,
      dateToFilter: null,
    },
    summary: "Mar 14, 1886",
    onModeChange: vi.fn(),
    onYearChange: vi.fn(),
    onMonthChange: vi.fn(),
    onDayChange: vi.fn(),
    onDateFromChange: vi.fn(),
    onDateToChange: vi.fn(),
    onClear: vi.fn(),
    ...overrides,
  };
}

describe("DashboardDateFilterControl", () => {
  it("renders date fields inline instead of behind a dropdown trigger", () => {
    render(<DashboardDateFilterControl {...makeDateProps()} />);

    expect(screen.getByText("Date")).toBeInTheDocument();
    expect(screen.getByText("Mar 14, 1886")).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Date year" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Date/i }),
    ).not.toBeInTheDocument();
  });

  it("routes a mode switch through one atomic transition", async () => {
    const user = userEvent.setup();
    const onModeChange = vi.fn();
    render(
      <DashboardDateFilterControl
        {...makeDateProps({ onModeChange })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Range" }));

    expect(onModeChange).toHaveBeenCalledOnce();
    expect(onModeChange).toHaveBeenCalledWith("range");
  });

  it("shows the clear action only when a date filter is active", () => {
    const inactive = makeDateProps({
      value: {
        dateMode: "specific",
        yearFilter: null,
        monthFilter: null,
        dayFilter: null,
        dateFromFilter: null,
        dateToFilter: null,
      },
      summary: "Date",
    });
    const { rerender } = render(
      <DashboardDateFilterControl {...inactive} />,
    );

    expect(
      screen.queryByRole("button", { name: "Clear" }),
    ).not.toBeInTheDocument();

    rerender(
      <DashboardDateFilterControl
        {...makeDateProps({
          value: {
            ...inactive.value,
            yearFilter: 1886,
          },
          summary: "1886",
        })}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Clear" }),
    ).toBeInTheDocument();
  });

  it("routes every date value and clear intent to its named action", async () => {
    const user = userEvent.setup();
    const onYearChange = vi.fn();
    const onMonthChange = vi.fn();
    const onDayChange = vi.fn();
    const onDateFromChange = vi.fn();
    const onDateToChange = vi.fn();
    const onClear = vi.fn();
    const { rerender } = render(
      <DashboardDateFilterControl
        {...makeDateProps({
          value: {
            dateMode: "specific",
            yearFilter: null,
            monthFilter: null,
            dayFilter: null,
            dateFromFilter: null,
            dateToFilter: null,
          },
          onYearChange,
          onMonthChange,
          onDayChange,
          onClear,
        })}
      />,
    );

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Date year" }),
      "1886",
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Date month" }),
      "3",
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Date day" }),
      "14",
    );

    expect(onYearChange).toHaveBeenCalledWith(1886);
    expect(onMonthChange).toHaveBeenCalledWith(3);
    expect(onDayChange).toHaveBeenCalledWith(14);

    rerender(
      <DashboardDateFilterControl
        {...makeDateProps({
          value: {
            dateMode: "range",
            yearFilter: null,
            monthFilter: null,
            dayFilter: null,
            dateFromFilter: "18860101",
            dateToFilter: "18861231",
          },
          onDateFromChange,
          onDateToChange,
          onClear,
        })}
      />,
    );

    const dateInputs = screen.getAllByPlaceholderText("mm/dd/yyyy");
    fireEvent.change(dateInputs[0], { target: { value: "02/03/1887" } });
    fireEvent.change(dateInputs[1], { target: { value: "04/05/1888" } });
    await user.click(screen.getByRole("button", { name: "Clear" }));

    expect(onDateFromChange).toHaveBeenCalledWith("18870203");
    expect(onDateToChange).toHaveBeenCalledWith("18880405");
    expect(onClear).toHaveBeenCalledOnce();
  });
});
