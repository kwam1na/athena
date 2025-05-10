import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { api } from "../../../../_generated/api";
import { Id } from "../../../../_generated/dataModel";
import {
  getStoreDataFromRequest,
  getStorefrontUserFromRequest,
} from "../../../utils";

/**
 * Rating dimension interface defining the structure of a single rating
 */
interface RatingDimension {
  key: string;
  label: string;
  value: number;
  optional?: boolean;
}

/**
 * Review creation request body interface
 */
interface CreateReviewRequest {
  orderId: string;
  orderNumber: string;
  orderItemId: string;
  productId: string;
  productSkuId: string;
  title: string;
  content?: string;
  ratings: RatingDimension[];
}

/**
 * Review update request body interface
 */
interface UpdateReviewRequest {
  title?: string;
  content?: string;
  ratings?: RatingDimension[];
}

const reviewRoutes: HonoWithConvex<ActionCtx> = new Hono();

/**
 * Create a new review
 * POST /reviews
 */
reviewRoutes.post("/", async (c) => {
  try {
    const body = (await c.req.json()) as CreateReviewRequest;
    const userId = getStorefrontUserFromRequest(c);

    const { storeId } = getStoreDataFromRequest(c);

    if (!storeId) {
      return c.json({ error: "Store id missing" }, 404);
    }

    const {
      orderId,
      orderNumber,
      orderItemId,
      productId,
      productSkuId,
      title,
      content,
      ratings,
    } = body;

    if (
      !orderId ||
      !orderItemId ||
      !productId ||
      !productSkuId ||
      !title ||
      !ratings
    ) {
      return c.json({ error: "Missing required fields" }, 400);
    }

    const review = await c.env.runMutation(api.storeFront.reviews.create, {
      orderId: orderId as Id<"onlineOrder">,
      orderNumber,
      orderItemId: orderItemId as Id<"onlineOrderItem">,
      productId: productId as Id<"product">,
      productSkuId: productSkuId as Id<"productSku">,
      storeId: storeId,
      title,
      content,
      ratings,
      createdByStoreFrontUserId: userId as Id<"storeFrontUser"> | Id<"guest">,
    });

    return c.json(review);
  } catch (error) {
    console.error("Failed to create review:", error);
    return c.json({ error: "Failed to create review" }, 500);
  }
});

/**
 * Get review by order item ID
 * GET /reviews/order-item/:orderItemId
 */
reviewRoutes.get("/order-item/:orderItemId", async (c) => {
  try {
    const orderItemId = c.req.param("orderItemId");

    const review = await c.env.runQuery(api.storeFront.reviews.getByOrderItem, {
      orderItemId,
    });

    if (!review) {
      return c.json({ error: "Review not found" }, 404);
    }

    return c.json(review);
  } catch (error) {
    console.error("Failed to fetch review:", error);
    return c.json({ error: "Failed to fetch review" }, 500);
  }
});

/**
 * Update a review
 * PATCH /reviews/:id
 */
reviewRoutes.patch("/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const body = (await c.req.json()) as UpdateReviewRequest;

    const review = await c.env.runMutation(api.storeFront.reviews.update, {
      id: id as Id<"review">,
      ...body,
    });

    return c.json(review);
  } catch (error) {
    console.error("Failed to update review:", error);
    return c.json({ error: "Failed to update review" }, 500);
  }
});

/**
 * Delete a review
 * DELETE /reviews/:id
 */
reviewRoutes.delete("/:id", async (c) => {
  try {
    const id = c.req.param("id");

    await c.env.runMutation(api.storeFront.reviews.deleteReview, {
      id: id as Id<"review">,
    });

    return c.json({ success: true });
  } catch (error) {
    console.error("Failed to delete review:", error);
    return c.json({ error: "Failed to delete review" }, 500);
  }
});

/**
 * Get reviews by product SKU ID
 * GET /reviews/product-sku/:productSkuId
 */
reviewRoutes.get("/product-sku/:productSkuId", async (c) => {
  try {
    const productSkuId = c.req.param("productSkuId");

    const reviews = await c.env.runQuery(
      api.storeFront.reviews.getByProductSkuId,
      {
        productSkuId,
      }
    );

    return c.json(reviews);
  } catch (error) {
    console.error("Failed to fetch reviews:", error);
    return c.json({ error: "Failed to fetch reviews" }, 500);
  }
});

/**
 * Get reviews created by the current user
 * GET /reviews/user
 */
reviewRoutes.get("/user", async (c) => {
  try {
    const userId = getStorefrontUserFromRequest(c);

    if (!userId) {
      return c.json({ error: "User id missing" }, 400);
    }

    const reviews = await c.env.runQuery(api.storeFront.reviews.getByUser, {
      userId: userId as Id<"storeFrontUser"> | Id<"guest">,
    });

    return c.json(reviews);
  } catch (error) {
    console.error("Failed to fetch user reviews:", error);
    return c.json({ error: "Failed to fetch user reviews" }, 500);
  }
});

/**
 * Get reviews created by the current user for a specific product SKU
 * GET /reviews/user/product-sku/:productSkuId
 */
reviewRoutes.get("/user/product-sku/:productSkuId", async (c) => {
  try {
    const userId = getStorefrontUserFromRequest(c);
    const productSkuId = c.req.param("productSkuId");

    if (!userId) {
      return c.json({ error: "User id missing" }, 400);
    }

    const reviews = await c.env.runQuery(
      api.storeFront.reviews.getByUserAndProductSkuId,
      {
        userId: userId as Id<"storeFrontUser"> | Id<"guest">,
        productSkuId: productSkuId as Id<"productSku">,
      }
    );

    return c.json(reviews);
  } catch (error) {
    console.error("Failed to fetch user reviews for product:", error);
    return c.json({ error: "Failed to fetch user reviews for product" }, 500);
  }
});

/**
 * Get reviews by product ID
 * GET /reviews/product/:productId
 */
reviewRoutes.get("/product/:productId", async (c) => {
  try {
    const productId = c.req.param("productId");

    const reviews = await c.env.runQuery(
      api.storeFront.reviews.getByProductId,
      {
        productId,
      }
    );

    return c.json(reviews);
  } catch (error) {
    console.error("Failed to fetch reviews:", error);
    return c.json({ error: "Failed to fetch reviews" }, 500);
  }
});

/**
 * Mark review as helpful
 * POST /reviews/:reviewId/helpful
 */
reviewRoutes.post("/:reviewId/helpful", async (c) => {
  try {
    const reviewId = c.req.param("reviewId");
    const userId = getStorefrontUserFromRequest(c);
    if (!userId) {
      return c.json({ error: "User id missing" }, 400);
    }
    const result = await c.env.runMutation(api.storeFront.reviews.markHelpful, {
      reviewId: reviewId as Id<"review">,
      userId,
    });
    return c.json(result);
  } catch (error) {
    console.error("Failed to mark review as helpful:", error);
    return c.json({ error: "Failed to mark review as helpful" }, 500);
  }
});

export { reviewRoutes };
