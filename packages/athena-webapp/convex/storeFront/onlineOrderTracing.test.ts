import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Doc, Id } from "../_generated/dataModel";

import {
  appendWorkflowTraceEventWithCtx,
  createWorkflowTraceWithCtx,
  registerWorkflowTraceLookupWithCtx,
} from "../workflowTraces/core";
import {
  recordOnlineOrderReturnExchangeTraceBestEffort,
  recordOnlineOrderTraceBestEffort,
} from "./onlineOrderTracing";

vi.mock("../workflowTraces/core", () => ({
  appendWorkflowTraceEventWithCtx: vi.fn(),
  createWorkflowTraceWithCtx: vi.fn(),
  registerWorkflowTraceLookupWithCtx: vi.fn(),
}));

function buildOrder(fields: Partial<Doc<"onlineOrder">> = {}): Doc<"onlineOrder"> {
  return {
    _creationTime: 100,
    _id: "order_1" as Id<"onlineOrder">,
    amount: 12000,
    bagId: "bag_1" as Id<"bag">,
    billingDetails: null,
    checkoutSessionId: "checkout_1" as Id<"checkoutSession">,
    customerDetails: {
      email: "customer@example.com",
      firstName: "Ada",
      lastName: "Lovelace",
      phoneNumber: "555-0100",
    },
    customerProfileId: "customer_1" as Id<"customerProfile">,
    deliveryDetails: null,
    deliveryFee: 0,
    deliveryInstructions: null,
    deliveryMethod: "pickup",
    deliveryOption: null,
    discount: null,
    externalReference: "paystack-secret-reference-123456",
    externalTransactionId: "provider-secret-999999",
    hasVerifiedPayment: false,
    orderNumber: "ORD-1001",
    paymentDue: 12000,
    pickupLocation: null,
    status: "open",
    storeFrontUserId: "storefront_user_1" as Id<"storeFrontUser">,
    storeId: "store_1" as Id<"store">,
    ...fields,
  };
}

function buildCtx() {
  return {
    db: {
      get: vi.fn(async (table: string) =>
        table === "store"
          ? { _id: "store_1", organizationId: "org_1" }
          : null,
      ),
    },
  };
}

describe("recordOnlineOrderTraceBestEffort", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createWorkflowTraceWithCtx).mockResolvedValue("trace_row_1" as never);
    vi.mocked(registerWorkflowTraceLookupWithCtx).mockResolvedValue(
      "lookup_row_1" as never,
    );
    vi.mocked(appendWorkflowTraceEventWithCtx).mockResolvedValue(
      "event_row_1" as never,
    );
  });

  it("records a payment verification milestone with an event key and minimized refs", async () => {
    const ctx = buildCtx();

    await recordOnlineOrderTraceBestEffort(ctx as never, {
      amount: 12000,
      order: buildOrder({ hasVerifiedPayment: true }),
      paymentMethod: "card",
      signedInAthenaUser: {
        id: "user_1" as Id<"athenaUser">,
        email: "operator@example.com",
      },
      stage: "paymentVerified",
    });

    expect(createWorkflowTraceWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        primarySubjectId: "order_1",
        primarySubjectType: "online_order",
        traceId: "online_order:order_1",
        workflowType: "online_order",
      }),
    );
    expect(registerWorkflowTraceLookupWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        lookupType: "external_reference_fingerprint",
        lookupValue: expect.stringMatching(/^external:[a-z0-9]+:123456$/),
      }),
    );
    expect(appendWorkflowTraceEventWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        actorRefs: { athenaUserId: "user_1" },
        eventKey: "online-order:order_1:payment-verified",
        step: "payment_verified",
        details: {
          amount: 12000,
          method: "card",
          verification: "verified",
        },
        subjectRefs: expect.objectContaining({
          onlineOrderId: "order_1",
          safeExternalReference: expect.stringMatching(
            /^external:[a-z0-9]+:123456$/,
          ),
        }),
      }),
    );

    const event = vi.mocked(appendWorkflowTraceEventWithCtx).mock.calls[0]?.[1] as
      | Record<string, unknown>
      | undefined;
    expect(JSON.stringify(event)).not.toContain("customer@example.com");
    expect(JSON.stringify(event)).not.toContain("operator@example.com");
    expect(JSON.stringify(event)).not.toContain("paystack-secret-reference");
  });

  it("records readiness, fulfillment, and cancellation status milestones", async () => {
    const ctx = buildCtx();

    await recordOnlineOrderTraceBestEffort(ctx as never, {
      nextStatus: "ready-for-pickup",
      order: buildOrder({ status: "ready-for-pickup" }),
      previousStatus: "open",
      stage: "statusChanged",
    });
    await recordOnlineOrderTraceBestEffort(ctx as never, {
      nextStatus: "picked-up",
      order: buildOrder({ status: "picked-up" }),
      previousStatus: "ready-for-pickup",
      stage: "statusChanged",
    });
    await recordOnlineOrderTraceBestEffort(ctx as never, {
      nextStatus: "cancelled",
      order: buildOrder({ status: "cancelled" }),
      previousStatus: "open",
      stage: "statusChanged",
    });

    expect(appendWorkflowTraceEventWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        eventKey: "online-order:order_1:status:ready-for-pickup",
        step: "order_ready",
      }),
    );
    expect(appendWorkflowTraceEventWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        eventKey: "online-order:order_1:status:picked-up",
        step: "order_fulfilled",
      }),
    );
    expect(appendWorkflowTraceEventWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        eventKey: "online-order:order_1:status:cancelled",
        step: "order_cancelled",
        status: "failed",
      }),
    );
  });

  it("does not trace return or refund status subflows", async () => {
    const ctx = buildCtx();

    await recordOnlineOrderTraceBestEffort(ctx as never, {
      nextStatus: "refund-submitted",
      order: buildOrder({ status: "refund-submitted" }),
      previousStatus: "picked-up",
      stage: "statusChanged",
    });

    expect(createWorkflowTraceWithCtx).not.toHaveBeenCalled();
    expect(appendWorkflowTraceEventWithCtx).not.toHaveBeenCalled();
  });

  it("keeps order updates non-blocking when trace writes fail", async () => {
    const ctx = buildCtx();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    vi.mocked(createWorkflowTraceWithCtx).mockRejectedValueOnce(
      new Error("trace unavailable"),
    );
    vi.mocked(registerWorkflowTraceLookupWithCtx).mockRejectedValueOnce(
      new Error("lookup unavailable"),
    );
    vi.mocked(appendWorkflowTraceEventWithCtx).mockRejectedValueOnce(
      new Error("event unavailable"),
    );

    await expect(
      recordOnlineOrderTraceBestEffort(ctx as never, {
        order: buildOrder(),
        stage: "created",
      }),
    ).resolves.toEqual({
      traceCreated: false,
      traceId: "online_order:order_1",
    });
    consoleError.mockRestore();
  });

  it("records linked return/refund/exchange milestones with replay-safe event keys", async () => {
    const ctx = buildCtx();

    await recordOnlineOrderReturnExchangeTraceBestEffort(ctx as never, {
      amount: 9000,
      operationRef: "refund-reservation-1",
      order: buildOrder({ status: "refund-submitted" }),
      refundId: "paystack-secret-refund-123456",
      reservationId: "refund-reservation-1",
      signedInAthenaUser: {
        id: "user_1" as Id<"athenaUser">,
        email: "operator@example.com",
      },
      stage: "refundFinalized",
    });

    expect(createWorkflowTraceWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        details: {
          parentTraceId: "online_order:order_1",
          parentWorkflowType: "online_order",
          source: "storefront_online_order_return_exchange",
        },
        primaryLookupType: "return_exchange_ref",
        primaryLookupValue: "order_1:refund-reservation-1",
        traceId: "online_order_return_exchange:order_1:refund-reservation-1",
        workflowType: "online_order_return_exchange",
      }),
    );
    expect(registerWorkflowTraceLookupWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        lookupType: "parent_trace_id",
        lookupValue: "online_order:order_1",
      }),
    );
    expect(registerWorkflowTraceLookupWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        lookupType: "return_exchange_ref",
        lookupValue: expect.stringMatching(/^order_1:external:[a-z0-9]+:123456$/),
        traceId: "online_order_return_exchange:order_1:refund-reservation-1",
      }),
    );
    expect(appendWorkflowTraceEventWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        actorRefs: { athenaUserId: "user_1" },
        eventKey:
          expect.stringMatching(
            /^online-order-return-exchange:refund-reservation-1:refund_finalized:external:[a-z0-9]+:123456$/,
          ),
        step: "refund_finalized",
        subjectRefs: expect.objectContaining({
          onlineOrderId: "order_1",
          parentTraceId: "online_order:order_1",
          safeRefundRef: expect.stringMatching(/^external:[a-z0-9]+:123456$/),
          refundReservationId: "refund-reservation-1",
        }),
        details: {
          amount: 9000,
          stage: "refundFinalized",
        },
      }),
    );

    const event = vi.mocked(appendWorkflowTraceEventWithCtx).mock.calls[0]?.[1] as
      | Record<string, unknown>
      | undefined;
    expect(JSON.stringify(event)).not.toContain("customer@example.com");
    expect(JSON.stringify(event)).not.toContain("operator@example.com");
    expect(JSON.stringify(event)).not.toContain("paystack-secret-reference");
    expect(JSON.stringify(event)).not.toContain("paystack-secret-refund");
    const lookupValues = vi
      .mocked(registerWorkflowTraceLookupWithCtx)
      .mock.calls.map(([, lookup]) => String((lookup as { lookupValue: string }).lookupValue));
    expect(lookupValues.join(" ")).not.toContain("paystack-secret-refund");
  });

  it("keeps return/refund/exchange commands non-blocking when trace setup fails", async () => {
    const ctx = {
      db: {
        get: vi.fn(async () => {
          throw new Error("store unavailable");
        }),
      },
    };
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await expect(
      recordOnlineOrderReturnExchangeTraceBestEffort(ctx as never, {
        operationRef: "refund-reservation-1",
        order: buildOrder(),
        reservationId: "refund-reservation-1",
        stage: "refundReleased",
      }),
    ).resolves.toBeNull();
    expect(createWorkflowTraceWithCtx).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
