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

  it("renders pickup exceptions as attention states instead of completion states", () => {
    render(<OrderStatus order={{ status: "pickup-exception" }} />);

    const label = screen.getByText("Pickup exception");
    const pill = label.closest("div.inline-flex");

    expect(pill).not.toBeNull();
    expect(pill).toHaveClass("bg-warning/10", "text-warning");
  });

  it("uses theme-aware success tokens for completed orders", () => {
    render(<OrderStatus order={{ status: "delivered" }} />);

    const label = screen.getByText("Delivered");
    const pill = label.closest("div.inline-flex");

    expect(pill).not.toBeNull();
    expect(pill).toHaveClass("bg-success/10", "text-success");
  });
});
