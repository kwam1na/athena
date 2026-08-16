import {
  mutation,
  query,
  action,
  internalMutation,
  internalQuery,
  MutationCtx,
  QueryCtx,
} from "../_generated/server";
import { v } from "convex/values";
import { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { commandResultValidator } from "../lib/commandResultValidators";
import { sendFeedbackRequestOperationDefinition } from "../operationAdmission/definitions";
import {
  admitPublicAction,
  admitPublicMutation,
  admitPublicQuery,
} from "../platform/operationAdmission";
import {
  approveReviewOperationDefinition,
  createReviewOperationDefinition,
  deleteReviewOperationDefinition,
  markReviewHelpfulOperationDefinition,
  publishReviewOperationDefinition,
  rejectReviewOperationDefinition,
  unpublishReviewOperationDefinition,
  updateReviewOperationDefinition,
} from "../operationAdmission/domains/u7_storefrontOperator_definitions";
import {
  getReviewByOrderItemReadDefinition,
  getUnapprovedReviewsCountReadDefinition,
  hasReviewForOrderItemReadDefinition,
  hasUserReviewForOrderItemReadDefinition,
  listReviewsByProductReadDefinition,
  listReviewsByProductSkuReadDefinition,
  listReviewsByUserAndProductSkuReadDefinition,
  listReviewsByUserReadDefinition,
  listStoreReviewsReadDefinition,
} from "../operationAdmission/domains/u7_storefrontOperator_readDefinitions";
import { sendFeedbackRequestEmail } from "../mailersend";
import { getProductName } from "../utils";
import { ok, userError } from "../../shared/commandResult";

const entity = "review" as const;
const MAX_REVIEWS = 500;

/**
 * The admitted storefront actor, propagated from an HTTP route into an
 * internal callee. Internal functions have no `ctx.operationAdmission`, so the
 * route passes the facts the rail admitted — never anything the client sent.
 * See the storefront_customer decision in the migration plan.
 */
const ownerArg = v.object({
  guestId: v.optional(v.id("guest")),
  storeFrontUserId: v.optional(v.id("storeFrontUser")),
  storeId: v.id("store"),
});

type ReviewOwner = {
  guestId?: Id<"guest">;
  storeFrontUserId?: Id<"storeFrontUser">;
  storeId: Id<"store">;
};

class ReviewOwnershipError extends Error {
  constructor(message = "You do not have access to this review.") {
    super(message);
    this.name = "ReviewOwnershipError";
  }
}

/** The single caller-identity the admitted actor stands for. */
function ownerActorId(owner: ReviewOwner): Id<"storeFrontUser"> | Id<"guest"> {
  const actorId = owner.storeFrontUserId ?? owner.guestId;
  if (!actorId) {
    throw new ReviewOwnershipError("Admitted owner carries no shopper id.");
  }
  return actorId;
}

/**
 * A same-store shopper claim grants nothing beyond "holds this id": every
 * caller-supplied review id is asserted against the admitted actor before the
 * row is read or written.
 */
async function requireOwnedReview(
  ctx: MutationCtx | QueryCtx,
  reviewId: Id<"review">,
  owner: ReviewOwner,
) {
  const review = await ctx.db.get("review", reviewId);
  if (
    !review ||
    review.storeId !== owner.storeId ||
    review.createdByStoreFrontUserId !== ownerActorId(owner)
  ) {
    throw new ReviewOwnershipError();
  }
  return review;
}

async function getStoreFrontActorById(
  ctx: MutationCtx | QueryCtx,
  id: Id<"storeFrontUser"> | Id<"guest">
) {
  try {
    const storeFrontUser = await ctx.db.get(
      "storeFrontUser",
      id as Id<"storeFrontUser">
    );

    if (storeFrontUser) {
      return storeFrontUser;
    }
  } catch {}

  try {
    return await ctx.db.get("guest", id as Id<"guest">);
  } catch {
    return null;
  }
}

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

const createReviewArgs = {
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
};

type CreateReviewArgs = {
  orderId: Id<"onlineOrder">;
  orderNumber: string;
  orderItemId: Id<"onlineOrderItem">;
  productId: Id<"product">;
  productSkuId: Id<"productSku">;
  storeId: Id<"store">;
  createdByStoreFrontUserId: Id<"storeFrontUser"> | Id<"guest">;
  title: string;
  content?: string;
  ratings: RatingDimension[];
};

export const create = mutation({
  args: createReviewArgs,
  handler: admitPublicMutation(
    createReviewOperationDefinition,
    async (ctx: MutationCtx, args: CreateReviewArgs) =>
      createReviewWithCtx(ctx, args),
  ),
});

/**
 * Internal sibling for `POST /reviews`. The store and the review's author come
 * from the admitted actor, never from the request body, and the named order
 * item must belong to the named order inside that store.
 */
export const createInternal = internalMutation({
  args: {
    orderId: v.id("onlineOrder"),
    orderNumber: v.string(),
    orderItemId: v.id("onlineOrderItem"),
    productId: v.id("product"),
    productSkuId: v.id("productSku"),
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
    owner: ownerArg,
  },
  handler: async (ctx, args) => {
    const { owner, ...rest } = args;
    const actorId = ownerActorId(owner);

    const order = await ctx.db.get("onlineOrder", rest.orderId);
    if (
      !order ||
      order.storeId !== owner.storeId ||
      order.storeFrontUserId !== actorId
    ) {
      throw new ReviewOwnershipError("You do not have access to this order.");
    }

    const orderItem = await ctx.db.get("onlineOrderItem", rest.orderItemId);
    if (!orderItem || orderItem.orderId !== rest.orderId) {
      throw new ReviewOwnershipError(
        "Order item does not belong to this order.",
      );
    }

    return await createReviewWithCtx(ctx, {
      ...rest,
      storeId: owner.storeId,
      createdByStoreFrontUserId: actorId,
    });
  },
});

async function createReviewWithCtx(ctx: MutationCtx, args: CreateReviewArgs) {
  {
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

    // Check if this is the user's first review and send them an offer
    const allUserReviews = await ctx.db
      .query(entity)
      .withIndex("by_createdByStoreFrontUserId", (q) =>
        q.eq("createdByStoreFrontUserId", createdByStoreFrontUserId)
      )
      .take(2);

    console.log(
      `[FirstReviewOffer] User ${createdByStoreFrontUserId} has ${allUserReviews.length} review(s)`
    );

    if (allUserReviews.length === 1) {
      console.log(
        `[FirstReviewOffer] This is the user's first review, checking for offer eligibility`
      );

      // This is the user's first review
      const store = await ctx.db.get("store", storeId);
      const promoCodeConfig =
        store?.config?.leaveAReviewDiscountCodeModalPromoCode;

      if (promoCodeConfig?.promoCodeId) {
        console.log(
          `[FirstReviewOffer] Store has leave-a-review promo code configured: ${promoCodeConfig.promoCodeId}`
        );

        // Validate the promo code
        const promoCode = await ctx.db.get(
          "promoCode", promoCodeConfig.promoCodeId as Id<"promoCode">
        );

        if (promoCode) {
          const now = Date.now();
          const isActive = promoCode.active;
          const isValidDate =
            now >= promoCode.validFrom && now <= promoCode.validTo;

          console.log(
            `[FirstReviewOffer] Promo code validation - Active: ${isActive}, Valid date: ${isValidDate} (code: ${promoCode.code})`
          );

          if (isActive && isValidDate) {
            // Get user email (works for both storeFrontUser and guest)
            const user = await getStoreFrontActorById(
              ctx,
              createdByStoreFrontUserId
            );

            if (user?.email) {
              console.log(
                `[FirstReviewOffer] User has email: ${user.email}, checking for duplicate offers`
              );

              // Check for duplicate offer
              const existingOffer = await ctx.db
                .query("offer")
                .withIndex("by_storeFrontUserId_promoCodeId", (q) =>
                  q
                    .eq("storeFrontUserId", createdByStoreFrontUserId)
                    .eq("promoCodeId", promoCode._id)
                )
                .first();

              if (!existingOffer) {
                console.log(
                  `[FirstReviewOffer] No duplicate offer found, creating offer for user ${createdByStoreFrontUserId}`
                );

                // Create the offer
                await ctx.runMutation(internal.storeFront.offers.createInternal, {
                  email: user.email,
                  promoCodeId: promoCode._id,
                  storeFrontUserId: createdByStoreFrontUserId,
                  storeId: storeId,
                });

                console.log(
                  `[FirstReviewOffer] Successfully created offer for user ${createdByStoreFrontUserId} with promo code ${promoCode.code}`
                );
              } else {
                console.log(
                  `[FirstReviewOffer] Skipping offer creation - user already has an offer for this promo code`
                );
              }
            } else {
              console.log(
                `[FirstReviewOffer] Skipping offer creation - user has no email address`
              );
            }
          } else {
            console.log(
              `[FirstReviewOffer] Skipping offer creation - promo code is not active or outside valid date range`
            );
          }
        } else {
          console.log(
            `[FirstReviewOffer] Skipping offer creation - promo code not found in database`
          );
        }
      } else {
        console.log(
          `[FirstReviewOffer] Skipping offer creation - no leave-a-review promo code configured for store`
        );
      }
    } else {
      console.log(
        `[FirstReviewOffer] Skipping offer creation - not the user's first review`
      );
    }

    return review;
  }
}

async function getReviewByOrderItemWithCtx(
  ctx: QueryCtx,
  args: { orderItemId: string },
) {
  const { orderItemId } = args;

  const review = await ctx.db
    .query(entity)
    .withIndex("by_orderItemId", (q) =>
      q.eq("orderItemId", orderItemId as Id<"onlineOrderItem">)
    )
    .first();

  return review;
}

export const getByOrderItem = query({
  args: {
    orderItemId: v.string(),
  },
  handler: admitPublicQuery(
    getReviewByOrderItemReadDefinition,
    getReviewByOrderItemWithCtx,
  ),
});

/** Internal sibling for `GET /reviews/order-item/:orderItemId`. */
export const getByOrderItemInternal = internalQuery({
  args: {
    orderItemId: v.string(),
  },
  handler: getReviewByOrderItemWithCtx,
});

async function hasReviewForOrderItemWithCtx(
  ctx: QueryCtx,
  args: { orderItemId: Id<"onlineOrderItem"> },
) {
  const { orderItemId } = args;

  const review = await ctx.db
    .query(entity)
    .withIndex("by_orderItemId", (q) => q.eq("orderItemId", orderItemId))
    .first();

  return review !== null;
}

export const hasReviewForOrderItem = query({
  args: {
    orderItemId: v.id("onlineOrderItem"),
  },
  returns: v.boolean(),
  handler: admitPublicQuery(
    hasReviewForOrderItemReadDefinition,
    hasReviewForOrderItemWithCtx,
  ),
});

/** Internal sibling for `GET /reviews/order-item/:orderItemId/exists`. */
export const hasReviewForOrderItemInternal = internalQuery({
  args: {
    orderItemId: v.id("onlineOrderItem"),
  },
  returns: v.boolean(),
  handler: hasReviewForOrderItemWithCtx,
});

async function hasUserReviewForOrderItemWithCtx(
  ctx: QueryCtx,
  args: {
    orderItemId: Id<"onlineOrderItem">;
    userId: Id<"storeFrontUser"> | Id<"guest">;
  },
) {
  const { orderItemId, userId } = args;

  const review = await ctx.db
    .query(entity)
    .withIndex("by_orderItemId", (q) => q.eq("orderItemId", orderItemId))
    .filter((q) => q.eq(q.field("createdByStoreFrontUserId"), userId))
    .first();

  return review !== null;
}

export const hasUserReviewForOrderItem = query({
  args: {
    orderItemId: v.id("onlineOrderItem"),
    userId: v.union(v.id("storeFrontUser"), v.id("guest")),
  },
  returns: v.boolean(),
  handler: admitPublicQuery(
    hasUserReviewForOrderItemReadDefinition,
    hasUserReviewForOrderItemWithCtx,
  ),
});

/**
 * Internal sibling for `GET /reviews/order-item/:orderItemId/user-exists`. The
 * shopper whose reviews are counted is the admitted actor, not a `userId` the
 * caller chose.
 */
export const hasUserReviewForOrderItemInternal = internalQuery({
  args: {
    orderItemId: v.id("onlineOrderItem"),
    owner: ownerArg,
  },
  returns: v.boolean(),
  handler: async (ctx, args) =>
    hasUserReviewForOrderItemWithCtx(ctx, {
      orderItemId: args.orderItemId,
      userId: ownerActorId(args.owner),
    }),
});

async function updateReviewWithCtx(ctx: MutationCtx, args: UpdateReviewArgs) {
  const { id, ...updates } = args;

  const review = await ctx.db.patch("review", id, {
    ...updates,
    updatedAt: new Date().getTime(),
  });

  return review;
}

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
  handler: admitPublicMutation(
    updateReviewOperationDefinition,
    async (ctx: MutationCtx, args: UpdateReviewArgs) =>
      updateReviewWithCtx(ctx, args),
  ),
});

/**
 * Internal sibling for `PATCH /reviews/:id`. Establishes the ownership
 * assertion the route never had: a bearer id may only edit its own review, and
 * only inside the store it was admitted for.
 */
export const updateInternal = internalMutation({
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
    owner: ownerArg,
  },
  handler: async (ctx, args) => {
    const { owner, ...updates } = args;
    await requireOwnedReview(ctx, updates.id, owner);
    return await updateReviewWithCtx(ctx, updates);
  },
});

export const deleteReview = mutation({
  args: {
    id: v.id(entity),
  },
  handler: admitPublicMutation(
    deleteReviewOperationDefinition,
    async (ctx: MutationCtx, args: { id: Id<"review"> }) => {
      await ctx.db.delete("review", args.id);
    },
  ),
});

/**
 * Internal sibling for `DELETE /reviews/:id`, with the same ownership
 * assertion as `updateInternal`.
 */
export const deleteReviewInternal = internalMutation({
  args: {
    id: v.id(entity),
    owner: ownerArg,
  },
  handler: async (ctx, args) => {
    await requireOwnedReview(ctx, args.id, args.owner);
    await ctx.db.delete("review", args.id);
  },
});

async function getReviewsByProductSkuIdWithCtx(
  ctx: QueryCtx,
  args: { productSkuId: string },
) {
  const { productSkuId } = args;

  const reviews = await ctx.db
    .query(entity)
    .withIndex("by_productSkuId", (q) =>
      q.eq("productSkuId", productSkuId as Id<"productSku">)
    )
    .take(MAX_REVIEWS);

  return reviews;
}

export const getByProductSkuId = query({
  args: {
    productSkuId: v.string(),
  },
  handler: admitPublicQuery(
    listReviewsByProductSkuReadDefinition,
    getReviewsByProductSkuIdWithCtx,
  ),
});

/** Internal sibling for the anonymous `GET /reviews/product-sku/:productSkuId`. */
export const getByProductSkuIdInternal = internalQuery({
  args: {
    productSkuId: v.string(),
  },
  handler: getReviewsByProductSkuIdWithCtx,
});

async function getReviewsByUserWithCtx(
  ctx: QueryCtx,
  args: { userId: Id<"storeFrontUser"> | Id<"guest"> },
) {
  const { userId } = args;

  const reviews = await ctx.db
    .query(entity)
    .withIndex("by_createdByStoreFrontUserId", (q) =>
      q.eq("createdByStoreFrontUserId", userId)
    )
    .take(MAX_REVIEWS);

  return reviews;
}

export const getByUser = query({
  args: {
    userId: v.union(v.id("storeFrontUser"), v.id("guest")),
  },
  handler: admitPublicQuery(
    listReviewsByUserReadDefinition,
    getReviewsByUserWithCtx,
  ),
});

/**
 * Internal sibling for `GET /reviews/user`. The shopper is the admitted actor,
 * so one bearer id can no longer list another shopper's reviews.
 */
export const getByUserInternal = internalQuery({
  args: {
    owner: ownerArg,
  },
  handler: async (ctx, args) =>
    getReviewsByUserWithCtx(ctx, { userId: ownerActorId(args.owner) }),
});

async function getReviewsByUserAndProductSkuIdWithCtx(
  ctx: QueryCtx,
  args: { userId: Id<"storeFrontUser"> | Id<"guest">; productSkuId: string },
) {
  const { userId, productSkuId } = args;

  const reviews = await ctx.db
    .query(entity)
    .withIndex("by_createdByStoreFrontUserId_productSkuId", (q) =>
      q
        .eq("createdByStoreFrontUserId", userId)
        .eq("productSkuId", productSkuId as Id<"productSku">)
    )
    .take(MAX_REVIEWS);

  return reviews;
}

export const getByUserAndProductSkuId = query({
  args: {
    userId: v.union(v.id("storeFrontUser"), v.id("guest")),
    productSkuId: v.id("productSku"),
  },
  handler: admitPublicQuery(
    listReviewsByUserAndProductSkuReadDefinition,
    getReviewsByUserAndProductSkuIdWithCtx,
  ),
});

/** Internal sibling for `GET /reviews/user/product-sku/:productSkuId`. */
export const getByUserAndProductSkuIdInternal = internalQuery({
  args: {
    productSkuId: v.id("productSku"),
    owner: ownerArg,
  },
  handler: async (ctx, args) =>
    getReviewsByUserAndProductSkuIdWithCtx(ctx, {
      productSkuId: args.productSkuId,
      userId: ownerActorId(args.owner),
    }),
});

export const getAllReviewsForStore = query({
  args: {
    storeId: v.id("store"),
  },
  handler: admitPublicQuery(
    listStoreReviewsReadDefinition,
    async (ctx: QueryCtx, args: { storeId: Id<"store"> }) => {
    const { storeId } = args;

    const reviews = await ctx.db
      .query(entity)
      .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
      .order("desc")
      .take(MAX_REVIEWS);

    // Add product images to reviews
    const reviewsWithImages = await Promise.all(
      reviews.map(async (review) => {
        const productSku = await ctx.db.get("productSku", review.productSkuId);
        return {
          ...review,
          productImage: productSku?.images?.[0] ?? null,
        };
      })
    );

    return reviewsWithImages;
    },
  ),
});

export const approve = mutation({
  args: {
    id: v.id(entity),
    userId: v.id("athenaUser"),
  },
  returns: commandResultValidator(v.null()),
  handler: admitPublicMutation(
    approveReviewOperationDefinition,
    async (
    ctx: MutationCtx,
    args: { id: Id<"review">; userId: Id<"athenaUser"> }
  ) => {
    const { id, userId } = args;

    const review = await ctx.db.get("review", id);

    if (!review) {
      return userError({
        code: "not_found",
        message: "Review not found.",
      });
    }

    await ctx.db.patch("review", id, {
      isApproved: true,
      approvedAt: new Date().getTime(),
      approvedByAthenaUserId: userId,
      updatedAt: new Date().getTime(),
    });

    return ok(null);
    },
  ),
});

export const reject = mutation({
  args: {
    id: v.id(entity),
    userId: v.id("athenaUser"),
  },
  returns: commandResultValidator(v.null()),
  handler: admitPublicMutation(
    rejectReviewOperationDefinition,
    async (
    ctx: MutationCtx,
    args: { id: Id<"review">; userId: Id<"athenaUser"> }
  ) => {
    const { id, userId } = args;

    const review = await ctx.db.get("review", id);

    if (!review) {
      return userError({
        code: "not_found",
        message: "Review not found.",
      });
    }

    await ctx.db.patch("review", id, {
      isApproved: false,
      approvedAt: new Date().getTime(),
      approvedByAthenaUserId: userId,
      updatedAt: new Date().getTime(),
    });

    return ok(null);
    },
  ),
});

export const publish = mutation({
  args: {
    id: v.id(entity),
    userId: v.id("athenaUser"),
  },
  returns: commandResultValidator(v.null()),
  handler: admitPublicMutation(
    publishReviewOperationDefinition,
    async (
    ctx: MutationCtx,
    args: { id: Id<"review">; userId: Id<"athenaUser"> }
  ) => {
    const { id, userId } = args;

    const review = await ctx.db.get("review", id);

    if (!review) {
      return userError({
        code: "not_found",
        message: "Review not found.",
      });
    }

    await ctx.db.patch("review", id, {
      isPublished: true,
      publishedAt: new Date().getTime(),
      publishedByAthenaUserId: userId,
      updatedAt: new Date().getTime(),
    });

    return ok(null);
    },
  ),
});

export const unpublish = mutation({
  args: {
    id: v.id(entity),
    userId: v.id("athenaUser"),
  },
  returns: commandResultValidator(v.null()),
  handler: admitPublicMutation(
    unpublishReviewOperationDefinition,
    async (
    ctx: MutationCtx,
    args: { id: Id<"review">; userId: Id<"athenaUser"> }
  ) => {
    const { id, userId } = args;

    const review = await ctx.db.get("review", id);

    if (!review) {
      return userError({
        code: "not_found",
        message: "Review not found.",
      });
    }

    await ctx.db.patch("review", id, {
      isPublished: false,
      publishedAt: undefined,
      publishedByAthenaUserId: undefined,
      updatedAt: new Date().getTime(),
    });

    return ok(null);
    },
  ),
});

async function getReviewsByProductIdWithCtx(
  ctx: QueryCtx,
  args: { productId: string },
): Promise<any[]> {
  {
    const { productId } = args;

    const reviews = await ctx.db
      .query(entity)
      .withIndex("by_productId", (q) =>
        q.eq("productId", productId as Id<"product">)
      )
      .filter((q) =>
        q.eq(q.field("isPublished"), true)
      )
      .order("desc")
      .take(MAX_REVIEWS);

    // Add productSku details and user details to reviews
    const reviewsWithExtras: any[] = await Promise.all(
      reviews.map(async (review) => {
        const productSku: any = review.productSkuId
          ? await ctx.runQuery(internal.inventory.productSku.retrieve, {
              id: review.productSkuId,
            })
          : null;
        const user = review.createdByStoreFrontUserId
          ? await getStoreFrontActorById(ctx, review.createdByStoreFrontUserId)
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
  }
}

export const getByProductId = query({
  args: {
    productId: v.string(),
  },
  handler: admitPublicQuery(
    listReviewsByProductReadDefinition,
    getReviewsByProductIdWithCtx,
  ),
});

/** Internal sibling for the anonymous `GET /reviews/product/:productId`. */
export const getByProductIdInternal = internalQuery({
  args: {
    productId: v.string(),
  },
  handler: getReviewsByProductIdWithCtx,
});

async function markReviewHelpfulWithCtx(
  ctx: MutationCtx,
  args: {
    reviewId: Id<"review">;
    userId: Id<"storeFrontUser"> | Id<"guest">;
  },
) {
  {
    const { reviewId, userId } = args;
    const review = await ctx.db.get("review", reviewId);
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

    await ctx.db.patch("review", reviewId, {
      helpfulCount: newHelpfulCount,
      helpfulUserIds,
    });
    return { helpfulCount: newHelpfulCount };
  }
}

export const markHelpful = mutation({
  args: {
    reviewId: v.id(entity),
    userId: v.union(v.id("storeFrontUser"), v.id("guest")),
  },
  handler: admitPublicMutation(
    markReviewHelpfulOperationDefinition,
    markReviewHelpfulWithCtx,
  ),
});

/**
 * Internal sibling for `POST /reviews/:reviewId/helpful`. The voter is the
 * admitted actor, and the review must live in the admitted store — a bearer id
 * cannot vote as someone else or reach across stores.
 */
export const markHelpfulInternal = internalMutation({
  args: {
    reviewId: v.id(entity),
    owner: ownerArg,
  },
  handler: async (ctx, args) => {
    const review = await ctx.db.get("review", args.reviewId);
    if (!review || review.storeId !== args.owner.storeId) {
      throw new ReviewOwnershipError("You do not have access to this review.");
    }
    return await markReviewHelpfulWithCtx(ctx, {
      reviewId: args.reviewId,
      userId: ownerActorId(args.owner),
    });
  },
});

type SendFeedbackRequestArgs = {
  customerEmail: string;
  customerName: string;
  orderId: Id<"onlineOrder">;
  orderItemId: Id<"onlineOrderItem">;
  productSkuId: Id<"productSku">;
  signedInAthenaUser?: { email: string; id: Id<"athenaUser"> };
};

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
  returns: commandResultValidator(v.null()),
  // Actions enter the admission rail through the registered internal mutation
  // because they have no `db` of their own; `admitPublicAction` owns that hop,
  // so this site names the definition rather than an operationId string, and
  // the store clamp resolves from the named order at admission time.
  handler: admitPublicAction(
    sendFeedbackRequestOperationDefinition,
    async (ctx, args: SendFeedbackRequestArgs) => {
      const isSharedDemo =
        ctx.operationAdmission.actor.kind === "shared_demo";

      // Get the order item
      const orderItem = await ctx.runQuery(internal.storeFront.onlineOrderItem.get, {
        id: args.orderItemId,
      });

      if (!orderItem) {
        return userError({
          code: "not_found",
          message: "Order item not found.",
        });
      }

      if (orderItem.feedbackRequested) {
        return userError({
          code: "precondition_failed",
          message: "Feedback has already been requested for this item.",
        });
      }

      if (orderItem.orderId !== args.orderId) {
        return userError({
          code: "validation_failed",
          message: "Order item does not belong to this order.",
        });
      }

      // Get product SKU details
      const productSku = await ctx.runQuery(internal.inventory.productSku.retrieve, {
        id: args.productSkuId,
      });

      if (!productSku) {
        return userError({
          code: "not_found",
          message: "Product SKU not found.",
        });
      }

      const review_url = `${process.env.STORE_URL}/shop/orders/${args.orderId}/${args.orderItemId}/review`;

      // Send feedback request email
      const response = isSharedDemo
        ? { ok: true }
        : await sendFeedbackRequestEmail({
            customerEmail: args.customerEmail,
            customer_name: args.customerName,
            product_name: getProductName(productSku) || "Product",
            product_image_url: productSku.images?.[0] || "",
            review_url,
          });

      if (!response.ok) {
        return userError({
          code: "unavailable",
          message: "Failed to send feedback request email.",
        });
      }

      // Mark the order item as having feedback requested
      await ctx.runMutation(internal.storeFront.onlineOrderItem.updateInternal, {
        id: args.orderItemId,
        updates: {
          feedbackRequested: true,
          feedbackRequestedAt: new Date().getTime(),
          feedbackRequestedBy: args.signedInAthenaUser,
        },
      });

      return ok(null);
    },
  ),
});

export const getUnapprovedReviewsCount = query({
  args: {
    storeId: v.id("store"),
  },
  handler: admitPublicQuery(
    getUnapprovedReviewsCountReadDefinition,
    async (ctx: QueryCtx, args: { storeId: Id<"store"> }) => {
    const { storeId } = args;

    const reviews = await ctx.db
      .query(entity)
      .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
      .filter((q) =>
        q.or(
          q.eq(q.field("isApproved"), false),
          q.eq(q.field("isApproved"), undefined)
        )
      )
      .take(MAX_REVIEWS);

    return reviews.length;
    },
  ),
});
