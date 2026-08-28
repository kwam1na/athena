import { afterEach, describe, expect, it, vi } from "vitest";

// Shared-demo payment denial preserves the existing public result envelopes.

const paystackMock = vi.hoisted(() => ({
  initializeTransaction: vi.fn(),
  initiateRefund: vi.fn(),
  verifyTransaction: vi.fn(),
}));
const emailMock = vi.hoisted(() => ({
  sendPODOrderEmails: vi.fn(),
  sendPaymentVerificationEmails: vi.fn(),
}));

vi.mock("../services/paystackService", () => ({
  initializeTransaction: paystackMock.initializeTransaction,
  initiateRefund: paystackMock.initiateRefund,
  verifyTransaction: paystackMock.verifyTransaction,
}));
vi.mock("../services/orderEmailService", () => ({
  sendPODOrderEmails: emailMock.sendPODOrderEmails,
  sendPaymentVerificationEmails: emailMock.sendPaymentVerificationEmails,
}));

import { convexTest } from "convex-test";

import { ok } from "../../shared/commandResult";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { assertConformsToExportedReturns } from "../lib/returnValidatorContract";
import { CUSTOMER_OWNERSHIP_DENIED } from "./customerOwnership";
import {
  autoVerifyUnverifiedPayments,
  createPODOrderInternal,
  createTransactionInternal,
  refundPayment,
} from "./payment";
import {
  getRemainingRefundableBalance,
  resolveServerDeliveryFee,
  resolveRefundAmount,
} from "./helpers/paymentHelpers";

function getHandler(definition: unknown) {
  return (definition as { _handler: Function })._handler;
}

describe("storefront refund money contract", () => {
  it("simulates provider refunds for demo actors while preserving order writes", async () => {
    // The exported handler now opens with the rail's admission mutation, and
    // the demo flag is read from the admitted actor rather than from the
    // retired `enforceSharedDemoActionCapability` return value.
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce({
        actor: { athenaUserId: "demo-user", kind: "shared_demo" },
        constraints: { storeId: "demo-store" },
        decision: { adapter: "shared_demo", outcome: "admitted" },
        operationId: "storeFront/payment.refundPayment",
        provenance: {},
      })
      .mockResolvedValueOnce({
        refundAmount: 2_500,
        reservationId: "reservation-1",
        success: true,
      })
      .mockResolvedValue(true);
    const result = await getHandler(refundPayment)(
      {
        runMutation,
        runQuery: vi.fn(async () => true),
      } as never,
      {
        externalTransactionId: "demo-transaction",
        returnItemsToStock: false,
      } as never,
    );

    expect(result).toEqual(ok({ message: "Refund simulated in the demo." }));
    expect(paystackMock.initiateRefund).not.toHaveBeenCalled();
    // One admission hop plus the two domain writes the contract already had.
    expect(runMutation).toHaveBeenCalledTimes(3);
  });

  it("accepts representative changed payment action return contracts", () => {
    assertConformsToExportedReturns(refundPayment, ok({ message: "Refund queued." }));
  });

  it("computes the remaining refundable balance in minor units", () => {
    expect(
      getRemainingRefundableBalance({
        amount: 10_000,
        deliveryFee: 2_000,
        refunds: [{ amount: 3_500 }],
      }),
    ).toBe(8_500);

    expect(
      getRemainingRefundableBalance({
        amount: 10_000,
        deliveryFee: 2_000,
        paymentDue: 9_000,
        refunds: [{ amount: 3_500 }],
      }),
    ).toBe(5_500);
  });

  it("requires optional refund amounts to be positive integer minor units and within the cap", () => {
    expect(
      resolveRefundAmount({
        remainingRefundableBalance: 5_500,
        requestedAmount: undefined,
      }),
    ).toBe(5_500);

    expect(
      resolveRefundAmount({
        remainingRefundableBalance: 5_500,
        requestedAmount: 2_500,
      }),
    ).toBe(2_500);

    expect(() =>
      resolveRefundAmount({
        remainingRefundableBalance: 5_500,
        requestedAmount: 25.5,
      }),
    ).toThrow(/integer minor-unit/);

    expect(() =>
      resolveRefundAmount({
        remainingRefundableBalance: 5_500,
        requestedAmount: 5_501,
      }),
    ).toThrow(/remaining refundable balance/);
  });
});

describe("storefront payment scheduled-run evidence", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("records no-candidate auto-verify evidence without failing on ledger write errors", async () => {
    const runMutation = vi.fn(async () => {
      throw new Error("ledger unavailable");
    });
    const ctx = {
      runMutation,
      runQuery: vi.fn(async () => []),
    };

    await expect(
      getHandler(autoVerifyUnverifiedPayments)(ctx, {}),
    ).resolves.toBeUndefined();
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        cronFamily: "auto-verify-payments",
        scope: "system",
        outcome: "no_candidates",
      }),
    );
  });

  it("records candidate auto-verify evidence for skipped and successful orders", async () => {
    paystackMock.verifyTransaction.mockResolvedValue({
      data: {
        amount: 10_000,
        status: "success",
      },
    });
    emailMock.sendPaymentVerificationEmails.mockResolvedValue({
      adminNotificationSent: false,
      confirmationSent: false,
    });
    const runMutation = vi.fn(async (_definition, args?: Record<string, unknown>) => {
      if (args && "points" in args) {
        return { success: true };
      }
      return undefined;
    });
    const hydratedOrder = {
      _id: "order-verified",
      amount: 10_000,
      checkoutSessionId: "checkout-verified",
      customerDetails: {
        email: "customer@example.test",
        firstName: "Ama",
        lastName: "Owusu",
      },
      deliveryDetails: "Osu, Accra",
      deliveryFee: 1_000,
      deliveryMethod: "delivery",
      discount: {
        span: "entire-order",
        type: "percentage",
        value: 10,
      },
      externalReference: "paystack-reference-1",
      items: [
        {
          price: 10_000,
          productName: "Hydrated product",
          productSkuId: "sku-1",
          quantity: 1,
        },
      ],
      orderNumber: "ORDER-1",
      storeId: "store-1",
      transitions: [],
    };
    const ctx = {
      runMutation,
      runQuery: vi.fn(async (_definition, args?: Record<string, unknown>) => {
        if (args && "identifier" in args) {
          return hydratedOrder;
        }
        if (args && "id" in args) {
          return { _id: args.id, name: "Osu" };
        }
        return [
          {
            _id: "order-missing-reference",
            amount: 10_000,
            checkoutSessionId: "checkout-missing",
            deliveryFee: 1_000,
            externalReference: null,
            items: [
              {
                price: 10_000,
                productSkuId: "sku-1",
                quantity: 1,
              },
            ],
            storeId: "store-1",
          },
          {
            _id: "order-verified",
            amount: 10_000,
            checkoutSessionId: "checkout-verified",
            deliveryFee: 1_000,
            discount: {
              span: "entire-order",
              type: "percentage",
              value: 10,
            },
            externalReference: "paystack-reference-1",
            storeId: "store-1",
            transitions: [],
          },
        ];
      }),
    };

    await expect(
      getHandler(autoVerifyUnverifiedPayments)(ctx, {}),
    ).resolves.toBeUndefined();

    expect(paystackMock.verifyTransaction).toHaveBeenCalledWith(
      "paystack-reference-1",
    );
    expect(emailMock.sendPaymentVerificationEmails).toHaveBeenCalledWith(
      expect.objectContaining({
        order: hydratedOrder,
      }),
    );
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        cronFamily: "auto-verify-payments",
        scope: "system",
        outcome: "support_only",
        candidateCount: 2,
        processedCount: 2,
        succeededCount: 1,
        failedCount: 0,
        skippedCount: 1,
      }),
    );
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        cronFamily: "auto-verify-payments",
        scope: "store",
        storeId: "store-1",
        outcome: "applied",
        candidateCount: 2,
        processedCount: 2,
        succeededCount: 1,
        failedCount: 0,
        skippedCount: 1,
      }),
    );
  });

  it("records a failed candidate without sending email when the order cannot be hydrated", async () => {
    paystackMock.verifyTransaction.mockResolvedValueOnce({
      data: { amount: 11_000, status: "success" },
    });
    emailMock.sendPaymentVerificationEmails.mockClear();

    const runMutation = vi.fn(async () => undefined);
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce([
        {
          _id: "order-missing",
          amount: 10_000,
          checkoutSessionId: "checkout-missing",
          deliveryFee: 1_000,
          externalReference: "paystack-reference-missing",
          storeId: "store-1",
        },
      ])
      .mockResolvedValueOnce(null);

    await expect(
      getHandler(autoVerifyUnverifiedPayments)({ runMutation, runQuery }, {}),
    ).resolves.toBeUndefined();

    expect(emailMock.sendPaymentVerificationEmails).not.toHaveBeenCalled();
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        cronFamily: "auto-verify-payments",
        failedCount: 1,
        processedCount: 1,
        succeededCount: 0,
      }),
    );
  });
});

describe("storefront delivery fee money contract", () => {
  const storeConfig = {
    commerce: {
      deliveryFees: {
        withinAccra: 1_000,
        otherRegions: 2_500,
        international: 12_000,
      },
    },
  };

  it("derives delivery fees from server-inspected delivery details", () => {
    expect(
      resolveServerDeliveryFee({
        deliveryDetails: { country: "GH", region: "GA" },
        deliveryMethod: "delivery",
        deliveryOption: "within-accra",
        storeConfig,
        subtotal: 10_000,
      }),
    ).toBe(1_000);

    expect(
      resolveServerDeliveryFee({
        deliveryDetails: { country: "GH", region: "AA" },
        deliveryMethod: "delivery",
        deliveryOption: "outside-accra",
        storeConfig,
        subtotal: 10_000,
      }),
    ).toBe(2_500);

    expect(
      resolveServerDeliveryFee({
        deliveryDetails: { country: "US" },
        deliveryMethod: "delivery",
        deliveryOption: "intl",
        storeConfig,
        subtotal: 10_000,
      }),
    ).toBe(12_000);
  });

  it("fails closed when client delivery option conflicts with the address", () => {
    expect(
      resolveServerDeliveryFee({
        deliveryDetails: { country: "GH", region: "AA" },
        deliveryMethod: "delivery",
        deliveryOption: "within-accra",
        storeConfig,
        subtotal: 10_000,
      }),
    ).toBeNull();
  });

  it("fails closed for delivery orders without a resolvable address", () => {
    expect(
      resolveServerDeliveryFee({
        deliveryDetails: null,
        deliveryMethod: "delivery",
        deliveryOption: "within-accra",
        storeConfig,
        subtotal: 10_000,
      }),
    ).toBeNull();
  });
});

/**
 * The internal siblings the admission migration created out of the deleted
 * public `createTransaction` / `createPODOrder` / `verifyPayment` exports.
 *
 * Those exports were the only reachable payment surface before the migration
 * and they carried the `returns` validators this suite asserted against. They
 * are now `internal.*` actions called from `POST /checkout/:checkoutSessionId`
 * and `GET /checkout/verify/:reference`, and the identity they are trusted with
 * arrives as an explicit `owner`. Two properties therefore have to hold, and
 * neither had a test after the move:
 *
 * 1. Each action asserts checkout-session ownership BEFORE any provider call or
 *    order write — a valid session id for another shopper must not reach
 *    Paystack, and must not leave an order row behind.
 * 2. Each still returns what its `returns` validator declares, which is what the
 *    route serialises straight back to the storefront.
 */

const paymentModules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../")
      ? path.replace(/^\.\.\//, "./")
      : path.replace(/^\.\//, "./storeFront/"),
    loader,
  ]),
);

const PAYMENT_DENIED = new RegExp(
  CUSTOMER_OWNERSHIP_DENIED.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
);

const PAYMENT_ORDER_DETAILS = {
  billingDetails: null,
  deliveryDetails: "Osu, Accra",
  deliveryFee: 1_000,
  deliveryMethod: "delivery",
  deliveryOption: "within-accra",
  discount: null,
  pickupLocation: null,
};

async function seedPaymentFixture() {
  const t = convexTest(schema, paymentModules);

  const fixture = await t.run(async (ctx) => {
    const athenaUserId = await ctx.db.insert("athenaUser", {
      email: "operator@test",
      normalizedEmail: "operator@test",
    });
    const organizationId = await ctx.db.insert("organization", {
      createdByUserId: athenaUserId,
      name: "org",
      slug: "org",
    });
    const storeId = await ctx.db.insert("store", {
      createdByUserId: athenaUserId,
      currency: "GHS",
      name: "store",
      organizationId,
      slug: "store",
    });

    const alice = await ctx.db.insert("guest", {
      marker: "alice",
      organizationId,
      storeId,
    });
    const bob = await ctx.db.insert("guest", {
      marker: "bob",
      organizationId,
      storeId,
    });

    async function sessionFor(owner: Id<"guest">) {
      const bagId = await ctx.db.insert("bag", {
        items: [],
        storeFrontUserId: owner,
        storeId,
        updatedAt: Date.now(),
      });
      return await ctx.db.insert("checkoutSession", {
        amount: 10_000,
        bagId,
        billingDetails: null,
        customerDetails: null,
        deliveryDetails: null,
        deliveryFee: null,
        deliveryInstructions: null,
        deliveryOption: null,
        discount: null,
        expiresAt: Date.now() + 60_000,
        hasCompletedCheckoutSession: false,
        hasCompletedPayment: false,
        hasVerifiedPayment: false,
        isFinalizingPayment: false,
        pickupLocation: null,
        storeFrontUserId: owner,
        storeId,
      });
    }

    return {
      alice,
      aliceSession: await sessionFor(alice),
      bob,
      bobSession: await sessionFor(bob),
      storeId,
    };
  });

  return { t, ...fixture };
}

describe("payment internal siblings assert checkout-session ownership", () => {
  it("refuses to initialize a transaction against another shopper's session", async () => {
    const f = await seedPaymentFixture();

    await expect(
      f.t.action(internal.storeFront.payment.createTransactionInternal, {
        amount: 10_000,
        // A valid session id — Bob's. Possession proves nothing.
        checkoutSessionId: f.bobSession,
        customerEmail: "shopper@test.com",
        orderDetails: PAYMENT_ORDER_DETAILS,
        owner: { guestId: f.alice, storeId: f.storeId },
      }),
    ).rejects.toThrow(PAYMENT_DENIED);

    // The provider is never reached, so no money can move.
    expect(paystackMock.initializeTransaction).not.toHaveBeenCalled();
    expect(
      await f.t.run(async (ctx) =>
        // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
        (await ctx.db.query("onlineOrder").collect()).length,
      ),
    ).toBe(0);
  });

  it("refuses to place a POD order against another shopper's session", async () => {
    const f = await seedPaymentFixture();

    await expect(
      f.t.action(internal.storeFront.payment.createPODOrderInternal, {
        amount: 10_000,
        checkoutSessionId: f.bobSession,
        customerEmail: "shopper@test.com",
        orderDetails: {
          ...PAYMENT_ORDER_DETAILS,
          paymentMethod: "payment_on_delivery",
          podPaymentMethod: "cash",
        },
        owner: { guestId: f.alice, storeId: f.storeId },
      }),
    ).rejects.toThrow(PAYMENT_DENIED);

    // No order row, and no customer email announcing one.
    expect(
      await f.t.run(async (ctx) =>
        // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
        (await ctx.db.query("onlineOrder").collect()).length,
      ),
    ).toBe(0);
    expect(emailMock.sendPODOrderEmails).not.toHaveBeenCalled();
  });

  it("refuses a session whose store is not the admitted one", async () => {
    const f = await seedPaymentFixture();

    const otherStoreId = await f.t.run(async (ctx) => {
      const athenaUserId = await ctx.db.insert("athenaUser", {
        email: "other@test",
        normalizedEmail: "other@test",
      });
      const organizationId = await ctx.db.insert("organization", {
        createdByUserId: athenaUserId,
        name: "other-org",
        slug: "other-org",
      });
      return await ctx.db.insert("store", {
        createdByUserId: athenaUserId,
        currency: "GHS",
        name: "other",
        organizationId,
        slug: "other",
      });
    });

    await expect(
      f.t.action(internal.storeFront.payment.createTransactionInternal, {
        amount: 10_000,
        checkoutSessionId: f.aliceSession,
        customerEmail: "shopper@test.com",
        orderDetails: PAYMENT_ORDER_DETAILS,
        // Right shopper, wrong store: the session carries the store, so both
        // halves of the claim have to match.
        owner: { guestId: f.alice, storeId: otherStoreId },
      }),
    ).rejects.toThrow(PAYMENT_DENIED);

    expect(paystackMock.initializeTransaction).not.toHaveBeenCalled();
  });

  it("refuses to verify a payment for a shopper other than the admitted one", async () => {
    const f = await seedPaymentFixture();

    await expect(
      f.t.action(internal.storeFront.payment.verifyPaymentInternal, {
        externalReference: "reference-1",
        // The target id and the admitted owner disagree.
        storeFrontUserId: f.bob,
        owner: { guestId: f.alice, storeId: f.storeId },
      }),
    ).rejects.toThrow(PAYMENT_DENIED);

    expect(paystackMock.verifyTransaction).not.toHaveBeenCalled();
  });

  it("verifies an admitted shopper order by Paystack reference", async () => {
    const f = await seedPaymentFixture();
    const externalReference = "reference-1";

    const orderId = await f.t.run(async (ctx) => {
      const session = await ctx.db.get("checkoutSession", f.aliceSession);
      if (!session) throw new Error("Expected checkout session fixture");

      const id = await ctx.db.insert("onlineOrder", {
        amount: 10_000,
        bagId: session.bagId,
        billingDetails: null,
        checkoutSessionId: f.aliceSession,
        customerDetails: {
          email: "shopper@test.com",
          firstName: "Alice",
          lastName: "Shopper",
          phoneNumber: "0000000000",
        },
        deliveryDetails: "Osu, Accra",
        deliveryFee: 0,
        deliveryInstructions: null,
        deliveryMethod: "delivery",
        deliveryOption: null,
        discount: null,
        externalReference,
        hasVerifiedPayment: false,
        orderNumber: "ORDER-1",
        pickupLocation: null,
        status: "open",
        storeFrontUserId: f.alice,
        storeId: f.storeId,
      });

      await ctx.db.patch("checkoutSession", f.aliceSession, {
        externalReference,
        hasCompletedCheckoutSession: true,
        hasCompletedPayment: true,
        placedOrderId: id,
      });

      return id;
    });

    paystackMock.verifyTransaction.mockResolvedValueOnce({
      data: { amount: 10_000, status: "success" },
    });
    emailMock.sendPaymentVerificationEmails.mockResolvedValueOnce({
      adminNotificationSent: false,
      confirmationSent: false,
    });

    await expect(
      f.t.action(internal.storeFront.payment.verifyPaymentInternal, {
        externalReference,
        storeFrontUserId: f.alice,
        owner: { guestId: f.alice, storeId: f.storeId },
      }),
    ).resolves.toEqual({ verified: true });

    const verified = await f.t.run(async (ctx) => ({
      order: await ctx.db.get("onlineOrder", orderId),
      session: await ctx.db.get("checkoutSession", f.aliceSession),
    }));
    expect(verified.order?.hasVerifiedPayment).toBe(true);
    expect(verified.session?.hasVerifiedPayment).toBe(true);
  });
});

describe("payment internal sibling return contracts", () => {
  it("keeps both createTransaction envelopes the route serialises", () => {
    assertConformsToExportedReturns(createTransactionInternal, {
      access_code: "access-1",
      authorization_url: "https://checkout.paystack.com/access-1",
      reference: "reference-1",
    });
    assertConformsToExportedReturns(createTransactionInternal, {
      message: "Failed to create payment transaction",
      success: false,
    });
  });

  it("keeps the POD order envelope the route serialises", () => {
    assertConformsToExportedReturns(createPODOrderInternal, {
      message: "Order placed.",
      reference: "POD-1",
      success: true,
    });
    assertConformsToExportedReturns(createPODOrderInternal, {
      message: "Session not found",
      success: false,
    });
  });
});
