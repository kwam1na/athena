import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Input } from "./input";

describe("Input", () => {
  it("uses a transparent focus ring by default", () => {
    render(<Input aria-label="Product search" />);

    expect(screen.getByRole("textbox", { name: "Product search" })).toHaveClass(
      "focus-visible:ring-transparent",
    );
  });
});
