import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TimelineEventCard } from "./TimelineEventCard";

vi.mock("~/src/hooks/useGetCurrencyFormatter", () => ({
  useGetCurrencyFormatter: () =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }),
}));

describe("TimelineEventCard", () => {
  it("renders observability journey and failure details instead of a generic action label", () => {
    render(
      <TimelineEventCard
        event={
          {
            _id: "analytics_1",
            _creationTime: Date.now() - 60_000,
            action: "storefront_observability",
            storeFrontUserId: "guest_1",
            storeId: "store_1",
            data: {},
            journey: "checkout",
            step: "payment_submission",
            status: "failed",
            sessionId: "session-123",
            route: "/shop/checkout",
            origin: "homepage",
            device: "desktop",
            errorCategory: "network",
            errorCode: "timeout",
            errorMessage: "Request timed out",
            userData: {
              email: "shopper@example.com",
            },
          } as any
        }
      />,
    );

    expect(screen.getByText("Payment submission")).toBeInTheDocument();
    expect(screen.getByText("Checkout")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    // expect(screen.getByText(/session-123/i)).toBeInTheDocument();
    expect(screen.getByText(/request timed out/i)).toBeInTheDocument();
    expect(
      screen.queryByText("Storefront observability"),
    ).not.toBeInTheDocument();
  });

  it("renders shared order milestones with the order reference and milestone message", () => {
    render(
      <TimelineEventCard
        event={
          {
            _id: "operational_1",
            _creationTime: Date.now() - 30_000,
            eventType: "online_order_ready_for_pickup",
            source: "operations",
            storeId: "store_1",
            journey: "online_order",
            step: "ready_for_pickup",
            status: "succeeded",
            onlineOrderId: "order_1",
            subjectLabel: "ORD-1001",
            message: "Order is bagged and ready for customer pickup.",
          } as any
        }
      />,
    );

    expect(screen.getByText("Ready for pickup")).toBeInTheDocument();
    expect(screen.getByText("Online order")).toBeInTheDocument();
    expect(screen.getByText("ORD-1001")).toBeInTheDocument();
    expect(
      screen.getByText("Order is bagged and ready for customer pickup."),
    ).toBeInTheDocument();
  });
});
