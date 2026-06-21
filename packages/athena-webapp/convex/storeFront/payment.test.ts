import { afterEach, describe, expect, it, vi } from "vitest";

const paystackMock = vi.hoisted(() => ({
  verifyTransaction: vi.fn(),
}));
const emailMock = vi.hoisted(() => ({
  sendPaymentVerificationEmails: vi.fn(),
}));

vi.mock("../services/paystackService", () => ({
  initializeTransaction: vi.fn(),
  initiateRefund: vi.fn(),
  verifyTransaction: paystackMock.verifyTransaction,
}));
vi.mock("../services/orderEmailService", () => ({
  sendPODOrderEmails: vi.fn(),
  sendPaymentVerificationEmails: emailMock.sendPaymentVerificationEmails,
}));

import { ok } from "../../shared/commandResult";
import { assertConformsToExportedReturns } from "../lib/returnValidatorContract";
import {
  createPODOrder,
  createTransaction,
  autoVerifyUnverifiedPayments,
  refundPayment,
  verifyPayment,
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
  it("accepts representative changed payment action return contracts", () => {
    assertConformsToExportedReturns(createTransaction, {
      access_code: "access-code",
      authorization_url: "https://pay.example/authorize",
      reference: "payment-reference",
    });
    assertConformsToExportedReturns(createPODOrder, {
      success: true,
      message: "Order created.",
      reference: "pod-reference",
    });
    assertConformsToExportedReturns(verifyPayment, { verified: true });
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
        amount: 11_000,
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
    const ctx = {
      runMutation,
      runQuery: vi.fn(async (_definition, args?: Record<string, unknown>) => {
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
            externalReference: "paystack-reference-1",
            items: [
              {
                price: 10_000,
                productSkuId: "sku-1",
                quantity: 1,
              },
            ],
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
