import { describe, expect, it } from "vitest";
import type { Id } from "../../_generated/dataModel";

import { buildPosSaleTraceSeed } from "./posSale";

describe("buildPosSaleTraceSeed", () => {
  it("creates a stable POS workflow trace seed from the transaction number", () => {
    const seed = buildPosSaleTraceSeed({
      storeId: "store_1" as Id<"store">,
      organizationId: "org_1" as Id<"organization">,
      startedAt: 123,
      transactionNumber: " POS-TXN-001 ",
      posTransactionId: "txn_1" as Id<"posTransaction">,
      registerSessionId: "register_1" as Id<"registerSession">,
      cashierId: "cashier_1" as Id<"cashier">,
      terminalId: "terminal_1" as Id<"posTerminal">,
      customerId: "customer_1" as Id<"posCustomer">,
    });

    expect(seed.trace.traceId).toBe("pos_sale:pos-txn-001");
    expect(seed.trace.workflowType).toBe("pos_sale");
    expect(seed.trace.primaryLookupType).toBe("transaction_number");
    expect(seed.lookup.lookupType).toBe("transaction_number");
    expect(seed.lookup.lookupValue).toBe("pos-txn-001");
    expect(seed.trace.startedAt).toBe(123);
    expect(seed.subjectRefs).toEqual({
      posTransactionId: "txn_1",
      registerSessionId: "register_1",
      cashierId: "cashier_1",
      terminalId: "terminal_1",
      customerId: "customer_1",
    });
    expect(seed.eventSource).toBe("workflow.posSale");
  });
});
