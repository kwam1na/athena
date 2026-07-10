import { describe, expect, it } from "vitest";

import { adaptPosCompleted } from "./sourceAdapters/pos";
import { adaptServiceCompletion } from "./sourceAdapters/service";
import { adaptSettlement } from "./sourceAdapters/settlement";
import { adaptStorefrontStatus } from "./sourceAdapters/storefront";

describe("reporting source adapters", () => {
  it("preserves offline POS occurrence independently from recording time", () => {
    const event = adaptPosCompleted({
      currency: "GHS",
      isOffline: true,
      lines: [],
      occurredAt: 100,
      recordedAt: 10_000,
      storeId: "store-1",
      transactionId: "transaction-1",
    });

    expect(event).toMatchObject({
      eventKey: "pos:transaction-1:complete",
      occurredAt: 100,
      recordedAt: 10_000,
    });
  });

  it("builds stable event keys for storefront and service transitions", () => {
    expect(
      adaptStorefrontStatus({
        currency: "GHS",
        lines: [],
        occurredAt: 100,
        orderId: "order-1",
        previousStatus: "paid",
        recordedAt: 101,
        status: "picked-up",
        storeId: "store-1",
      }).eventKey,
    ).toBe("storefront:order-1:fulfilled");
    expect(
      adaptServiceCompletion({
        currency: "GHS",
        netRevenueMinor: 5_000,
        occurredAt: 100,
        recordedAt: 101,
        serviceCaseId: "case-1",
        storeId: "store-1",
      }).eventKey,
    ).toBe("service:case-1:complete");
  });

  it("treats settlement as evidence and never revenue", () => {
    expect(
      adaptSettlement({
        amountMinor: 10_000,
        businessEventKey: "payment:allocation-1:captured",
        currency: "GHS",
        occurredAt: 100,
        paymentAllocationId: "allocation-1",
        recordedAt: 101,
        status: "captured",
        storeId: "store-1",
      }),
    ).toMatchObject({
      amountMinor: 10_000,
      factKind: "settlement",
      revenueMinor: 0,
    });
  });
});
