import { describe, expect, it } from "vitest";
import type { Id } from "../../_generated/dataModel";

import {
  buildPurchaseOrderReceivingLookup,
  buildPurchaseOrderTraceSeed,
  PURCHASE_ORDER_ID_LOOKUP_TYPE,
  PURCHASE_ORDER_NUMBER_LOOKUP_TYPE,
  PURCHASE_ORDER_RECEIVING_SUBMISSION_LOOKUP_TYPE,
  PURCHASE_ORDER_VENDOR_LOOKUP_TYPE,
} from "./purchaseOrder";

describe("buildPurchaseOrderTraceSeed", () => {
  it("creates a PO-centered workflow trace seed with id, number, and vendor lookups", () => {
    const seed = buildPurchaseOrderTraceSeed({
      storeId: "store_1" as Id<"store">,
      organizationId: "org_1" as Id<"organization">,
      purchaseOrderId: "po_1" as Id<"purchaseOrder">,
      poNumber: " PO-001 ",
      vendorId: "vendor_1" as Id<"vendor">,
      vendorName: "Main Supplier",
      operationalWorkItemId: "work_1" as Id<"operationalWorkItem">,
      status: "ordered",
      startedAt: 123,
    });

    expect(seed.trace.traceId).toBe("purchase_order:po_1");
    expect(seed.trace.workflowType).toBe("purchase_order");
    expect(seed.trace.primaryLookupType).toBe(PURCHASE_ORDER_ID_LOOKUP_TYPE);
    expect(seed.trace.primaryLookupValue).toBe("po_1");
    expect(seed.trace.title).toBe("Purchase order PO-001");
    expect(seed.trace.details).toEqual({
      status: "ordered",
      vendorName: "Main Supplier",
    });
    expect(seed.lookups).toEqual([
      expect.objectContaining({
        lookupType: PURCHASE_ORDER_ID_LOOKUP_TYPE,
        lookupValue: "po_1",
      }),
      expect.objectContaining({
        lookupType: PURCHASE_ORDER_NUMBER_LOOKUP_TYPE,
        lookupValue: "po-001",
      }),
      expect.objectContaining({
        lookupType: PURCHASE_ORDER_VENDOR_LOOKUP_TYPE,
        lookupValue: "vendor_1",
      }),
    ]);
    expect(seed.subjectRefs).toEqual({
      operationalWorkItemId: "work_1",
      poNumber: "PO-001",
      purchaseOrderId: "po_1",
      vendorId: "vendor_1",
    });
    expect(seed.eventSource).toBe("workflow.purchaseOrder");
  });

  it("creates a normalized receiving submission lookup for the PO trace", () => {
    expect(
      buildPurchaseOrderReceivingLookup({
        storeId: "store_1" as Id<"store">,
        traceId: "purchase_order:po_1",
        submissionKey: " Receive-001 ",
      }),
    ).toEqual({
      storeId: "store_1",
      workflowType: "purchase_order",
      lookupType: PURCHASE_ORDER_RECEIVING_SUBMISSION_LOOKUP_TYPE,
      lookupValue: "receive-001",
      traceId: "purchase_order:po_1",
    });
  });
});
