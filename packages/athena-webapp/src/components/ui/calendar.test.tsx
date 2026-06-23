import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Calendar } from "./calendar";

describe("Calendar", () => {
  it("renders navigation controls and the selected day", () => {
    render(
      <Calendar
        mode="single"
        month={new Date(2026, 3, 1)}
        selected={new Date(2026, 3, 15)}
        showOutsideDays={false}
      />
    );

    expect(screen.getByRole("button", { name: /previous/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /next/i })).toBeInTheDocument();
    const selectedDay = screen.getByRole("gridcell", { name: "15" });

    expect(selectedDay).toHaveAttribute("aria-selected", "true");
    expect(selectedDay.querySelector("button")).toHaveClass(
      "data-[selected-single=true]:bg-action-workflow",
      "data-[selected-single=true]:text-action-workflow-foreground"
    );
  });

  it("uses the styled dropdown root for month and year selectors", () => {
    render(
      <Calendar
        captionLayout="dropdown"
        mode="single"
        month={new Date(2026, 5, 1)}
        startMonth={new Date(2026, 0, 1)}
        endMonth={new Date(2026, 11, 1)}
      />
    );

    for (const dropdown of screen.getAllByRole("combobox")) {
      expect(dropdown.closest(".rdp-dropdown_root")).toHaveClass(
        "border-input",
        "has-focus:ring-[3px]"
      );
    }
  });
});
