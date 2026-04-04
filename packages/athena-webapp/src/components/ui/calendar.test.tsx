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
    expect(screen.getByRole("gridcell", { name: "15" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
  });
});
