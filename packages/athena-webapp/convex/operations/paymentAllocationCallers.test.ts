import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(file: string) {
  return readFileSync(new URL(file, import.meta.url), "utf8");
}

describe("payment allocation business identities", () => {
  it("derives POS and offline keys from source-owned transaction and local-event identities", () => {
    expect(
      source("../pos/infrastructure/integrations/paymentAllocationService.ts"),
    ).toContain("businessEventKeyPrefix: `pos:${args.posTransactionId}:sale`");
    const offline = source("../pos/application/sync/projectLocalEvents.ts");
    expect(offline).toContain("pos_local:${args.event.localEventId}");
    expect(offline).toContain("payment.localPaymentId");
  });

  it("propagates stable keys through deposits, service, storefront, and corrections", () => {
    expect(source("../cashControls/deposits.ts")).toContain(
      "cash_deposit:${args.registerSessionId}:${submissionKey}",
    );
    expect(source("./serviceIntake.ts")).toContain(
      "service:${createdServiceCase._id}:intake_deposit",
    );
    expect(source("../serviceOps/serviceCases.ts")).toContain(
      "args.businessEventKey ??",
    );
    expect(source("../storeFront/helpers/orderOperations.ts")).toContain(
      "storefront:${args.order._id}:payment_verified",
    );
    expect(source("../storeFront/onlineOrder.ts")).toContain(
      "storefront:${order._id}:refund:${args.reservationId}",
    );
    expect(
      source("../pos/application/commands/adjustTransactionItems.ts"),
    ).toContain("pos_adjustment:${args.adjustmentId}:settlement");
  });
});
