import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("animejs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("animejs")>();
  return { ...actual, animate: vi.fn(actual.animate) };
});
import { animate } from "animejs";

import { FlipNumber, FlipText } from "./FlipNumber";

/** Properties animated across every `animate` call since the last reset. */
function animatedProperties() {
  return vi
    .mocked(animate)
    .mock.calls.flatMap(([, options]) => Object.keys(options ?? {}));
}

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

  it("settles the first value in from a placeholder zero without flipping", () => {
    // Almost every metric mounts before its data arrives, so it mounts at a
    // placeholder 0 and the real figure is its FIRST change. Flipping there
    // animates the arrival of data as though the number had moved, which is
    // what makes a freshly loaded page churn.
    vi.mocked(animate).mockClear();
    const { rerender } = render(
      <FlipNumber testId="default-zero-number" value={0} />,
    );
    rerender(<FlipNumber testId="default-zero-number" value={24} />);

    expect(animatedProperties()).not.toContain("rotateX");
  });

  it("still flips a change between two real values", () => {
    // The flip earns its place when a number genuinely moves.
    vi.mocked(animate).mockClear();
    const { rerender } = render(
      <FlipNumber testId="real-change-number" value={18} />,
    );
    rerender(<FlipNumber testId="real-change-number" value={24} />);

    expect(animatedProperties()).toContain("rotateX");
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

  it("can fade the first non-zero value in without flipping the zero out", () => {
    const { rerender } = render(
      <FlipNumber
        testId="zero-fade-number"
        transitionFromZero="fade"
        value={0}
      />,
    );

    rerender(
      <FlipNumber
        testId="zero-fade-number"
        transitionFromZero="fade"
        value={24}
      />,
    );

    const number = screen.getByTestId("zero-fade-number");
    expect(number).toHaveAttribute("data-transition-from-zero", "fade");
    expect(number.querySelector('[aria-hidden="true"]')).toHaveTextContent(
      "24",
    );
  });
});

describe("FlipText", () => {
  it("keeps one accessible string value while the visible text flips", () => {
    const { rerender } = render(
      <FlipText
        delayMs={200}
        testId="reusable-flip-text"
        value="Loading report"
      />,
    );

    const text = screen.getByTestId("reusable-flip-text");
    expect(text).toHaveAttribute("data-motion", "flip");
    expect(text).toHaveAttribute("data-variant", "text");
    expect(text).toHaveAttribute("data-value", "Loading report");
    expect(text).toHaveAttribute("data-switch-delay", "200");

    rerender(
      <FlipText
        delayMs={200}
        testId="reusable-flip-text"
        value="Reporting week settled"
      />,
    );

    expect(text).toHaveAttribute("data-value", "Reporting week settled");
    expect(
      screen.getByText("Reporting week settled", { selector: ".sr-only" }),
    ).toBeInTheDocument();
  });
});
