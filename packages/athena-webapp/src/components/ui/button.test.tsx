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
        <Button variant="workflow">Correct</Button>
        <Button variant="workflow-soft">Selected correction</Button>
        <Button variant="utility">View receipt</Button>
      </>
    );

    expect(screen.getByRole("button", { name: "Correct" })).toHaveClass(
      "bg-action-workflow",
    );
    expect(
      screen.getByRole("button", { name: "Selected correction" }),
    ).toHaveClass("bg-action-workflow-soft");
    expect(screen.getByRole("button", { name: "View receipt" })).toHaveClass(
      "text-action-neutral",
    );
  });
});
