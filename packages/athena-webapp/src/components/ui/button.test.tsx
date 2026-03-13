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
});
