import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button } from "./button";

describe("Button", () => {
  it("renders its label and variant classes", () => {
    render(
      <Button size="sm" variant="secondary">
        Save changes
      </Button>
    );

    const button = screen.getByRole("button", { name: "Save changes" });

    expect(button).toBeInTheDocument();
    expect(button).toHaveClass("h-9");
    expect(button).toHaveClass("bg-secondary");
  });

  it("renders semantic action variants", () => {
    render(
      <>
        <Button>Correct</Button>
        <Button variant="primary-soft">Selected correction</Button>
        <Button variant="utility">View receipt</Button>
        <Button variant="utility-strong">Print receipt</Button>
      </>
    );

    expect(screen.getByRole("button", { name: "Correct" })).toHaveClass(
      "bg-primary",
      "text-primary-foreground",
    );
    expect(
      screen.getByRole("button", { name: "Selected correction" }),
    ).toHaveClass("border-primary-border", "bg-primary-soft", "text-primary");
    expect(screen.getByRole("button", { name: "View receipt" })).toHaveClass(
      "text-action-neutral",
    );
    expect(screen.getByRole("button", { name: "Print receipt" })).toHaveClass(
      "bg-action-neutral-strong",
      "text-action-neutral-strong-foreground",
    );
  });
});
