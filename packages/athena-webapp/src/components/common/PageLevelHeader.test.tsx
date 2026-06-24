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
    expect(header).not.toHaveClass("border-b");

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

  it("renders the bottom divider only when requested", () => {
    render(
      <PageLevelHeader
        eyebrow="Guidance"
        showBottomBorder
        title="Athena rollout guidance"
        description="Written guidance keeps the reference templates aligned."
      />,
    );

    const header = screen.getByRole("banner");
    expect(header).toHaveClass("border-b");
    expect(header).toHaveClass("pb-layout-lg");
  });

  it("updates animated title and description content by key", async () => {
    const { rerender } = render(
      <PageLevelHeader
        animateContent
        contentKey="loading"
        eyebrow="Store Ops"
        title="Stock adjustments"
        description="Review store inventory before changes are applied."
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Stock adjustments" }),
    ).toBeInTheDocument();

    rerender(
      <PageLevelHeader
        animateContent
        contentKey="loaded"
        eyebrow="Store Ops"
        title="2 SKUs have reserved units."
        description="27.7k of 27.7k units are available to sell."
      />,
    );

    expect(
      await screen.findByRole("heading", {
        name: "2 SKUs have reserved units.",
      }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("27.7k of 27.7k units are available to sell."),
    ).toBeInTheDocument();
  });

  it("updates animated content in place when the content key is stable", () => {
    const { rerender } = render(
      <PageLevelHeader
        animateContent
        contentKey="loaded"
        eyebrow="Store Ops"
        title="All inventory is available."
        description="8 of 8 units are available to sell."
      />,
    );

    rerender(
      <PageLevelHeader
        animateContent
        contentKey="loaded"
        eyebrow="Store Ops"
        title="1 SKU has reserved units."
        description="6 of 8 units are available to sell."
      />,
    );

    expect(
      screen.getByRole("heading", { name: "1 SKU has reserved units." }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "All inventory is available." }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("6 of 8 units are available to sell."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("8 of 8 units are available to sell."),
    ).not.toBeInTheDocument();
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
      "space-y-layout-xl",
      "md:space-y-layout-3xl",
    );
    expect(screen.getByText("Side rail").parentElement).toHaveClass(
      "gap-layout-md",
      "md:gap-layout-lg",
    );
    expect(
      screen.getByText("Main work").parentElement?.parentElement,
    ).toHaveClass("gap-layout-xl", "lg:gap-layout-2xl");
  });
});
