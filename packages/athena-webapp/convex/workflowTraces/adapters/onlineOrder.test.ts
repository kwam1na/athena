import { describe, expect, it } from "vitest";
import type { Doc, Id } from "../../_generated/dataModel";

import {
  buildOnlineOrderTraceSeed,
  buildSafeExternalReferenceRef,
} from "./onlineOrder";

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
    status: "open",
    storeFrontUserId: "storefront_user_1" as Id<"storeFrontUser">,
    storeId: "store_1" as Id<"store">,
    ...fields,
  };
}

describe("buildOnlineOrderTraceSeed", () => {
  it("creates a stable online order trace seed with order and checkout lookups", () => {
    const seed = buildOnlineOrderTraceSeed({
      order: buildOrder(),
      organizationId: "org_1" as Id<"organization">,
    });

    expect(seed.trace.traceId).toBe("online_order:order_1");
    expect(seed.trace.workflowType).toBe("online_order");
    expect(seed.trace.primaryLookupType).toBe("online_order_id");
    expect(seed.trace.primaryLookupValue).toBe("order_1");
    expect(seed.trace.startedAt).toBe(123);
    expect(seed.trace.title).toBe("Online order ORD-1001");
    expect(seed.lookups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          lookupType: "online_order_id",
          lookupValue: "order_1",
        }),
        expect.objectContaining({
          lookupType: "order_number",
          lookupValue: "ord-1001",
        }),
        expect.objectContaining({
          lookupType: "checkout_session_id",
          lookupValue: "checkout_1",
        }),
      ]),
    );
    expect(seed.subjectRefs).toMatchObject({
      onlineOrderId: "order_1",
      checkoutSessionId: "checkout_1",
      customerProfileId: "customer_1",
      storeFrontUserId: "storefront_user_1",
    });
    expect(seed.eventSource).toBe("workflow.onlineOrder");
  });

  it("uses a safe external reference fingerprint instead of raw provider references", () => {
    const rawReference = "paystack-provider-reference-secret-123456";
    const safeReference = buildSafeExternalReferenceRef(rawReference);
    const seed = buildOnlineOrderTraceSeed({
      order: buildOrder({ externalReference: rawReference }),
    });

    expect(safeReference).toMatch(/^external:[a-z0-9]+:123456$/);
    expect(safeReference).not.toBe(rawReference);
    expect(safeReference).not.toContain("secret");
    expect(seed.lookups).toContainEqual(
      expect.objectContaining({
        lookupType: "external_reference_fingerprint",
        lookupValue: safeReference,
      }),
    );
    expect(Object.values(seed.subjectRefs)).not.toContain(rawReference);
  });

  it("falls back to a fingerprinted transaction id only when no external reference exists", () => {
    const seed = buildOnlineOrderTraceSeed({
      order: buildOrder({
        externalReference: undefined,
        externalTransactionId: "provider-transaction-secret-999999",
      }),
    });

    expect(seed.subjectRefs.safeExternalReference).toMatch(
      /^external:[a-z0-9]+:999999$/,
    );
    expect(seed.subjectRefs.safeExternalReference).not.toContain("secret");
  });
});
