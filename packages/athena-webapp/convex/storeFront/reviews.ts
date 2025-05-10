import { mutation, query, action } from "../_generated/server";
import { v } from "convex/values";
import { Id } from "../_generated/dataModel";
import { api } from "../_generated/api";
import { sendFeedbackRequestEmail } from "../sendgrid";
import { getProductName } from "../utils";

const entity = "review" as const;

type RatingDimension = {
  key: string;
  label: string;
  value: number;
  optional?: boolean;
};

type UpdateReviewArgs = {
  id: Id<"review">;
  title?: string;
  content?: string;
  ratings?: RatingDimension[];
};

export const create = mutation({
  args: {
    orderId: v.id("onlineOrder"),
    orderNumber: v.string(),
    orderItemId: v.id("onlineOrderItem"),
    productId: v.id("product"),
    productSkuId: v.id("productSku"),
    storeId: v.id("store"),
    createdByStoreFrontUserId: v.union(v.id("storeFrontUser"), v.id("guest")),
    title: v.string(),
    content: v.optional(v.string()),
    ratings: v.array(
      v.object({
        key: v.string(),
        label: v.string(),
        value: v.number(),
        optional: v.optional(v.boolean()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const {
      orderId,
      orderItemId,
      productId,
      productSkuId,
      storeId,
      orderNumber,
      title,
      content,
      ratings,
      createdByStoreFrontUserId,
    } = args;

    const review = await ctx.db.insert(entity, {
      orderId,
      orderNumber,
      orderItemId,
      productId,
      productSkuId,
      storeId,
      createdByStoreFrontUserId,
      title,
      content,
      ratings,
      updatedAt: new Date().getTime(),
    });

    return review;
  },
});

export const getByOrderItem = query({
  args: {
    orderItemId: v.string(),
  },
  handler: async (ctx, args: { orderItemId: string }) => {
    const { orderItemId } = args;

    const review = await ctx.db
      .query(entity)
      .filter((q) => q.eq(q.field("orderItemId"), orderItemId))
      .first();

    return review;
  },
});

export const update = mutation({
  args: {
    id: v.id(entity),
    title: v.optional(v.string()),
    content: v.optional(v.string()),
    ratings: v.optional(
      v.array(
        v.object({
          key: v.string(),
          label: v.string(),
          value: v.number(),
          optional: v.optional(v.boolean()),
        })
      )
    ),
  },
  handler: async (ctx, args: UpdateReviewArgs) => {
    const { id, ...updates } = args;

    const review = await ctx.db.patch(id, {
      ...updates,
      updatedAt: new Date().getTime(),
    });

    return review;
  },
});

export const deleteReview = mutation({
  args: {
    id: v.id(entity),
  },
  handler: async (ctx, args: { id: Id<"review"> }) => {
    const { id } = args;

    await ctx.db.delete(id);
  },
});

export const getByProductSkuId = query({
  args: {
    productSkuId: v.string(),
  },
  handler: async (ctx, args: { productSkuId: string }) => {
    const { productSkuId } = args;

    const reviews = await ctx.db
      .query(entity)
      .filter((q) => q.eq(q.field("productSkuId"), productSkuId))
      .collect();

    return reviews;
  },
});

export const getByUser = query({
  args: {
    userId: v.union(v.id("storeFrontUser"), v.id("guest")),
  },
  handler: async (
    ctx,
    args: { userId: Id<"storeFrontUser"> | Id<"guest"> }
  ) => {
    const { userId } = args;

    const reviews = await ctx.db
      .query(entity)
      .filter((q) => q.eq(q.field("createdByStoreFrontUserId"), userId))
      .collect();

    return reviews;
  },
});

export const getByUserAndProductSkuId = query({
  args: {
    userId: v.union(v.id("storeFrontUser"), v.id("guest")),
    productSkuId: v.id("productSku"),
  },
  handler: async (
    ctx,
    args: { userId: Id<"storeFrontUser"> | Id<"guest">; productSkuId: string }
  ) => {
    const { userId, productSkuId } = args;

    const reviews = await ctx.db
      .query(entity)
      .filter((q) =>
        q.and(
          q.eq(q.field("createdByStoreFrontUserId"), userId),
          q.eq(q.field("productSkuId"), productSkuId)
        )
      )
      .collect();

    return reviews;
  },
});

export const getAllReviewsForStore = query({
  args: {
    storeId: v.id("store"),
  },
  handler: async (ctx, args: { storeId: Id<"store"> }) => {
    const { storeId } = args;

    const reviews = await ctx.db
      .query(entity)
      .filter((q) => q.eq(q.field("storeId"), storeId))
      .order("desc")
      .collect();

    // Add product images to reviews
    const reviewsWithImages = await Promise.all(
      reviews.map(async (review) => {
        const productSku = await ctx.db.get(review.productSkuId);
        return {
          ...review,
          productImage: productSku?.images?.[0] ?? null,
        };
      })
    );

    return reviewsWithImages;
  },
});

export const approve = mutation({
  args: {
    id: v.id(entity),
    userId: v.id("athenaUser"),
  },
  handler: async (
    ctx,
    args: { id: Id<"review">; userId: Id<"athenaUser"> }
  ) => {
    const { id, userId } = args;

    const review = await ctx.db.patch(id, {
      isApproved: true,
      approvedAt: new Date().getTime(),
      approvedByAthenaUserId: userId,
      updatedAt: new Date().getTime(),
    });

    return review;
  },
});

export const reject = mutation({
  args: {
    id: v.id(entity),
    userId: v.id("athenaUser"),
  },
  handler: async (
    ctx,
    args: { id: Id<"review">; userId: Id<"athenaUser"> }
  ) => {
    const { id, userId } = args;

    const review = await ctx.db.patch(id, {
      isApproved: false,
      approvedAt: new Date().getTime(),
      approvedByAthenaUserId: userId,
      updatedAt: new Date().getTime(),
    });

    return review;
  },
});

export const publish = mutation({
  args: {
    id: v.id(entity),
    userId: v.id("athenaUser"),
  },
  handler: async (
    ctx,
    args: { id: Id<"review">; userId: Id<"athenaUser"> }
  ) => {
    const { id, userId } = args;

    const review = await ctx.db.patch(id, {
      isPublished: true,
      publishedAt: new Date().getTime(),
      publishedByAthenaUserId: userId,
      updatedAt: new Date().getTime(),
    });

    return review;
  },
});

export const unpublish = mutation({
  args: {
    id: v.id(entity),
    userId: v.id("athenaUser"),
  },
  handler: async (
    ctx,
    args: { id: Id<"review">; userId: Id<"athenaUser"> }
  ) => {
    const { id, userId } = args;

    const review = await ctx.db.patch(id, {
      isPublished: false,
      publishedAt: undefined,
      publishedByAthenaUserId: undefined,
      updatedAt: new Date().getTime(),
    });

    return review;
  },
});

export const getByProductId = query({
  args: {
    productId: v.string(),
  },
  handler: async (ctx, args: { productId: string }): Promise<any[]> => {
    const { productId } = args;

    const reviews = await ctx.db
      .query(entity)
      .filter((q) =>
        q.and(
          q.eq(q.field("productId"), productId),
          q.eq(q.field("isPublished"), true)
        )
      )
      .order("desc")
      .collect();

    // Add productSku details and user details to reviews
    const reviewsWithExtras: any[] = await Promise.all(
      reviews.map(async (review) => {
        const productSku: any = review.productSkuId
          ? await ctx.runQuery(api.inventory.productSku.getById, {
              id: review.productSkuId,
            })
          : null;
        const user = review.createdByStoreFrontUserId
          ? await ctx.db.get(review.createdByStoreFrontUserId)
          : null;
        return {
          ...review,
          productSku,
          productImage: productSku?.images?.[0] ?? null,
          user: user ? { ...user } : null,
        };
      })
    );

    return reviewsWithExtras;
  },
});

export const markHelpful = mutation({
  args: {
    reviewId: v.id(entity),
    userId: v.union(v.id("storeFrontUser"), v.id("guest")),
  },
  handler: async (ctx, args) => {
    const { reviewId, userId } = args;
    const review = await ctx.db.get(reviewId);
    if (!review) throw new Error("Review not found");

    let helpfulUserIds: (Id<"storeFrontUser"> | Id<"guest">)[] =
      review.helpfulUserIds ?? [];
    let newHelpfulCount = review.helpfulCount ?? 0;
    const alreadyVoted = helpfulUserIds.some((id) => id === userId);

    if (alreadyVoted) {
      // Remove vote
      helpfulUserIds = helpfulUserIds.filter((id) => id !== userId);
      newHelpfulCount = Math.max(0, newHelpfulCount - 1);
    } else {
      // Add vote
      helpfulUserIds.push(userId);
      newHelpfulCount = newHelpfulCount + 1;
    }

    await ctx.db.patch(reviewId, {
      helpfulCount: newHelpfulCount,
      helpfulUserIds,
    });
    return { helpfulCount: newHelpfulCount };
  },
});

export const sendFeedbackRequest = action({
  args: {
    productSkuId: v.id("productSku"),
    customerEmail: v.string(),
    customerName: v.string(),
    orderId: v.id("onlineOrder"),
    orderItemId: v.id("onlineOrderItem"),
    signedInAthenaUser: v.optional(
      v.object({
        id: v.id("athenaUser"),
        email: v.string(),
      })
    ),
  },
  handler: async (ctx, args) => {
    // Get the order item
    const orderItem = await ctx.runQuery(api.storeFront.onlineOrderItem.get, {
      id: args.orderItemId,
    });

    if (!orderItem) {
      return { success: false, error: "Order item not found" };
    }

    if (orderItem.feedbackRequested) {
      return {
        success: false,
        error: "Feedback has already been requested for this item",
      };
    }

    // Get product SKU details
    const productSku = await ctx.runQuery(api.inventory.productSku.getById, {
      id: args.productSkuId,
    });

    if (!productSku) {
      return { success: false, error: "Product SKU not found" };
    }

    const review_url = `${process.env.STORE_URL}/shop/orders/${args.orderId}/${args.orderItemId}/review`;

    // Send feedback request email
    const response = await sendFeedbackRequestEmail({
      customerEmail: args.customerEmail,
      customer_name: args.customerName,
      product_name: getProductName(productSku) || "Product",
      product_image_url: productSku.images?.[0] || "",
      review_url,
    });

    if (!response.ok) {
      return { success: false, error: "Failed to send feedback request email" };
    }

    // Mark the order item as having feedback requested
    await ctx.runMutation(api.storeFront.onlineOrderItem.update, {
      id: args.orderItemId,
      updates: {
        feedbackRequested: true,
        feedbackRequestedAt: new Date().getTime(),
        feedbackRequestedBy: args.signedInAthenaUser,
      },
    });

    return { success: true };
  },
});

export const getUnapprovedReviewsCount = query({
  args: {
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    const { storeId } = args;

    const reviews = await ctx.db
      .query(entity)
      .filter((q) =>
        q.and(
          q.eq(q.field("storeId"), storeId),
          q.or(
            q.eq(q.field("isApproved"), false),
            q.eq(q.field("isApproved"), undefined)
          )
        )
      )
      .collect();

    return reviews.length;
  },
});
