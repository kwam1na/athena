import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReportPeriodControl } from "./ReportPeriodControl";

describe("ReportPeriodControl", () => {
  it("labels the selected reporting period", () => {
    render(<ReportPeriodControl onPresetChange={vi.fn()} preset="wtd" />);
    expect(screen.getByLabelText("Reporting period")).toHaveTextContent(
      "Week to date",
    );
  });

  it("collects a bounded custom date range before building", () => {
    render(
      <ReportPeriodControl
        end="2026-07-11"
        onCustomRangeSubmit={vi.fn()}
        onEndChange={vi.fn()}
        onPresetChange={vi.fn()}
        onStartChange={vi.fn()}
        preset="custom"
        start="2026-07-01"
      />,
    );
    expect(screen.getByLabelText("Start date")).toHaveAttribute(
      "max",
      "2026-07-11",
    );
    expect(screen.getByRole("button", { name: "Build report" })).toBeEnabled();
  });
});
