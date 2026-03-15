// @vitest-environment node

import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { reviewRoutes } from "./reviews";
import { rewardsRoutes } from "./rewards";

function cookieHeader(values: Record<string, string>) {
  return Object.entries(values)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

describe("reviewRoutes", () => {
  const app = new Hono().route("/reviews", reviewRoutes);

  it("validates required create-review context", async () => {
    const response = await app.request(
      "http://localhost/reviews",
      {
        method: "POST",
        headers: { Cookie: cookieHeader({ user_id: "user_1" }) },
        body: JSON.stringify({
          orderId: "order_1",
          orderItemId: "item_1",
          productId: "product_1",
          productSkuId: "sku_1",
          title: "Great",
          ratings: [{ key: "quality", label: "Quality", value: 5 }],
        }),
      },
      { runMutation: vi.fn(), runQuery: vi.fn() } as never
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Store id missing" });
  });

  it("creates, updates, and deletes reviews", async () => {
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce({ _id: "review_1" })
      .mockResolvedValueOnce({ _id: "review_1", title: "Updated" })
      .mockResolvedValueOnce({});
    const headers = {
      Cookie: cookieHeader({ user_id: "user_1", store_id: "store_1" }),
    };

    const createResponse = await app.request(
      "http://localhost/reviews",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          orderId: "order_1",
          orderNumber: "A-1001",
          orderItemId: "item_1",
          productId: "product_1",
          productSkuId: "sku_1",
          title: "Great hair",
          content: "Loved the texture.",
          ratings: [{ key: "quality", label: "Quality", value: 5 }],
        }),
      },
      { runMutation, runQuery: vi.fn() } as never
    );

    const updateResponse = await app.request(
      "http://localhost/reviews/review_1",
      {
        method: "PATCH",
        body: JSON.stringify({ title: "Updated" }),
      },
      { runMutation, runQuery: vi.fn() } as never
    );

    const deleteResponse = await app.request(
      "http://localhost/reviews/review_1",
      { method: "DELETE" },
      { runMutation, runQuery: vi.fn() } as never
    );

    expect(createResponse.status).toBe(200);
    expect(updateResponse.status).toBe(200);
    expect(deleteResponse.status).toBe(200);
    expect(runMutation.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        orderId: "order_1",
        orderItemId: "item_1",
        productId: "product_1",
        productSkuId: "sku_1",
        storeId: "store_1",
        createdByStoreFrontUserId: "user_1",
      })
    );
    expect(runMutation.mock.calls[1]?.[1]).toEqual({ id: "review_1", title: "Updated" });
    expect(runMutation.mock.calls[2]?.[1]).toEqual({ id: "review_1" });
  });

  it("returns create-review internal error when mutation throws", async () => {
    const response = await app.request(
      "http://localhost/reviews",
      {
        method: "POST",
        headers: { Cookie: cookieHeader({ user_id: "user_1", store_id: "store_1" }) },
        body: JSON.stringify({
          orderId: "order_1",
          orderNumber: "A-1001",
          orderItemId: "item_1",
          productId: "product_1",
          productSkuId: "sku_1",
          title: "Great hair",
          ratings: [{ key: "quality", label: "Quality", value: 5 }],
        }),
      },
      {
        runMutation: vi.fn().mockRejectedValue(new Error("mutation fail")),
        runQuery: vi.fn(),
      } as never
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to create review" });
  });

  it("checks review existence and user-existence paths", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce([{ _id: "review_1" }])
      .mockResolvedValueOnce([{ _id: "review_2" }]);

    const existsResponse = await app.request(
      "http://localhost/reviews/order-item/item_1/exists",
      { method: "GET" },
      { runMutation: vi.fn(), runQuery } as never
    );

    const userExistsMissingUser = await app.request(
      "http://localhost/reviews/order-item/item_1/user-exists",
      { method: "GET" },
      { runMutation: vi.fn(), runQuery } as never
    );

    const getByOrderItemNotFound = await app.request(
      "http://localhost/reviews/order-item/item_1",
      { method: "GET" },
      { runMutation: vi.fn(), runQuery } as never
    );

    const getBySku = await app.request(
      "http://localhost/reviews/product-sku/sku_1",
      { method: "GET" },
      { runMutation: vi.fn(), runQuery } as never
    );

    const getByUser = await app.request(
      "http://localhost/reviews/user",
      {
        method: "GET",
        headers: { Cookie: cookieHeader({ guest_id: "guest_1" }) },
      },
      { runMutation: vi.fn(), runQuery } as never
    );

    expect(existsResponse.status).toBe(200);
    expect(await existsResponse.json()).toEqual({ exists: true });
    expect(userExistsMissingUser.status).toBe(400);
    expect(await userExistsMissingUser.json()).toEqual({ error: "User id missing" });
    expect(getByOrderItemNotFound.status).toBe(404);
    expect(await getByOrderItemNotFound.json()).toEqual({ error: "Review not found" });
    expect(getBySku.status).toBe(200);
    expect(getByUser.status).toBe(200);
  });

  it("returns success values for user-exists and order-item lookups", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce({ _id: "review_1" });

    const userExists = await app.request(
      "http://localhost/reviews/order-item/item_1/user-exists",
      {
        method: "GET",
        headers: { Cookie: cookieHeader({ guest_id: "guest_1" }) },
      },
      { runMutation: vi.fn(), runQuery } as never
    );
    const orderItemReview = await app.request(
      "http://localhost/reviews/order-item/item_1",
      { method: "GET" },
      { runMutation: vi.fn(), runQuery } as never
    );
    const userMissing = await app.request(
      "http://localhost/reviews/user",
      { method: "GET" },
      { runMutation: vi.fn(), runQuery: vi.fn() } as never
    );

    expect(userExists.status).toBe(200);
    expect(await userExists.json()).toEqual({ exists: true });
    expect(orderItemReview.status).toBe(200);
    expect(await orderItemReview.json()).toEqual({ _id: "review_1" });
    expect(userMissing.status).toBe(400);
    expect(await userMissing.json()).toEqual({ error: "User id missing" });
  });

  it("covers additional review endpoints and failure paths", async () => {
    const missingRequired = await app.request(
      "http://localhost/reviews",
      {
        method: "POST",
        headers: { Cookie: cookieHeader({ user_id: "user_1", store_id: "store_1" }) },
        body: JSON.stringify({
          orderId: "order_1",
          productId: "product_1",
          productSkuId: "sku_1",
          title: "Great",
          ratings: [{ key: "quality", label: "Quality", value: 5 }],
        }),
      },
      { runMutation: vi.fn(), runQuery: vi.fn() } as never
    );
    expect(missingRequired.status).toBe(400);
    expect(await missingRequired.json()).toEqual({ error: "Missing required fields" });

    const queryError = vi.fn().mockRejectedValue(new Error("query fail"));
    const existsError = await app.request(
      "http://localhost/reviews/order-item/item_1/exists",
      { method: "GET" },
      { runMutation: vi.fn(), runQuery: queryError } as never
    );
    expect(existsError.status).toBe(500);
    expect(await existsError.json()).toEqual({
      error: "Failed to check if review exists",
    });

    const userExistsError = await app.request(
      "http://localhost/reviews/order-item/item_1/user-exists",
      {
        method: "GET",
        headers: { Cookie: cookieHeader({ guest_id: "guest_1" }) },
      },
      { runMutation: vi.fn(), runQuery: vi.fn().mockRejectedValue(new Error("fail")) } as never
    );
    expect(userExistsError.status).toBe(500);
    expect(await userExistsError.json()).toEqual({
      error: "Failed to check if user has reviewed",
    });

    const reviewLookupError = await app.request(
      "http://localhost/reviews/order-item/item_1",
      { method: "GET" },
      { runMutation: vi.fn(), runQuery: vi.fn().mockRejectedValue(new Error("fail")) } as never
    );
    expect(reviewLookupError.status).toBe(500);
    expect(await reviewLookupError.json()).toEqual({ error: "Failed to fetch review" });

    const updateError = await app.request(
      "http://localhost/reviews/review_1",
      { method: "PATCH", body: JSON.stringify({ title: "X" }) },
      { runMutation: vi.fn().mockRejectedValue(new Error("fail")), runQuery: vi.fn() } as never
    );
    expect(updateError.status).toBe(500);
    expect(await updateError.json()).toEqual({ error: "Failed to update review" });

    const deleteError = await app.request(
      "http://localhost/reviews/review_1",
      { method: "DELETE" },
      { runMutation: vi.fn().mockRejectedValue(new Error("fail")), runQuery: vi.fn() } as never
    );
    expect(deleteError.status).toBe(500);
    expect(await deleteError.json()).toEqual({ error: "Failed to delete review" });

    const getSkuError = await app.request(
      "http://localhost/reviews/product-sku/sku_1",
      { method: "GET" },
      { runMutation: vi.fn(), runQuery: vi.fn().mockRejectedValue(new Error("fail")) } as never
    );
    expect(getSkuError.status).toBe(500);
    expect(await getSkuError.json()).toEqual({ error: "Failed to fetch reviews" });

    const getUserError = await app.request(
      "http://localhost/reviews/user",
      {
        method: "GET",
        headers: { Cookie: cookieHeader({ guest_id: "guest_1" }) },
      },
      { runMutation: vi.fn(), runQuery: vi.fn().mockRejectedValue(new Error("fail")) } as never
    );
    expect(getUserError.status).toBe(500);
    expect(await getUserError.json()).toEqual({
      error: "Failed to fetch user reviews",
    });

    const userProductMissingUser = await app.request(
      "http://localhost/reviews/user/product-sku/sku_1",
      { method: "GET" },
      { runMutation: vi.fn(), runQuery: vi.fn() } as never
    );
    expect(userProductMissingUser.status).toBe(400);
    expect(await userProductMissingUser.json()).toEqual({ error: "User id missing" });

    const userProductOk = await app.request(
      "http://localhost/reviews/user/product-sku/sku_1",
      {
        method: "GET",
        headers: { Cookie: cookieHeader({ guest_id: "guest_1" }) },
      },
      { runMutation: vi.fn(), runQuery: vi.fn().mockResolvedValue([{ _id: "r1" }]) } as never
    );
    expect(userProductOk.status).toBe(200);

    const userProductErr = await app.request(
      "http://localhost/reviews/user/product-sku/sku_1",
      {
        method: "GET",
        headers: { Cookie: cookieHeader({ guest_id: "guest_1" }) },
      },
      { runMutation: vi.fn(), runQuery: vi.fn().mockRejectedValue(new Error("fail")) } as never
    );
    expect(userProductErr.status).toBe(500);
    expect(await userProductErr.json()).toEqual({
      error: "Failed to fetch user reviews for product",
    });

    const productOk = await app.request(
      "http://localhost/reviews/product/product_1",
      { method: "GET" },
      { runMutation: vi.fn(), runQuery: vi.fn().mockResolvedValue([{ _id: "r2" }]) } as never
    );
    expect(productOk.status).toBe(200);

    const productErr = await app.request(
      "http://localhost/reviews/product/product_1",
      { method: "GET" },
      { runMutation: vi.fn(), runQuery: vi.fn().mockRejectedValue(new Error("fail")) } as never
    );
    expect(productErr.status).toBe(500);
    expect(await productErr.json()).toEqual({ error: "Failed to fetch reviews" });

    const helpfulMissingUser = await app.request(
      "http://localhost/reviews/review_1/helpful",
      { method: "POST" },
      { runMutation: vi.fn(), runQuery: vi.fn() } as never
    );
    expect(helpfulMissingUser.status).toBe(400);
    expect(await helpfulMissingUser.json()).toEqual({ error: "User id missing" });

    const helpfulOk = await app.request(
      "http://localhost/reviews/review_1/helpful",
      {
        method: "POST",
        headers: { Cookie: cookieHeader({ guest_id: "guest_1" }) },
      },
      { runMutation: vi.fn().mockResolvedValue({ success: true }), runQuery: vi.fn() } as never
    );
    expect(helpfulOk.status).toBe(200);

    const helpfulErr = await app.request(
      "http://localhost/reviews/review_1/helpful",
      {
        method: "POST",
        headers: { Cookie: cookieHeader({ guest_id: "guest_1" }) },
      },
      { runMutation: vi.fn().mockRejectedValue(new Error("fail")), runQuery: vi.fn() } as never
    );
    expect(helpfulErr.status).toBe(500);
    expect(await helpfulErr.json()).toEqual({
      error: "Failed to mark review as helpful",
    });
  });
});

describe("rewardsRoutes", () => {
  const app = new Hono().route("/rewards", rewardsRoutes);

  it("returns guest defaults and validates required store for points/tiers", async () => {
    const guestPoints = await app.request(
      "http://localhost/rewards/points",
      { method: "GET", headers: { Cookie: cookieHeader({ guest_id: "guest_1" }) } },
      { runMutation: vi.fn(), runQuery: vi.fn() } as never
    );
    const missingStorePoints = await app.request(
      "http://localhost/rewards/points",
      { method: "GET", headers: { Cookie: cookieHeader({ user_id: "user_1" }) } },
      { runMutation: vi.fn(), runQuery: vi.fn() } as never
    );
    const missingStoreTiers = await app.request(
      "http://localhost/rewards/tiers",
      { method: "GET" },
      { runMutation: vi.fn(), runQuery: vi.fn() } as never
    );

    expect(guestPoints.status).toBe(200);
    expect(await guestPoints.json()).toEqual({ points: 0 });
    expect(missingStorePoints.status).toBe(400);
    expect(await missingStorePoints.json()).toEqual({ error: "Store ID is required" });
    expect(missingStoreTiers.status).toBe(400);

    const redeemMissingStore = await app.request(
      "http://localhost/rewards/redeem",
      {
        method: "POST",
        headers: { Cookie: cookieHeader({ user_id: "user_1" }) },
        body: JSON.stringify({ rewardTierId: "tier_1" }),
      },
      { runMutation: vi.fn(), runQuery: vi.fn() } as never
    );
    expect(redeemMissingStore.status).toBe(400);
    expect(await redeemMissingStore.json()).toEqual({ error: "Store ID is required" });
  });

  it("returns guest defaults for history and auth guards for eligible/award endpoints", async () => {
    const guestHistory = await app.request(
      "http://localhost/rewards/history",
      { method: "GET", headers: { Cookie: cookieHeader({ guest_id: "guest_1" }) } },
      { runMutation: vi.fn(), runQuery: vi.fn() } as never
    );
    const guestEligible = await app.request(
      "http://localhost/rewards/eligible-past-orders?email=ada@example.com",
      { method: "GET", headers: { Cookie: cookieHeader({ guest_id: "guest_1" }) } },
      { runMutation: vi.fn(), runQuery: vi.fn() } as never
    );
    const guestAwardPast = await app.request(
      "http://localhost/rewards/award-past-order",
      {
        method: "POST",
        headers: { Cookie: cookieHeader({ guest_id: "guest_1" }) },
        body: JSON.stringify({ orderId: "order_1" }),
      },
      { runMutation: vi.fn(), runQuery: vi.fn() } as never
    );

    expect(guestHistory.status).toBe(200);
    expect(await guestHistory.json()).toEqual({ transactions: [] });
    expect(guestEligible.status).toBe(401);
    expect(guestAwardPast.status).toBe(401);
  });

  it("serves points, history, tiers, redeem and past-order operations", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce(125)
      .mockResolvedValueOnce([{ id: "tx_1" }])
      .mockResolvedValueOnce([{ id: "tier_1" }])
      .mockResolvedValueOnce([{ id: "order_1" }])
      .mockResolvedValueOnce({ points: 12 });
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true });
    const headers = {
      Cookie: cookieHeader({ user_id: "user_1", store_id: "store_1" }),
    };

    const points = await app.request(
      "http://localhost/rewards/points",
      { method: "GET", headers },
      { runMutation, runQuery } as never
    );
    const history = await app.request(
      "http://localhost/rewards/history",
      { method: "GET", headers },
      { runMutation, runQuery } as never
    );
    const tiers = await app.request(
      "http://localhost/rewards/tiers",
      { method: "GET", headers },
      { runMutation, runQuery } as never
    );
    const redeem = await app.request(
      "http://localhost/rewards/redeem",
      {
        method: "POST",
        headers,
        body: JSON.stringify({ rewardTierId: "tier_1" }),
      },
      { runMutation, runQuery } as never
    );
    const eligible = await app.request(
      "http://localhost/rewards/eligible-past-orders?email=ada@example.com",
      { method: "GET", headers },
      { runMutation, runQuery } as never
    );
    const awardPast = await app.request(
      "http://localhost/rewards/award-past-order",
      {
        method: "POST",
        headers,
        body: JSON.stringify({ orderId: "order_1" }),
      },
      { runMutation, runQuery } as never
    );
    const orderPoints = await app.request(
      "http://localhost/rewards/order-points?orderId=order_1",
      { method: "GET", headers },
      { runMutation, runQuery } as never
    );
    const awardGuest = await app.request(
      "http://localhost/rewards/award-guest-orders",
      {
        method: "POST",
        headers,
        body: JSON.stringify({ userId: "user_1", guestId: "guest_1" }),
      },
      { runMutation, runQuery } as never
    );

    expect(points.status).toBe(200);
    expect(history.status).toBe(200);
    expect(tiers.status).toBe(200);
    expect(redeem.status).toBe(200);
    expect(eligible.status).toBe(200);
    expect(awardPast.status).toBe(200);
    expect(orderPoints.status).toBe(200);
    expect(awardGuest.status).toBe(200);
  });

  it("validates reward endpoints for unauthorized and bad payloads", async () => {
    const unauthorizedRedeem = await app.request(
      "http://localhost/rewards/redeem",
      {
        method: "POST",
        headers: { Cookie: cookieHeader({ guest_id: "guest_1", store_id: "store_1" }) },
        body: JSON.stringify({ rewardTierId: "tier_1" }),
      },
      { runMutation: vi.fn(), runQuery: vi.fn() } as never
    );
    const missingTier = await app.request(
      "http://localhost/rewards/redeem",
      {
        method: "POST",
        headers: { Cookie: cookieHeader({ user_id: "user_1", store_id: "store_1" }) },
        body: JSON.stringify({}),
      },
      { runMutation: vi.fn(), runQuery: vi.fn() } as never
    );
    const missingEmail = await app.request(
      "http://localhost/rewards/eligible-past-orders",
      {
        method: "GET",
        headers: { Cookie: cookieHeader({ user_id: "user_1", store_id: "store_1" }) },
      },
      { runMutation: vi.fn(), runQuery: vi.fn() } as never
    );
    const missingOrderId = await app.request(
      "http://localhost/rewards/award-past-order",
      {
        method: "POST",
        headers: { Cookie: cookieHeader({ user_id: "user_1", store_id: "store_1" }) },
        body: JSON.stringify({}),
      },
      { runMutation: vi.fn(), runQuery: vi.fn() } as never
    );
    const missingOrderPointsId = await app.request(
      "http://localhost/rewards/order-points",
      { method: "GET" },
      { runMutation: vi.fn(), runQuery: vi.fn() } as never
    );
    const orderPointsFailure = await app.request(
      "http://localhost/rewards/order-points?orderId=order_1",
      { method: "GET" },
      { runMutation: vi.fn(), runQuery: vi.fn().mockRejectedValue(new Error("fail")) } as never
    );
    const missingUserInGuestAward = await app.request(
      "http://localhost/rewards/award-guest-orders",
      { method: "POST", body: JSON.stringify({ guestId: "guest_1" }) },
      { runMutation: vi.fn(), runQuery: vi.fn() } as never
    );
    const missingGuestInGuestAward = await app.request(
      "http://localhost/rewards/award-guest-orders",
      { method: "POST", body: JSON.stringify({ userId: "user_1" }) },
      { runMutation: vi.fn(), runQuery: vi.fn() } as never
    );

    expect(unauthorizedRedeem.status).toBe(401);
    expect(missingTier.status).toBe(400);
    expect(missingEmail.status).toBe(400);
    expect(missingOrderId.status).toBe(400);
    expect(missingOrderPointsId.status).toBe(400);
    expect(orderPointsFailure.status).toBe(500);
    expect(missingUserInGuestAward.status).toBe(400);
    expect(missingGuestInGuestAward.status).toBe(400);
  });
});
