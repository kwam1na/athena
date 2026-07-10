import { describe, expect, it } from "vitest";

import {
  canonicalReportingBusinessEventKey,
  canonicalReportingFactIdentity,
  canonicalReportingFactKey,
  type ReportingBusinessEventIdentity,
} from "./factIdentity";

describe("reporting fact identity", () => {
  it("deduplicates live then backfill replay with one versioned key", () => {
    const live = canonicalReportingFactKey({
      businessEventKey: "pos:tx-1:complete",
      factType: "sale",
      lineKey: "item-1",
    });
    const replay = canonicalReportingFactKey({
      businessEventKey: "pos:tx-1:complete",
      factType: "sale",
      lineKey: "item-1",
    });
    expect(live).toBe("pos:tx-1:complete:line:item-1:sale");
    expect(replay).toBe(live);
  });

  it.each<{
    expected: string;
    factType:
      | "sale"
      | "void"
      | "refund"
      | "procurement_commitment"
      | "procurement_receipt";
    lineKey?: string;
    name: string;
    source: ReportingBusinessEventIdentity;
  }>([
    {
      expected: "pos:tx-1:complete:line:item-1:sale",
      factType: "sale",
      lineKey: "item-1",
      name: "POS sale",
      source: { kind: "pos_sale", transactionId: "tx-1" },
    },
    {
      expected: "service:case-1:complete:line:labor-1:sale",
      factType: "sale",
      lineKey: "labor-1",
      name: "service completion",
      source: { kind: "service_completion", serviceCaseId: "case-1" },
    },
    {
      expected: "pos:tx-1:void:line:item-1:void",
      factType: "void",
      lineKey: "item-1",
      name: "POS void",
      source: { kind: "pos_void", transactionId: "tx-1" },
    },
    {
      expected: "pos:tx-1:refund:refund-1:line:item-1:refund",
      factType: "refund",
      lineKey: "item-1",
      name: "POS refund",
      source: {
        kind: "pos_refund",
        refundId: "refund-1",
        transactionId: "tx-1",
      },
    },
    {
      expected:
        "purchase_order:po-1:commitment:line:line-1:line:line-1:procurement_commitment",
      factType: "procurement_commitment",
      lineKey: "line-1",
      name: "purchase commitment",
      source: {
        kind: "purchase_commitment",
        lineId: "line-1",
        purchaseOrderId: "po-1",
      },
    },
    {
      expected:
        "purchase_order:po-1:receipt:batch-1:line:line-1:line:line-1:procurement_receipt",
      factType: "procurement_receipt",
      lineKey: "line-1",
      name: "purchase receipt",
      source: {
        kind: "purchase_receipt",
        lineId: "line-1",
        purchaseOrderId: "po-1",
        receivingBatchId: "batch-1",
      },
    },
    {
      expected: "storefront:order-1:refund:refund-1:refund",
      factType: "refund",
      name: "storefront refund",
      source: {
        kind: "storefront_refund",
        orderId: "order-1",
        refundId: "refund-1",
      },
    },
  ])("uses one live/backfill identity for $name", ({
    expected,
    factType,
    lineKey,
    source,
  }) => {
    const live = canonicalReportingFactKey({
      businessEventKey: canonicalReportingBusinessEventKey(source),
      factType,
      lineKey,
    });
    const backfill = canonicalReportingFactIdentity({
      factType,
      lineKey,
      source,
    });
    expect(live).toBe(expected);
    expect(backfill).toBe(live);
  });
});
