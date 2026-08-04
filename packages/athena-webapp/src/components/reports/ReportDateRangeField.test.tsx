import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReportDateRangeField } from "./ReportDateRangeField";

describe("ReportDateRangeField", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 30, 12));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("offers operator presets and applies the selected range", async () => {
    const onSelect = vi.fn();

    render(
      <ReportDateRangeField
        endDate="2026-07-30"
        onSelect={onSelect}
        startDate="2026-07-30"
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Change date range, currently Thu, Jul 30, 2026",
      }),
    );

    const presetGroup = screen.getByRole("group", {
      name: "Preset date ranges",
    });
    expect(presetGroup).toBeInTheDocument();
    // U1 decoupled presets from the overview-window enum; U7 appended the
    // six-month preset as the delivery's final wire, so the picker now
    // renders all five explicit presets, in order.
    const presetButtons = within(presetGroup).getAllByRole("button");
    expect(presetButtons.map((button) => button.textContent)).toEqual([
      "Today",
      "Week to date",
      "Trailing 30 days",
      "Trailing 3 months",
      "Trailing 6 months",
    ]);
    expect(screen.getByRole("button", { name: "Today" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByRole("button", { name: "Week to date" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Trailing 30 days" }),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Trailing 3 months" }),
    );

    expect(onSelect).toHaveBeenCalledWith({
      startDate: "2026-05-01",
      endDate: "2026-07-30",
    });
    expect(
      screen.queryByRole("group", { name: "Preset date ranges" }),
    ).not.toBeInTheDocument();
  });

  it("resolves the Trailing 6 months preset to the calendar-aligned range", () => {
    const onSelect = vi.fn();

    render(
      <ReportDateRangeField
        endDate="2026-07-30"
        onSelect={onSelect}
        startDate="2026-07-30"
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Change date range, currently Thu, Jul 30, 2026",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Trailing 6 months" }),
    );

    // Calendar-month aligned, matching trailingSixMonthsStart: six calendar
    // months back from the 2026-07-30 anchor starts on 2026-02-01.
    expect(onSelect).toHaveBeenCalledWith({
      startDate: "2026-02-01",
      endDate: "2026-07-30",
    });
  });
});
