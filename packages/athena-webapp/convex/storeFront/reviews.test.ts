// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendFeedbackRequestEmail, getProductName } = vi.hoisted(() => ({
  sendFeedbackRequestEmail: vi.fn(),
  getProductName: vi.fn((sku: any) => sku?.name || "Product"),
}));

function wrapDefinition<T extends { handler: (...args: any[]) => any }>(
  definition: T
) {
  return Object.assign(
    (ctx: unknown, args: unknown) => definition.handler(ctx, args),
    definition
  );
}

function h(fn: any): (...args: any[]) => any {
  return fn.handler;
}

function createDbHarness({
  queryQueues = {},
  records = {},
}: {
  queryQueues?: Record<string, any[]>;
  records?: Record<string, any>;
} = {}) {
  const queueMap = new Map<string, any[]>(
    Object.entries(queryQueues).map(([key, value]) => [key, [...value]])
  );
  const recordMap = new Map<string, any>(Object.entries(records));
  let insertCounter = 0;

  const take = (key: string) => {
    const queue = queueMap.get(key) || [];
    const value = queue.length > 0 ? queue.shift() : undefined;
    queueMap.set(key, queue);
    return value;
  };

  const filterOps = {
    field: vi.fn((name: string) => name),
    eq: vi.fn(() => true),
    and: vi.fn((...values: boolean[]) => values.every(Boolean)),
    or: vi.fn((...values: boolean[]) => values.some(Boolean)),
  };
  const indexOps = {
    eq: vi.fn(() => indexOps),
  };

  const db = {
    query: vi.fn((table: string) => {
      const chain: any = {};
      chain.withIndex = vi.fn(
        (_name: string, callback?: (q: typeof indexOps) => unknown) => {
          if (callback) {
            callback(indexOps);
          }
          return chain;
        }
      );
      chain.filter = vi.fn((callback?: (q: typeof filterOps) => unknown) => {
        if (callback) {
          callback(filterOps);
        }
        return chain;
      });
      chain.order = vi.fn(() => chain);
      chain.collect = vi.fn(async () => take(`${table}:collect`) ?? []);
      chain.first = vi.fn(async () => take(`${table}:first`) ?? null);
      return chain;
    }),
    get: vi.fn(async (id: string) => recordMap.get(id) ?? null),
    insert: vi.fn(async (table: string, value: any) => {
      const id = `${table}_${++insertCounter}`;
      recordMap.set(id, { _id: id, ...value });
      return id;
    }),
    patch: vi.fn(async (id: string, patch: any) => {
      const current = recordMap.get(id) || { _id: id };
      recordMap.set(id, { ...current, ...patch });
      return recordMap.get(id);
    }),
    delete: vi.fn(async (id: string) => {
      recordMap.delete(id);
    }),
  };

  return { db, recordMap };
}

async function loadModule() {
  vi.resetModules();

  vi.doMock("../_generated/server", () => ({
    action: wrapDefinition,
    mutation: wrapDefinition,
    query: wrapDefinition,
  }));

  vi.doMock("../_generated/api", () => ({
    api: {
      storeFront: {
        offers: {
          create: "offers.create",
        },
        onlineOrderItem: {
          get: "onlineOrderItem.get",
          update: "onlineOrderItem.update",
        },
      },
      inventory: {
        productSku: {
          getById: "productSku.getById",
        },
      },
    },
  }));

  vi.doMock("../mailersend", () => ({
    sendFeedbackRequestEmail,
  }));

  vi.doMock("../utils", () => ({
    getProductName,
  }));

  return import("./reviews");
}

function baseCreateArgs() {
  return {
    orderId: "order_1",
    orderNumber: "WIG-1001",
    orderItemId: "order_item_1",
    productId: "product_1",
    productSkuId: "sku_1",
    storeId: "store_1",
    createdByStoreFrontUserId: "user_1",
    title: "Great quality",
    content: "Loved it",
    ratings: [{ key: "quality", label: "Quality", value: 5 }],
  };
}

describe("storeFront reviews", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T12:00:00.000Z"));
    process.env.STORE_URL = "https://shop.example.com";
  });

  it("creates review and sends first-review offer when eligible", async () => {
    const { create } = await loadModule();
    const { db } = createDbHarness({
      queryQueues: {
        "review:collect": [[{ _id: "review_1" }]],
        "offer:first": [null],
      },
      records: {
        store_1: {
          _id: "store_1",
          config: {
            leaveAReviewDiscountCodeModalPromoCode: {
              promoCodeId: "promo_1",
            },
          },
        },
        promo_1: {
          _id: "promo_1",
          code: "WELCOME10",
          active: true,
          validFrom: Date.now() - 1000,
          validTo: Date.now() + 1000,
        },
        user_1: {
          _id: "user_1",
          email: "ada@example.com",
        },
      },
    });

    const ctx = {
      db,
      runMutation: vi.fn(),
    };

    const result = await h(create)(ctx as never, baseCreateArgs() as never);

    expect(result).toBe("review_1");
    expect(ctx.runMutation).toHaveBeenCalledWith("offers.create", {
      email: "ada@example.com",
      promoCodeId: "promo_1",
      storeFrontUserId: "user_1",
      storeId: "store_1",
    });
  });

  it("skips first-review offer for non-first reviews and missing promo config", async () => {
    const { create } = await loadModule();

    const nonFirstHarness = createDbHarness({
      queryQueues: {
        "review:collect": [[{ _id: "r1" }, { _id: "r2" }]],
      },
    });
    const nonFirstCtx = {
      db: nonFirstHarness.db,
      runMutation: vi.fn(),
    };
    await h(create)(nonFirstCtx as never, baseCreateArgs() as never);
    expect(nonFirstCtx.runMutation).not.toHaveBeenCalled();

    const noConfigHarness = createDbHarness({
      queryQueues: {
        "review:collect": [[{ _id: "r1" }]],
      },
      records: {
        store_1: { _id: "store_1", config: {} },
      },
    });
    const noConfigCtx = {
      db: noConfigHarness.db,
      runMutation: vi.fn(),
    };
    await h(create)(noConfigCtx as never, baseCreateArgs() as never);
    expect(noConfigCtx.runMutation).not.toHaveBeenCalled();
  });

  it("skips first-review offer for promo/user/duplicate guard branches", async () => {
    const { create } = await loadModule();

    const missingPromoHarness = createDbHarness({
      queryQueues: {
        "review:collect": [[{ _id: "r1" }]],
      },
      records: {
        store_1: {
          _id: "store_1",
          config: {
            leaveAReviewDiscountCodeModalPromoCode: {
              promoCodeId: "promo_missing",
            },
          },
        },
      },
    });
    await h(create)(
      { db: missingPromoHarness.db, runMutation: vi.fn() } as never,
      baseCreateArgs() as never
    );

    const inactivePromoHarness = createDbHarness({
      queryQueues: {
        "review:collect": [[{ _id: "r1" }]],
      },
      records: {
        store_1: {
          _id: "store_1",
          config: {
            leaveAReviewDiscountCodeModalPromoCode: {
              promoCodeId: "promo_2",
            },
          },
        },
        promo_2: {
          _id: "promo_2",
          active: false,
          validFrom: Date.now() - 1000,
          validTo: Date.now() + 1000,
        },
      },
    });
    await h(create)(
      { db: inactivePromoHarness.db, runMutation: vi.fn() } as never,
      baseCreateArgs() as never
    );

    const noEmailHarness = createDbHarness({
      queryQueues: {
        "review:collect": [[{ _id: "r1" }]],
      },
      records: {
        store_1: {
          _id: "store_1",
          config: {
            leaveAReviewDiscountCodeModalPromoCode: {
              promoCodeId: "promo_3",
            },
          },
        },
        promo_3: {
          _id: "promo_3",
          active: true,
          validFrom: Date.now() - 1000,
          validTo: Date.now() + 1000,
        },
        user_1: { _id: "user_1" },
      },
    });
    await h(create)(
      { db: noEmailHarness.db, runMutation: vi.fn() } as never,
      baseCreateArgs() as never
    );

    const duplicateOfferHarness = createDbHarness({
      queryQueues: {
        "review:collect": [[{ _id: "r1" }]],
        "offer:first": [{ _id: "offer_existing" }],
      },
      records: {
        store_1: {
          _id: "store_1",
          config: {
            leaveAReviewDiscountCodeModalPromoCode: {
              promoCodeId: "promo_4",
            },
          },
        },
        promo_4: {
          _id: "promo_4",
          _creationTime: 1,
          code: "DUPLICATE",
          active: true,
          validFrom: Date.now() - 1000,
          validTo: Date.now() + 1000,
        },
        user_1: { _id: "user_1", email: "ada@example.com" },
      },
    });
    const duplicateCtx = {
      db: duplicateOfferHarness.db,
      runMutation: vi.fn(),
    };
    await h(create)(duplicateCtx as never, baseCreateArgs() as never);
    expect(duplicateCtx.runMutation).not.toHaveBeenCalled();
  });

  it("supports review lookups, moderation, and helpful votes", async () => {
    const mod = await loadModule();
    const { db, recordMap } = createDbHarness({
      queryQueues: {
        "review:first": [{ _id: "review_1" }, { _id: "review_exists" }, null],
        "review:collect": [
          [{ _id: "review_a" }],
          [{ _id: "review_b" }],
          [{ _id: "review_c" }],
          [{ _id: "review_store", productSkuId: "sku_9" }],
          [
            {
              _id: "review_product",
              productSkuId: "sku_10",
              createdByStoreFrontUserId: "user_9",
            },
          ],
          [{ _id: "review_unapproved_1" }, { _id: "review_unapproved_2" }],
        ],
      },
      records: {
        review_vote: {
          _id: "review_vote",
          helpfulCount: 1,
          helpfulUserIds: ["user_1"],
        },
        sku_9: {
          _id: "sku_9",
          images: ["https://cdn.example.com/sku-9.png"],
        },
        user_9: {
          _id: "user_9",
          email: "user9@example.com",
        },
      },
    });

    const byOrderItem = await h(mod.getByOrderItem)({ db } as never, {
      orderItemId: "order_item_1",
    });
    expect(byOrderItem).toEqual({ _id: "review_1" });

    const hasReview = await h(mod.hasReviewForOrderItem)({ db } as never, {
      orderItemId: "order_item_1",
    });
    expect(hasReview).toBe(true);

    const hasUserReview = await h(mod.hasUserReviewForOrderItem)(
      { db } as never,
      {
        orderItemId: "order_item_1",
        userId: "user_1",
      }
    );
    expect(hasUserReview).toBe(false);

    await h(mod.update)({ db } as never, {
      id: "review_1",
      title: "Updated",
      content: "Updated content",
      ratings: [{ key: "quality", label: "Quality", value: 4 }],
    });
    expect(db.patch).toHaveBeenCalledWith(
      "review_1",
      expect.objectContaining({
        title: "Updated",
        content: "Updated content",
      })
    );

    await h(mod.deleteReview)({ db } as never, { id: "review_1" });
    expect(db.delete).toHaveBeenCalledWith("review_1");

    const bySku = await h(mod.getByProductSkuId)({ db } as never, {
      productSkuId: "sku_1",
    });
    expect(bySku).toEqual([{ _id: "review_a" }]);

    const byUser = await h(mod.getByUser)({ db } as never, {
      userId: "user_1",
    });
    expect(byUser).toEqual([{ _id: "review_b" }]);

    const byUserAndSku = await h(mod.getByUserAndProductSkuId)(
      { db } as never,
      {
        userId: "user_1",
        productSkuId: "sku_1",
      }
    );
    expect(byUserAndSku).toEqual([{ _id: "review_c" }]);

    const allStoreReviews = await h(mod.getAllReviewsForStore)(
      { db } as never,
      { storeId: "store_1" }
    );
    expect(allStoreReviews).toEqual([
      {
        _id: "review_store",
        productSkuId: "sku_9",
        productImage: "https://cdn.example.com/sku-9.png",
      },
    ]);

    await h(mod.approve)({ db } as never, { id: "review_1", userId: "athena_1" });
    await h(mod.reject)({ db } as never, { id: "review_1", userId: "athena_1" });
    await h(mod.publish)({ db } as never, { id: "review_1", userId: "athena_1" });
    await h(mod.unpublish)({ db } as never, { id: "review_1", userId: "athena_1" });

    const ctxForProduct = {
      db,
      runQuery: vi.fn().mockResolvedValue({
        _id: "sku_10",
        images: ["https://cdn.example.com/sku-10.png"],
      }),
    };
    const byProduct = await h(mod.getByProductId)(ctxForProduct as never, {
      productId: "product_1",
    });
    expect(byProduct).toEqual([
      expect.objectContaining({
        _id: "review_product",
        productImage: "https://cdn.example.com/sku-10.png",
        user: {
          _id: "user_9",
          email: "user9@example.com",
        },
      }),
    ]);

    const addedHelpful = await h(mod.markHelpful)({ db } as never, {
      reviewId: "review_vote",
      userId: "user_2",
    });
    expect(addedHelpful).toEqual({ helpfulCount: 2 });

    const removedHelpful = await h(mod.markHelpful)({ db } as never, {
      reviewId: "review_vote",
      userId: "user_1",
    });
    expect(removedHelpful).toEqual({ helpfulCount: 1 });

    recordMap.delete("review_vote");
    await expect(
      h(mod.markHelpful)({ db } as never, {
        reviewId: "review_vote",
        userId: "user_3",
      })
    ).rejects.toThrow("Review not found");

    const unapprovedCount = await h(mod.getUnapprovedReviewsCount)(
      { db } as never,
      { storeId: "store_1" }
    );
    expect(unapprovedCount).toBe(2);
  });

  it("handles getByProductId reviews without sku or user ids", async () => {
    const { getByProductId } = await loadModule();
    const { db } = createDbHarness({
      queryQueues: {
        "review:collect": [[{ _id: "review_no_relations", productSkuId: null }]],
      },
    });

    const result = await h(getByProductId)(
      { db, runQuery: vi.fn() } as never,
      {
        productId: "product_1",
      }
    );

    expect(result).toEqual([
      {
        _id: "review_no_relations",
        productSkuId: null,
        productSku: null,
        productImage: null,
        user: null,
      },
    ]);
  });

  it("sends feedback request with all guard paths and success", async () => {
    const { sendFeedbackRequest } = await loadModule();

    const missingOrderCtx = {
      runQuery: vi.fn().mockResolvedValueOnce(null),
      runMutation: vi.fn(),
    };
    const missingOrder = await h(sendFeedbackRequest)(
      missingOrderCtx as never,
      {
        productSkuId: "sku_1",
        customerEmail: "ada@example.com",
        customerName: "Ada",
        orderId: "order_1",
        orderItemId: "order_item_1",
      }
    );
    expect(missingOrder).toEqual({
      success: false,
      error: "Order item not found",
    });

    const alreadyRequestedCtx = {
      runQuery: vi.fn().mockResolvedValueOnce({
        _id: "order_item_1",
        feedbackRequested: true,
      }),
      runMutation: vi.fn(),
    };
    const alreadyRequested = await h(sendFeedbackRequest)(
      alreadyRequestedCtx as never,
      {
        productSkuId: "sku_1",
        customerEmail: "ada@example.com",
        customerName: "Ada",
        orderId: "order_1",
        orderItemId: "order_item_1",
      }
    );
    expect(alreadyRequested).toEqual({
      success: false,
      error: "Feedback has already been requested for this item",
    });

    const missingSkuCtx = {
      runQuery: vi
        .fn()
        .mockResolvedValueOnce({ _id: "order_item_1", feedbackRequested: false })
        .mockResolvedValueOnce(null),
      runMutation: vi.fn(),
    };
    const missingSku = await h(sendFeedbackRequest)(missingSkuCtx as never, {
      productSkuId: "sku_1",
      customerEmail: "ada@example.com",
      customerName: "Ada",
      orderId: "order_1",
      orderItemId: "order_item_1",
    });
    expect(missingSku).toEqual({
      success: false,
      error: "Product SKU not found",
    });

    sendFeedbackRequestEmail.mockResolvedValueOnce({ ok: false });
    const failedEmailCtx = {
      runQuery: vi
        .fn()
        .mockResolvedValueOnce({ _id: "order_item_1", feedbackRequested: false })
        .mockResolvedValueOnce({ _id: "sku_1", name: "Body Wave", images: ["img"] }),
      runMutation: vi.fn(),
    };
    const failedEmail = await h(sendFeedbackRequest)(failedEmailCtx as never, {
      productSkuId: "sku_1",
      customerEmail: "ada@example.com",
      customerName: "Ada",
      orderId: "order_1",
      orderItemId: "order_item_1",
    });
    expect(failedEmail).toEqual({
      success: false,
      error: "Failed to send feedback request email",
    });

    sendFeedbackRequestEmail.mockResolvedValueOnce({ ok: true });
    const successCtx = {
      runQuery: vi
        .fn()
        .mockResolvedValueOnce({ _id: "order_item_1", feedbackRequested: false })
        .mockResolvedValueOnce({
          _id: "sku_1",
          name: "Body Wave",
          images: ["https://cdn.example.com/sku-1.png"],
        }),
      runMutation: vi.fn(),
    };
    const success = await h(sendFeedbackRequest)(successCtx as never, {
      productSkuId: "sku_1",
      customerEmail: "ada@example.com",
      customerName: "Ada",
      orderId: "order_1",
      orderItemId: "order_item_1",
      signedInAthenaUser: {
        id: "athena_1",
        email: "ops@example.com",
      },
    });
    expect(success).toEqual({ success: true });
    expect(successCtx.runMutation).toHaveBeenCalledWith("onlineOrderItem.update", {
      id: "order_item_1",
      updates: expect.objectContaining({
        feedbackRequested: true,
        feedbackRequestedBy: {
          id: "athena_1",
          email: "ops@example.com",
        },
      }),
    });
  });
});
