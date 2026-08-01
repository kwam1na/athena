import { fireEvent, render, screen } from "@testing-library/react";
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

    expect(
      screen.getByRole("group", { name: "Preset date ranges" }),
    ).toBeInTheDocument();
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
});
