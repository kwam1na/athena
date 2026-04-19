import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TotalsDisplay } from "./TotalsDisplay";

const formatter = new Intl.NumberFormat("en-GH", {
  style: "currency",
  currency: "GHS",
});

describe("TotalsDisplay", () => {
  it("formats stored pesewas values before rendering", () => {
    render(
      <TotalsDisplay
        items={[{ label: "Total", value: 15000, formatter, highlight: true }]}
      />
    );

    expect(screen.getByText("Total")).toBeInTheDocument();
    expect(screen.getByText(formatter.format(150))).toBeInTheDocument();
    expect(screen.queryByText(formatter.format(15000))).not.toBeInTheDocument();
  });
});
