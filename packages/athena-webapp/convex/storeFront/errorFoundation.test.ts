import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ok } from "../../shared/commandResult";
import { assertConformsToExportedReturns } from "../lib/returnValidatorContract";

const mocks = vi.hoisted(() => ({
  processOrderUpdateEmail: vi.fn(),
  sendFeedbackRequestEmail: vi.fn(),
}));

vi.mock("./helpers/orderUpdateEmails", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./helpers/orderUpdateEmails")>();

  return {
    ...actual,
    processOrderUpdateEmail: mocks.processOrderUpdateEmail,
  };
});

vi.mock("../mailersend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../mailersend")>();
  return {
    ...actual,
    sendFeedbackRequestEmail: mocks.sendFeedbackRequestEmail,
  };
});

import { update } from "./onlineOrder";
import { sendOrderUpdateEmail } from "./onlineOrderUtilFns";
import {
  approve,
  hasReviewForOrderItem,
  hasUserReviewForOrderItem,
  publish,
  reject,
  sendFeedbackRequest,
  unpublish,
} from "./reviews";

function getSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function getHandler(definition: unknown) {
  return (definition as { _handler: Function })._handler;
}

describe("storefront error foundation", () => {
  beforeEach(() => {
    mocks.processOrderUpdateEmail.mockReset();
    mocks.sendFeedbackRequestEmail.mockReset();
  });

  it("returns a not_found user_error when an order update targets a missing order", async () => {
    const ctx = {
      auth: {
        getUserIdentity: vi.fn(async () => ({ subject: "auth-user-1" })),
      },
      db: {
        get: vi.fn(async (table: string) => {
          if (table === "users") {
            return { _id: "auth-user-1", email: "operator@example.com" };
          }
          if (table === "athenaUser") {
            return { _id: "athena-user-1", email: "operator@example.com" };
          }
          return null;
        }),
        query: vi.fn((table: string) => {
          if (table === "sharedDemoPrincipal") {
            return {
              withIndex: vi.fn(() => ({
                unique: vi.fn(async () => null),
              })),
            };
          }
          if (table === "athenaUser") {
            return {
              withIndex: vi.fn(() => ({
                first: vi.fn(async () => null),
                take: vi.fn(async () => [
                  {
                    _id: "athena-user-1",
                    email: "operator@example.com",
                    normalizedEmail: "operator@example.com",
                  },
                ]),
              })),
            };
          }
          throw new Error(`Unexpected query table: ${table}`);
        }),
      },
    };

    const result = await getHandler(update)(ctx as never, {
      orderId: "order-1",
      update: { status: "cancelled" },
    } as never);

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "not_found",
        message: "Order not found.",
      },
    });
  });

  it("returns a not_found user_error when a review moderation command targets a missing review", async () => {
    const ctx = {
      db: {
        get: vi.fn(async () => null),
      },
    };

    const result = await getHandler(approve)(ctx as never, {
      id: "review-1",
      userId: "athena-user-1",
    } as never);

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "not_found",
        message: "Review not found.",
      },
    });
  });

  it("returns a precondition_failed user_error when feedback has already been requested", async () => {
    const ctx = {
      runQuery: vi
        .fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce({
          _id: "order-item-1",
          feedbackRequested: true,
        }),
    };

    const result = await getHandler(sendFeedbackRequest)(ctx as never, {
      customerEmail: "customer@example.com",
      customerName: "Ama",
      orderId: "order-1",
      orderItemId: "order-item-1",
      productSkuId: "sku-1",
    } as never);

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message: "Feedback has already been requested for this item.",
      },
    });
  });

  it("maps legacy order-email helper failures into user_error results", async () => {
    mocks.processOrderUpdateEmail.mockResolvedValue({
      success: false,
      message: "No email sent for this status",
    });

    const result = await getHandler(sendOrderUpdateEmail)({
      runQuery: vi.fn(async () => false),
    } as never, {
      newStatus: "completed",
      orderId: "order-1",
    } as never);

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message: "No email sent for this status",
      },
    });
    expect(mocks.processOrderUpdateEmail).toHaveBeenCalledWith(
      expect.anything(),
      { newStatus: "completed", orderId: "order-1" },
      { simulateExternalEffects: false },
    );
  });

  it("records demo feedback requests without sending a customer email", async () => {
    const runMutation = vi.fn(async () => null);
    const ctx = {
      runMutation,
      runQuery: vi
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce({
          _id: "order-item-1",
          feedbackRequested: false,
          orderId: "order-1",
        })
        .mockResolvedValueOnce({ _id: "order-1", storeId: "store-1" })
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce({
          _id: "sku-1",
          images: [],
          productName: "Black soap",
        }),
    };

    const result = await getHandler(sendFeedbackRequest)(ctx as never, {
      customerEmail: "customer@example.com",
      customerName: "Abena Owusu",
      orderId: "order-1",
      orderItemId: "order-item-1",
      productSkuId: "sku-1",
    } as never);

    expect(result).toEqual(ok(null));
    expect(mocks.sendFeedbackRequestEmail).not.toHaveBeenCalled();
    expect(runMutation).toHaveBeenCalledTimes(1);
  });

  it("accepts representative migrated storefront return contracts", () => {
    assertConformsToExportedReturns(sendOrderUpdateEmail, ok({
      message: "Order received email recorded.",
    }));
    assertConformsToExportedReturns(hasReviewForOrderItem, true);
    assertConformsToExportedReturns(hasUserReviewForOrderItem, false);
    assertConformsToExportedReturns(approve, ok(null));
    assertConformsToExportedReturns(reject, ok(null));
    assertConformsToExportedReturns(publish, ok(null));
    assertConformsToExportedReturns(unpublish, ok(null));
    assertConformsToExportedReturns(sendFeedbackRequest, ok(null));
  });

  it("keeps the migrated storefront command surfaces on the shared command-result foundation", () => {
    const onlineOrderSource = getSource("./onlineOrder.ts");
    const paymentSource = getSource("./payment.ts");
    const reviewsSource = getSource("./reviews.ts");
    const utilSource = getSource("./onlineOrderUtilFns.ts");
    const orderViewSource = getSource("../../src/components/orders/OrderView.tsx");
    const orderItemsSource = getSource(
      "../../src/components/orders/OrderItemsView.tsx",
    );
    const emailStatusSource = getSource(
      "../../src/components/orders/EmailStatusView.tsx",
    );
    const refundsSource = getSource("../../src/components/orders/RefundsView.tsx");
    const returnExchangeSource = getSource(
      "../../src/components/orders/ReturnExchangeView.tsx",
    );
    const reviewsViewSource = getSource("../../src/components/reviews/ReviewsView.tsx");

    expect(onlineOrderSource).toContain("commandResultValidator");
    expect(onlineOrderSource).toContain("return ok(");
    expect(onlineOrderSource).toContain("return userError(");

    expect(paymentSource).toContain("commandResultValidator");
    expect(paymentSource).toContain("return ok(");
    expect(paymentSource).toContain("return userError(");

    expect(reviewsSource).toContain("commandResultValidator");
    expect(reviewsSource).toContain("return ok(");
    expect(reviewsSource).toContain("return userError(");

    expect(utilSource).toContain("commandResultValidator");
    expect(utilSource).toContain("return ok(");
    expect(utilSource).toContain("return userError(");

    expect(orderViewSource).toContain("runCommand");
    expect(orderViewSource).toContain("presentCommandToast");

    expect(orderItemsSource).toContain("runCommand");
    expect(orderItemsSource).toContain("presentCommandToast");

    expect(emailStatusSource).toContain("runCommand");
    expect(emailStatusSource).toContain("presentCommandToast");

    expect(refundsSource).toContain("runCommand");
    expect(refundsSource).toContain("presentCommandToast");

    expect(returnExchangeSource).toContain("runCommand");
    expect(returnExchangeSource).toContain("presentCommandToast");

    expect(reviewsViewSource).toContain("runCommand");
    expect(reviewsViewSource).toContain("presentCommandToast");
  });
});
