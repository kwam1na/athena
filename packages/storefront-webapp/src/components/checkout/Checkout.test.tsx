import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { Checkout } from "./Checkout";

vi.mock("./CheckoutProvider", () => ({
  CheckoutProvider: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("./BagSummary", () => ({
  default: () => <div>Bag Summary</div>,
}));

vi.mock("./MobileBagSummary", () => ({
  default: () => <div>Mobile Bag Summary</div>,
}));

vi.mock("./CheckoutForm", () => ({
  CheckoutForm: () => <form>Checkout Form</form>,
}));

vi.mock("../communication/TrustSignals", () => ({
  TrustSignals: () => <div>Trust Signals</div>,
}));

vi.mock("@/hooks/useStorefrontObservability", () => ({
  useStorefrontObservability: () => ({
    track: vi.fn(async () => {}),
  }),
}));

vi.mock("@/hooks/useGetActiveCheckoutSession", () => ({
  useGetActiveCheckoutSession: () => ({
    data: null,
  }),
}));

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>(
    "@tanstack/react-router",
  );

  return {
    ...actual,
    useNavigate: () => vi.fn(),
  };
});

describe("Checkout", () => {
  it("exposes a stable checkout readiness hook", () => {
    render(<Checkout />);

    expect(screen.getByTestId("storefront-checkout-ready")).toBeInTheDocument();
  });
});
