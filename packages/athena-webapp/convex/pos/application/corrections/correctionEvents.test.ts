import { describe, expect, it } from "vitest";
import type { Id } from "../../../_generated/dataModel";
import { buildCorrectionOperationalEvent } from "./correctionEvents";

describe("correction event helpers", () => {
  it("builds operational event payloads with subject linkage and old/new metadata", () => {
    expect(
      buildCorrectionOperationalEvent({
        storeId: "store_1" as Id<"store">,
        organizationId: "org_1" as Id<"organization">,
        intent: "customer_attribution",
        subject: {
          type: "pos_transaction",
          id: "txn_1",
          label: "Sale TXN-1",
        },
        actor: {
          userId: "user_1" as Id<"athenaUser">,
          staffProfileId: "staff_1" as Id<"staffProfile">,
        },
        reason: "Customer was selected after checkout.",
        oldValue: null,
        newValue: { customerProfileId: "customer_1" },
        metadata: {
          source: "pos_register",
        },
        posTransactionId: "txn_1" as Id<"posTransaction">,
        customerProfileId: "customer_1" as Id<"customerProfile">,
      })
    ).toMatchObject({
      storeId: "store_1",
      organizationId: "org_1",
      eventType: "pos.correction.customer_attribution",
      subjectType: "pos_transaction",
      subjectId: "txn_1",
      subjectLabel: "Sale TXN-1",
      message: "Correction recorded for Sale TXN-1.",
      reason: "Customer was selected after checkout.",
      actorUserId: "user_1",
      actorStaffProfileId: "staff_1",
      posTransactionId: "txn_1",
      customerProfileId: "customer_1",
      metadata: {
        correctionIntent: "customer_attribution",
        oldValue: null,
        newValue: { customerProfileId: "customer_1" },
        source: "pos_register",
      },
    });
  });
});
