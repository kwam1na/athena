import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReportCalendar } from "./ReportCalendar";

describe("ReportCalendar", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 29, 12));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows today and disables future dates and month navigation", () => {
    render(
      <ReportCalendar
        defaultMonth={new Date(2026, 6, 29)}
        mode="single"
      />,
    );

    expect(
      screen.getByRole("button", { name: /Wednesday, July 29th, 2026/i }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: /Thursday, July 30th, 2026/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /Go to the Next Month/i }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("preserves caller boundaries while also disabling future dates", () => {
    render(
      <ReportCalendar
        defaultMonth={new Date(2026, 6, 29)}
        disabled={{ before: new Date(2026, 6, 15) }}
        mode="single"
      />,
    );

    expect(
      screen.getByRole("button", { name: /Tuesday, July 14th, 2026/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /Monday, July 20th, 2026/i }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: /Thursday, July 30th, 2026/i }),
    ).toBeDisabled();
  });
});
