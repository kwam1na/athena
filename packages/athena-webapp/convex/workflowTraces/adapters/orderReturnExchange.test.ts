import { describe, expect, it } from "vitest";
import type { Doc, Id } from "../../_generated/dataModel";

import { buildOrderReturnExchangeTraceSeed } from "./orderReturnExchange";

function buildOrder(
  fields: Partial<Doc<"onlineOrder">> = {},
): Pick<
  Doc<"onlineOrder">,
  | "_creationTime"
  | "_id"
  | "checkoutSessionId"
  | "customerProfileId"
  | "deliveryMethod"
  | "externalReference"
  | "externalTransactionId"
  | "orderNumber"
  | "status"
  | "storeFrontUserId"
  | "storeId"
> {
  return {
    _creationTime: 123,
    _id: "order_1" as Id<"onlineOrder">,
    checkoutSessionId: "checkout_1" as Id<"checkoutSession">,
    customerProfileId: "customer_1" as Id<"customerProfile">,
    deliveryMethod: "pickup",
    externalReference: "paystack-provider-reference-secret-123456",
    externalTransactionId: "provider-transaction-secret-999999",
    orderNumber: " ORD-1001 ",
    status: "picked-up",
    storeFrontUserId: "storefront_user_1" as Id<"storeFrontUser">,
    storeId: "store_1" as Id<"store">,
    ...fields,
  };
}

describe("buildOrderReturnExchangeTraceSeed", () => {
  it("creates a linked return/refund/exchange trace with parent order refs", () => {
    const seed = buildOrderReturnExchangeTraceSeed({
      operationRef: "refund-reservation-1",
      order: buildOrder(),
      organizationId: "org_1" as Id<"organization">,
      startedAt: 456,
    });

    expect(seed.trace.traceId).toBe(
      "online_order_return_exchange:order_1:refund-reservation-1",
    );
    expect(seed.trace.workflowType).toBe("online_order_return_exchange");
    expect(seed.trace.primaryLookupType).toBe("return_exchange_ref");
    expect(seed.trace.primaryLookupValue).toBe(
      "order_1:refund-reservation-1",
    );
    expect(seed.trace.details).toEqual({
      parentTraceId: "online_order:order_1",
      parentWorkflowType: "online_order",
      source: "storefront_online_order_return_exchange",
    });
    expect(seed.lookups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          lookupType: "return_exchange_ref",
          lookupValue: "order_1:refund-reservation-1",
        }),
        expect.objectContaining({
          lookupType: "online_order_id",
          lookupValue: "order_1",
        }),
        expect.objectContaining({
          lookupType: "parent_trace_id",
          lookupValue: "online_order:order_1",
        }),
      ]),
    );
    expect(seed.subjectRefs).toMatchObject({
      onlineOrderId: "order_1",
      parentTraceId: "online_order:order_1",
      returnExchangeRef: "order_1:refund-reservation-1",
      safeExternalReference: expect.stringMatching(/^external:[a-z0-9]+:123456$/),
    });
    expect(JSON.stringify(seed)).not.toContain("paystack-provider-reference");
    expect(JSON.stringify(seed)).not.toContain("provider-transaction-secret");
  });
});
