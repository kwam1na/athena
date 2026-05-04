import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PageLevelHeader } from "./PageLevelHeader";

describe("PageLevelHeader", () => {
  it("renders the canonical page-level orientation header", () => {
    render(
      <PageLevelHeader
        eyebrow="Guidance"
        title="Athena rollout guidance"
        description="Written guidance keeps the reference templates aligned."
      />,
    );

    const header = screen.getByRole("banner");
    expect(header).toHaveClass("max-w-4xl");
    expect(header).toHaveClass("border-b");

    expect(screen.getByText("Guidance")).toHaveClass("uppercase");
    expect(
      screen.getByRole("heading", { name: "Athena rollout guidance" }),
    ).toHaveClass("font-display");
    expect(
      screen.getByText("Written guidance keeps the reference templates aligned."),
    ).toHaveClass("text-muted-foreground");
  });
});
