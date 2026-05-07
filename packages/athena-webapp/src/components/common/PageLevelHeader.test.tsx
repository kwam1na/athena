import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  PageLevelHeader,
  PageWorkspace,
  PageWorkspaceGrid,
  PageWorkspaceMain,
  PageWorkspaceRail,
} from "./PageLevelHeader";

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
      screen.getByText(
        "Written guidance keeps the reference templates aligned.",
      ),
    ).toHaveClass("text-muted-foreground");
  });

  it("exposes the canonical workspace rhythm primitives", () => {
    render(
      <PageWorkspace>
        <PageWorkspaceGrid>
          <PageWorkspaceMain>
            <p>Main work</p>
          </PageWorkspaceMain>
          <PageWorkspaceRail>
            <p>Side rail</p>
          </PageWorkspaceRail>
        </PageWorkspaceGrid>
      </PageWorkspace>,
    );

    expect(screen.getByText("Main work").parentElement).toHaveClass(
      "space-y-layout-3xl",
    );
    expect(screen.getByText("Side rail").parentElement).toHaveClass(
      "gap-layout-lg",
    );
    expect(
      screen.getByText("Main work").parentElement?.parentElement,
    ).toHaveClass("gap-layout-2xl");
  });
});
