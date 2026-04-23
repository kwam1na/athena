import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  processOrderUpdateEmail: vi.fn(),
}));

vi.mock("./helpers/orderUpdateEmails", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./helpers/orderUpdateEmails")>();

  return {
    ...actual,
    processOrderUpdateEmail: mocks.processOrderUpdateEmail,
  };
});

import { update } from "./onlineOrder";
import { sendOrderUpdateEmail } from "./onlineOrderUtilFns";
import { approve, sendFeedbackRequest } from "./reviews";

function getSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function getHandler(definition: unknown) {
  return (definition as { _handler: Function })._handler;
}

describe("storefront error foundation", () => {
  beforeEach(() => {
    mocks.processOrderUpdateEmail.mockReset();
  });

  it("returns a not_found user_error when an order update targets a missing order", async () => {
    const ctx = {
      db: {
        get: vi.fn(async () => null),
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
      runQuery: vi.fn(async () => ({
        _id: "order-item-1",
        feedbackRequested: true,
      })),
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

    const result = await getHandler(sendOrderUpdateEmail)({} as never, {
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
