import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../_generated/dataModel";
import { correctTransactionCustomer } from "./commands/correctTransaction";
import { recordOperationalEventWithCtx } from "../../operations/operationalEvents";
import {
  getPosTransactionById,
  patchPosTransaction,
} from "../infrastructure/repositories/transactionRepository";

vi.mock("../../operations/operationalEvents", () => ({
  recordOperationalEventWithCtx: vi.fn(),
}));

vi.mock("../infrastructure/repositories/transactionRepository", () => ({
  getPosTransactionById: vi.fn(),
  patchPosTransaction: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();
});

describe("correctTransactionCustomer", () => {
  it("patches only customer attribution on the transaction and records metadata-only history", async () => {
    vi.mocked(getPosTransactionById).mockResolvedValue({
      _id: "txn-1" as Id<"posTransaction">,
      storeId: "store-1" as Id<"store">,
      transactionNumber: "POS-111111",
      status: "completed",
      customerProfileId: "old-profile" as Id<"customerProfile">,
      customerInfo: { name: "Walk-in" },
      registerSessionId: "register-session-1" as Id<"registerSession">,
    } as never);
    vi.mocked(recordOperationalEventWithCtx).mockResolvedValue({
      _id: "event-1" as Id<"operationalEvent">,
    } as never);

    const result = await correctTransactionCustomer({} as never, {
      transactionId: "txn-1" as Id<"posTransaction">,
      customerProfileId: "new-profile" as Id<"customerProfile">,
      actorStaffProfileId: "staff-1" as Id<"staffProfile">,
      reason: "Customer selected after checkout",
    });

    expect(patchPosTransaction).toHaveBeenCalledWith({} as never, "txn-1", {
      customerProfileId: "new-profile",
      customerInfo: undefined,
    });
    expect(recordOperationalEventWithCtx).toHaveBeenCalledWith(
      {} as never,
      expect.objectContaining({
        eventType: "pos_transaction_customer_corrected",
        metadata: expect.objectContaining({
          correctionType: "customer_attribution",
          previousCustomerProfileId: "old-profile",
          customerProfileId: "new-profile",
          metadataOnly: true,
        }),
        posTransactionId: "txn-1",
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        transactionId: "txn-1",
        previousCustomerProfileId: "old-profile",
        customerProfileId: "new-profile",
        operationalEventId: "event-1",
      }),
    );
  });
});
