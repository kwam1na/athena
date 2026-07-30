import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FlipNumber } from "./FlipNumber";

describe("FlipNumber", () => {
  it("exposes an accessible formatted value while its glyphs animate", () => {
    const { rerender } = render(
      <FlipNumber testId="reusable-flip-number" value={124} />,
    );

    const number = screen.getByTestId("reusable-flip-number");
    expect(number).toHaveAttribute("data-motion", "flip");
    expect(number).toHaveAttribute("data-value", "124");
    expect(
      screen.getByText("124", { selector: ".sr-only" }),
    ).toBeInTheDocument();

    rerender(<FlipNumber testId="reusable-flip-number" value={711} />);

    expect(number).toHaveAttribute("data-value", "711");
    expect(
      screen.getByText("711", { selector: ".sr-only" }),
    ).toBeInTheDocument();
  });

  it("can leave accessibility copy to a labelled parent", () => {
    render(
      <FlipNumber
        accessible={false}
        testId="decorative-flip-number"
        value={16}
      />,
    );

    const number = screen.getByTestId("decorative-flip-number");
    expect(number).toHaveAttribute("aria-hidden", "true");
    expect(number.querySelector(".sr-only")).not.toBeInTheDocument();
  });
});
