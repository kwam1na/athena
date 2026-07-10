import { describe, expect, it } from "vitest";

import { recognizeCommerceEvent } from "./facts";

describe("reporting commerce recognition", () => {
  it("recognizes mixed POS merchandise and service revenue once", () => {
    const facts = recognizeCommerceEvent({
      currency: "GHS",
      eventKey: "pos:transaction-1:complete",
      kind: "pos_completed",
      occurredAt: Date.UTC(2026, 6, 7, 20),
      recordedAt: Date.UTC(2026, 6, 7, 20, 1),
      sourceId: "transaction-1",
      storeId: "store-1",
      lines: [
        {
          cogsKnownMinor: 5_000,
          kind: "merchandise",
          lineId: "line-1",
          netRevenueMinor: 8_000,
          quantity: 1,
          skuId: "sku-1",
        },
        {
          kind: "service",
          lineId: "line-2",
          netRevenueMinor: 2_000,
          quantity: 1,
          serviceCaseId: "case-1",
        },
      ],
    });

    expect(facts).toHaveLength(2);
    expect(facts.map((fact) => fact.netRevenueMinor)).toEqual([8_000, 2_000]);
    expect(facts.reduce((sum, fact) => sum + fact.netRevenueMinor, 0)).toBe(
      10_000,
    );
    expect(facts[0]).toMatchObject({
      channel: "pos",
      costStatus: "known",
      sourceEventKey: "pos:transaction-1:complete",
    });
  });

  it("keeps standalone service completion but suppresses POS-linked duplication", () => {
    expect(
      recognizeCommerceEvent({
        currency: "GHS",
        eventKey: "service:case-1:complete",
        kind: "service_completed",
        netRevenueMinor: 5_000,
        occurredAt: 100,
        posTransactionId: "transaction-1",
        recordedAt: 110,
        serviceCaseId: "case-1",
        storeId: "store-1",
      }),
    ).toEqual([]);

    expect(
      recognizeCommerceEvent({
        currency: "GHS",
        eventKey: "service:case-2:complete",
        kind: "service_completed",
        netRevenueMinor: 5_000,
        occurredAt: 100,
        recordedAt: 110,
        serviceCaseId: "case-2",
        storeId: "store-1",
      }),
    ).toEqual([
      expect.objectContaining({
        channel: "service",
        netRevenueMinor: 5_000,
        revenueKind: "service",
      }),
    ]);
  });

  it("recognizes storefront revenue only at first fulfillment", () => {
    const pending = recognizeCommerceEvent({
      currency: "GHS",
      eventKey: "order:order-1:paid",
      kind: "storefront_status_changed",
      lines: [],
      occurredAt: 100,
      previousStatus: "pending",
      recordedAt: 110,
      sourceId: "order-1",
      status: "paid",
      storeId: "store-1",
    });
    const fulfilled = recognizeCommerceEvent({
      currency: "GHS",
      eventKey: "order:order-1:delivered",
      kind: "storefront_status_changed",
      lines: [
        {
          cogsKnownMinor: null,
          kind: "merchandise",
          lineId: "item-1",
          netRevenueMinor: 12_000,
          quantity: 1,
          skuId: "sku-1",
        },
      ],
      occurredAt: 200,
      previousStatus: "paid",
      recordedAt: 210,
      sourceId: "order-1",
      status: "delivered",
      storeId: "store-1",
    });

    expect(pending).toEqual([]);
    expect(fulfilled).toEqual([
      expect.objectContaining({
        channel: "storefront",
        costStatus: "unknown",
        recognizedAt: 200,
      }),
    ]);
  });

  it("keeps finalized refunds as linked negative facts in their event period", () => {
    const [fact] = recognizeCommerceEvent({
      currency: "GHS",
      eventKey: "refund:refund-1:finalized",
      kind: "refund_finalized",
      lineId: "line-1",
      netRevenueMinor: 2_500,
      occurredAt: 300,
      originalEventKey: "pos:transaction-1:complete",
      quantity: 1,
      recordedAt: 310,
      sourceId: "refund-1",
      storeId: "store-1",
    });

    expect(fact).toMatchObject({
      linkedSourceEventKey: "pos:transaction-1:complete",
      netRevenueMinor: -2_500,
      quantity: -1,
      recognizedAt: 300,
      revenueKind: "refund",
    });
  });
});
