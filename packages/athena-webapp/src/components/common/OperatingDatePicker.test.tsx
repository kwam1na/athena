import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setOperatingClockOverride } from "@/lib/operations/operatingDate";
import { OperatingDatePicker } from "./OperatingDatePicker";

afterEach(() => setOperatingClockOverride(null));

describe("OperatingDatePicker", () => {
  it.each([
    ["2026-01-01", new Date(2025, 11, 31), new Date(2026, 0, 2)],
    ["2028-03-01", new Date(2028, 1, 29), new Date(2028, 2, 2)],
    ["2026-03-08", new Date(2026, 2, 7), new Date(2026, 2, 9)],
  ])(
    "steps across calendar boundaries from %s",
    (operatingDate, previous, next) => {
      const onChange = vi.fn();
      render(
        <OperatingDatePicker
          latestSelectableDate={new Date(2030, 0, 1)}
          onChange={onChange}
          operatingDate={operatingDate}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: /^Previous day,/ }));
      fireEvent.click(screen.getByRole("button", { name: /^Next day,/ }));

      expect(onChange).toHaveBeenNthCalledWith(1, previous);
      expect(onChange).toHaveBeenNthCalledWith(2, next);
    },
  );

  it("supports keyboard navigation and stops at today after the caller updates the date", async () => {
    setOperatingClockOverride(new Date(2026, 7, 30, 12));
    const onChange = vi.fn();
    const { rerender } = render(
      <OperatingDatePicker onChange={onChange} operatingDate="2026-08-29" />,
    );

    screen.getByRole("button", { name: /^Next day,/ }).focus();
    await userEvent.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith(new Date(2026, 7, 30));

    rerender(
      <OperatingDatePicker onChange={onChange} operatingDate="2026-08-30" />,
    );
    expect(
      screen.getByRole("button", { name: "Next day unavailable" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /^Previous day,/ }),
    ).toBeEnabled();
  });

  it.each([true, false])(
    "disables all controls when disabled or read-only (disabled=%s)",
    (disabled) => {
      render(
        <OperatingDatePicker
          disabled={disabled}
          onChange={disabled ? vi.fn() : undefined}
          operatingDate="2026-08-29"
        />,
      );

      for (const button of screen.getAllByRole("button")) {
        expect(button).toBeDisabled();
      }
    },
  );

  it("shares the caller's upper date limit between the calendar and day arrows", () => {
    const onChange = vi.fn();
    render(
      <OperatingDatePicker
        latestSelectableDate={new Date(2026, 7, 29)}
        onChange={onChange}
        operatingDate="2026-08-29"
      />,
    );

    expect(
      screen.getByRole("button", { name: "Next day unavailable" }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: /^Change operating date,/ }),
    );
    expect(
      screen.getByRole("button", { name: /Sunday, August 30th, 2026/ }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: /Friday, August 28th, 2026/ }),
    );
    expect(onChange).toHaveBeenCalledWith(new Date(2026, 7, 28));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
