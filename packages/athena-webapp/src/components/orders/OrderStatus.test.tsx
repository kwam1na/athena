import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { OrderStatus } from "./OrderStatus";

describe("OrderStatus", () => {
  it("renders order status pills without a visible border", () => {
    render(<OrderStatus order={{ status: "open" }} />);

    const label = screen.getByText("Open");
    const pill = label.closest("div.inline-flex");

    expect(pill).not.toBeNull();
    expect(pill).toHaveClass("border-transparent");
  });
});
