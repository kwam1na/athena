import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  SkuActivityTimeline,
  type SkuActivityTimelineViewModel,
} from "./SkuActivityTimeline";

const baseViewModel: SkuActivityTimelineViewModel = {
  activeReservations: [],
  activityRows: [],
  diagnostics: [],
  sku: {
    displayName: "Kinky closure wig",
    productSkuId: "sku-1",
    sku: "KK38-X3C-MQE",
  },
  stock: {
    inventoryCount: 8,
    quantityAvailable: 8,
    reservedQuantity: 0,
  },
};

function renderTimeline(
  props: Partial<Parameters<typeof SkuActivityTimeline>[0]> = {},
) {
  return render(<SkuActivityTimeline viewModel={baseViewModel} {...props} />);
}

describe("SkuActivityTimeline", () => {
  it("renders active POS and checkout reservations as separate source rows", () => {
    renderTimeline({
      viewModel: {
        ...baseViewModel,
        activeReservations: [
          {
            id: "pos-hold-1",
            quantity: 2,
            sourceLabel: "Register 2 sale POS-1004",
            sourceType: "pos_session",
            status: "active",
          },
          {
            id: "checkout-hold-1",
            quantity: 1,
            sourceLabel: "Checkout session CHK-9001",
            sourceType: "checkout",
            status: "active",
          },
        ],
        activityRows: [
          {
            activityType: "reservation_acquired",
            id: "event-1",
            occurredAt: new Date("2026-05-13T10:15:00.000Z").getTime(),
            quantity: 2,
            sourceLabel: "Register 2 sale POS-1004",
            sourceType: "pos_session",
            status: "active",
          },
          {
            activityType: "checkout_reserved",
            id: "event-2",
            occurredAt: new Date("2026-05-13T10:20:00.000Z").getTime(),
            quantity: 1,
            sourceLabel: "Checkout session CHK-9001",
            sourceType: "checkout",
            status: "active",
          },
        ],
        stock: {
          checkoutReservedQuantity: 1,
          inventoryCount: 8,
          posReservedQuantity: 2,
          quantityAvailable: 5,
          reservedQuantity: 3,
        },
      },
    });

    const reservations = screen.getByRole("list", {
      name: /active reservations/i,
    });

    expect(
      within(reservations).getByText("Reserved by POS session"),
    ).toBeInTheDocument();
    expect(
      within(reservations).getByText("Register 2 sale POS-1004"),
    ).toBeInTheDocument();
    expect(within(reservations).getByText("2 units")).toBeInTheDocument();
    expect(
      within(reservations).getByText("Reserved by checkout"),
    ).toBeInTheDocument();
    expect(
      within(reservations).getByText("Checkout session CHK-9001"),
    ).toBeInTheDocument();
    expect(within(reservations).getByText("1 unit")).toBeInTheDocument();
    expect(screen.getByText("POS")).toBeInTheDocument();
    expect(screen.getByText("Checkout")).toBeInTheDocument();
  });

  it("renders an empty timeline with current stock fields", () => {
    renderTimeline({
      viewModel: {
        ...baseViewModel,
        stock: {
          durableQuantityAvailable: 6,
          inventoryCount: 6,
          quantityAvailable: 6,
          reservedQuantity: 0,
        },
      },
    });

    expect(screen.getByText("Kinky Closure Wig")).toBeInTheDocument();
    expect(screen.queryByText("KK38-X3C-MQE")).not.toBeInTheDocument();
    expect(screen.getByText("On hand")).toBeInTheDocument();
    expect(screen.getAllByText("6").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("No SKU activity recorded.")).toBeInTheDocument();
    expect(
      screen.getByText("No active reservations are linked to this SKU."),
    ).toBeInTheDocument();
  });

  it("renders unexplained availability gap diagnostics without claiming a source", () => {
    renderTimeline({
      viewModel: {
        ...baseViewModel,
        diagnostics: [
          {
            id: "gap-1",
            kind: "unexplained_availability_gap",
            message:
              "Available stock is lower than on-hand stock, but no active reservation explains the gap.",
            severity: "warning",
          },
        ],
        stock: {
          inventoryCount: 8,
          quantityAvailable: 5,
          reservedQuantity: 3,
        },
      },
    });

    expect(screen.getByText("Unexplained availability gap")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Available stock is lower than on-hand stock, but no active reservation explains the gap.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Reserved by POS session/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Reserved by checkout/i)).not.toBeInTheDocument();
  });

  it("renders safe loading, failure, and empty query states", () => {
    const { rerender } = render(
      <SkuActivityTimeline isLoading viewModel={undefined} />,
    );

    expect(screen.getByText("Loading SKU activity.")).toBeInTheDocument();

    rerender(
      <SkuActivityTimeline
        error={new Error("Convex backend stack trace")}
        viewModel={null}
      />,
    );

    expect(screen.getByText("SKU activity unavailable.")).toBeInTheDocument();
    expect(
      screen.getByText("Refresh the SKU or try again from the inventory view."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Convex backend stack trace"),
    ).not.toBeInTheDocument();

    rerender(<SkuActivityTimeline viewModel={null} />);

    expect(screen.getByText("No SKU selected.")).toBeInTheDocument();
  });

  it("orders timeline rows by event time and labels release and sale activity", () => {
    vi.spyOn(Date, "now").mockReturnValue(
      new Date("2026-05-13T10:30:00.000Z").getTime(),
    );

    renderTimeline({
      viewModel: {
        ...baseViewModel,
        activityRows: [
          {
            activityType: "sale_consumed",
            id: "event-2",
            occurredAt: new Date("2026-05-13T10:25:00.000Z").getTime(),
            quantity: 1,
            sourceLabel: "Sale TXN-10",
            sourceType: "sale",
            status: "consumed",
          },
          {
            activityType: "reservation_released",
            id: "event-1",
            occurredAt: new Date("2026-05-13T10:15:00.000Z").getTime(),
            quantity: 1,
            sourceLabel: "Register 2 sale POS-1004",
            sourceType: "pos_session",
            status: "released",
          },
        ],
      },
    });

    const rows = screen.getAllByRole("listitem");

    expect(rows[0]).toHaveTextContent("Released");
    expect(rows[0]).toHaveTextContent("Register 2 sale POS-1004");
    expect(rows[1]).toHaveTextContent("Consumed by sale");
    expect(rows[1]).toHaveTextContent("Sale TXN-10");
  });
});
