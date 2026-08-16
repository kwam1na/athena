import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { internal } from "../../../../_generated/api";
import { Id } from "../../../../_generated/dataModel";
import {
  admitHttpRead,
  admitHttpRoute,
} from "../../../../platform/operationAdmission";
import {
  createReviewRouteOperationDefinition,
  deleteReviewRouteOperationDefinition,
  markReviewHelpfulRouteOperationDefinition,
  updateReviewRouteOperationDefinition,
} from "../../../../operationAdmission/domains/u10_httpCustomer_definitions";
import {
  getReviewByOrderItemRouteReadDefinition,
  getReviewsByProductRouteReadDefinition,
  getReviewsByProductSkuRouteReadDefinition,
  getUserReviewsByProductSkuRouteReadDefinition,
  getUserReviewsRouteReadDefinition,
  reviewExistsForOrderItemRouteReadDefinition,
  userReviewExistsForOrderItemRouteReadDefinition,
} from "../../../../operationAdmission/domains/u10_httpCustomer_readDefinitions";
import {
  parseIngressJson,
  requireAdmittedCustomerOwner,
} from "./admittedCustomer";

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
 * Per-product review reads stay public — an anonymous shopper must keep seeing
 * them — while anything scoped to "this shopper's reviews" is claim-only and
 * carries `owner`, so the body can no longer nominate whose review is written,
 * edited, deleted or voted on.
 */

/**
 * Create a new review
 * POST /reviews
 */
reviewRoutes.post(
  "/",
  admitHttpRoute(createReviewRouteOperationDefinition, async (c, admitted) => {
    try {
      const body = parseIngressJson<CreateReviewRequest>(admitted);
      // Author and store both come from the admitted claim; `storeId` and
      // `createdByStoreFrontUserId` are no longer arguments at all.
      const owner = requireAdmittedCustomerOwner(admitted);

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

      const review = await c.env.runMutation(
        internal.storeFront.reviews.createInternal,
        {
          orderId: orderId as Id<"onlineOrder">,
          orderNumber,
          orderItemId: orderItemId as Id<"onlineOrderItem">,
          productId: productId as Id<"product">,
          productSkuId: productSkuId as Id<"productSku">,
          title,
          content,
          ratings,
          owner,
        },
      );

      return c.json(review);
    } catch (error) {
      console.error("Failed to create review:", error);
      return c.json({ error: "Failed to create review" }, 500);
    }
  }),
);

/**
 * Check if any review exists for an order item
 * GET /reviews/order-item/:orderItemId/exists
 */
reviewRoutes.get(
  "/order-item/:orderItemId/exists",
  admitHttpRead(reviewExistsForOrderItemRouteReadDefinition, async (c) => {
    try {
      const orderItemId = c.req.param("orderItemId");

      const exists = await c.env.runQuery(
        internal.storeFront.reviews.hasReviewForOrderItemInternal,
        {
          orderItemId: orderItemId as Id<"onlineOrderItem">,
        },
      );

      return c.json({ exists });
    } catch (error) {
      console.error("Failed to check if review exists:", error);
      return c.json({ error: "Failed to check if review exists" }, 500);
    }
  }),
);

/**
 * Check if the current user has reviewed an order item
 * GET /reviews/order-item/:orderItemId/user-exists
 */
reviewRoutes.get(
  "/order-item/:orderItemId/user-exists",
  admitHttpRead(
    userReviewExistsForOrderItemRouteReadDefinition,
    async (c, admitted) => {
      try {
        const orderItemId = c.req.param("orderItemId");

        const exists = await c.env.runQuery(
          internal.storeFront.reviews.hasUserReviewForOrderItemInternal,
          {
            orderItemId: orderItemId as Id<"onlineOrderItem">,
            owner: requireAdmittedCustomerOwner(admitted),
          },
        );

        return c.json({ exists });
      } catch (error) {
        console.error("Failed to check if user has reviewed:", error);
        return c.json({ error: "Failed to check if user has reviewed" }, 500);
      }
    },
  ),
);

/**
 * Get review by order item ID
 * GET /reviews/order-item/:orderItemId
 */
reviewRoutes.get(
  "/order-item/:orderItemId",
  admitHttpRead(getReviewByOrderItemRouteReadDefinition, async (c) => {
    try {
      const orderItemId = c.req.param("orderItemId");

      const review = await c.env.runQuery(
        internal.storeFront.reviews.getByOrderItemInternal,
        { orderItemId },
      );

      if (!review) {
        return c.json({ error: "Review not found" }, 404);
      }

      return c.json(review);
    } catch (error) {
      console.error("Failed to fetch review:", error);
      return c.json({ error: "Failed to fetch review" }, 500);
    }
  }),
);

/**
 * Update a review
 * PATCH /reviews/:id
 */
reviewRoutes.patch(
  "/:id",
  admitHttpRoute(updateReviewRouteOperationDefinition, async (c, admitted) => {
    try {
      const id = c.req.param("id");
      const body = parseIngressJson<UpdateReviewRequest>(admitted);

      const review = await c.env.runMutation(
        internal.storeFront.reviews.updateInternal,
        {
          id: id as Id<"review">,
          title: body.title,
          content: body.content,
          ratings: body.ratings,
          owner: requireAdmittedCustomerOwner(admitted),
        },
      );

      return c.json(review);
    } catch (error) {
      console.error("Failed to update review:", error);
      return c.json({ error: "Failed to update review" }, 500);
    }
  }),
);

/**
 * Delete a review
 * DELETE /reviews/:id
 */
reviewRoutes.delete(
  "/:id",
  admitHttpRoute(deleteReviewRouteOperationDefinition, async (c, admitted) => {
    try {
      const id = c.req.param("id");

      await c.env.runMutation(
        internal.storeFront.reviews.deleteReviewInternal,
        {
          id: id as Id<"review">,
          owner: requireAdmittedCustomerOwner(admitted),
        },
      );

      return c.json({ success: true });
    } catch (error) {
      console.error("Failed to delete review:", error);
      return c.json({ error: "Failed to delete review" }, 500);
    }
  }),
);

/**
 * Get reviews by product SKU ID
 * GET /reviews/product-sku/:productSkuId
 */
reviewRoutes.get(
  "/product-sku/:productSkuId",
  admitHttpRead(getReviewsByProductSkuRouteReadDefinition, async (c) => {
    try {
      const productSkuId = c.req.param("productSkuId");

      const reviews = await c.env.runQuery(
        internal.storeFront.reviews.getByProductSkuIdInternal,
        { productSkuId },
      );

      return c.json(reviews);
    } catch (error) {
      console.error("Failed to fetch reviews:", error);
      return c.json({ error: "Failed to fetch reviews" }, 500);
    }
  }),
);

/**
 * Get reviews created by the current user
 * GET /reviews/user
 */
reviewRoutes.get(
  "/user",
  admitHttpRead(getUserReviewsRouteReadDefinition, async (c, admitted) => {
    try {
      const reviews = await c.env.runQuery(
        internal.storeFront.reviews.getByUserInternal,
        { owner: requireAdmittedCustomerOwner(admitted) },
      );

      return c.json(reviews);
    } catch (error) {
      console.error("Failed to fetch user reviews:", error);
      return c.json({ error: "Failed to fetch user reviews" }, 500);
    }
  }),
);

/**
 * Get reviews created by the current user for a specific product SKU
 * GET /reviews/user/product-sku/:productSkuId
 */
reviewRoutes.get(
  "/user/product-sku/:productSkuId",
  admitHttpRead(
    getUserReviewsByProductSkuRouteReadDefinition,
    async (c, admitted) => {
      try {
        const productSkuId = c.req.param("productSkuId");

        const reviews = await c.env.runQuery(
          internal.storeFront.reviews.getByUserAndProductSkuIdInternal,
          {
            productSkuId: productSkuId as Id<"productSku">,
            owner: requireAdmittedCustomerOwner(admitted),
          },
        );

        return c.json(reviews);
      } catch (error) {
        console.error("Failed to fetch user reviews for product:", error);
        return c.json({ error: "Failed to fetch user reviews for product" }, 500);
      }
    },
  ),
);

/**
 * Get reviews by product ID
 * GET /reviews/product/:productId
 */
reviewRoutes.get(
  "/product/:productId",
  admitHttpRead(getReviewsByProductRouteReadDefinition, async (c) => {
    try {
      const productId = c.req.param("productId");

      const reviews = await c.env.runQuery(
        internal.storeFront.reviews.getByProductIdInternal,
        { productId },
      );

      return c.json(reviews);
    } catch (error) {
      console.error("Failed to fetch reviews:", error);
      return c.json({ error: "Failed to fetch reviews" }, 500);
    }
  }),
);

/**
 * Mark review as helpful
 * POST /reviews/:reviewId/helpful
 */
reviewRoutes.post(
  "/:reviewId/helpful",
  admitHttpRoute(
    markReviewHelpfulRouteOperationDefinition,
    async (c, admitted) => {
      try {
        const reviewId = c.req.param("reviewId");

        const result = await c.env.runMutation(
          internal.storeFront.reviews.markHelpfulInternal,
          {
            reviewId: reviewId as Id<"review">,
            owner: requireAdmittedCustomerOwner(admitted),
          },
        );
        return c.json(result);
      } catch (error) {
        console.error("Failed to mark review as helpful:", error);
        return c.json({ error: "Failed to mark review as helpful" }, 500);
      }
    },
  ),
);

export { reviewRoutes };
