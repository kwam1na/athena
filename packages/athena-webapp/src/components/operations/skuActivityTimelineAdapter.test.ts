import { describe, expect, it } from "vitest";

import { buildSkuActivityTimelineViewModel } from "./skuActivityTimelineAdapter";

describe("buildSkuActivityTimelineViewModel", () => {
  it("adapts backend SKU activity into the operations inspection surface", () => {
    const viewModel = buildSkuActivityTimelineViewModel({
      activeReservations: {
        checkoutQuantity: 1,
        entries: [
          {
            activityEventId: "activity-1",
            quantity: 2,
            sourceId: "pos-session-1",
            sourceLabel: "Register 2 sale POS-1004",
            sourceType: "posSession",
            status: "active",
          },
        ],
        posQuantity: 2,
        totalQuantity: 3,
      },
      productSku: {
        _id: "sku-1",
        productName: "Kinky closure wig",
        sku: "KK38-X3C-MQE",
      },
      stock: {
        durableQuantityAvailable: 5,
        inventoryCount: 8,
        quantityAvailable: 5,
      },
      timeline: [
        {
          _id: "activity-1",
          activityType: "reservation_acquired",
          occurredAt: 1_000,
          reservationQuantity: 2,
          sourceId: "pos-session-1",
          sourceLabel: "Register 2 sale POS-1004",
          sourceType: "posSession",
          status: "active",
        },
      ],
      warnings: [
        {
          code: "unexplained_availability_gap",
          message: "Available stock has an unexplained gap.",
        },
      ],
    });

    expect(viewModel).toMatchObject({
      activeReservations: [
        {
          id: "activity-1",
          quantity: 2,
          sourceLabel: "Register 2 sale POS-1004",
          sourceType: "pos_session",
          status: "active",
        },
      ],
      activityRows: [
        {
          activityType: "reservation_acquired",
          id: "activity-1",
          quantity: 2,
          sourceType: "pos_session",
          status: "active",
        },
      ],
      diagnostics: [
        {
          kind: "unexplained_availability_gap",
          message: "Available stock has an unexplained gap.",
          severity: "warning",
        },
      ],
      sku: {
        displayName: "Kinky closure wig",
        productSkuId: "sku-1",
        sku: "KK38-X3C-MQE",
      },
      stock: {
        checkoutReservedQuantity: 1,
        durableQuantityAvailable: 5,
        inventoryCount: 8,
        posReservedQuantity: 2,
        quantityAvailable: 5,
        reservedQuantity: 3,
      },
    });
  });
});
