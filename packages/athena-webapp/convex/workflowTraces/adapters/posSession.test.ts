import { describe, expect, it } from "vitest";
import type { Id } from "../../_generated/dataModel";

import { buildPosSessionTraceSeed } from "./posSession";

describe("buildPosSessionTraceSeed", () => {
  it("creates a stable POS session workflow trace seed from the session number", () => {
    const seed = buildPosSessionTraceSeed({
      storeId: "store_1" as Id<"store">,
      startedAt: 123,
      sessionNumber: " SES-001 ",
      posSessionId: "session_1" as Id<"posSession">,
      cashierId: "cashier_1" as Id<"cashier">,
      terminalId: "terminal_1" as Id<"posTerminal">,
      customerId: "customer_1" as Id<"posCustomer">,
      posTransactionId: "txn_1" as Id<"posTransaction">,
    });

    expect(seed.trace.traceId).toBe("pos_session:ses-001");
    expect(seed.trace.workflowType).toBe("pos_session");
    expect(seed.trace.primaryLookupType).toBe("session_number");
    expect(seed.lookup.lookupType).toBe("session_number");
    expect(seed.lookup.lookupValue).toBe("ses-001");
    expect(seed.trace.startedAt).toBe(123);
    expect(seed.subjectRefs).toEqual({
      posSessionId: "session_1",
      cashierId: "cashier_1",
      terminalId: "terminal_1",
      customerId: "customer_1",
      posTransactionId: "txn_1",
    });
    expect(seed.eventSource).toBe("workflow.posSession");
  });
});
