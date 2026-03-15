// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  sendDiscountCodeEmail,
  sendDiscountReminderEmail,
  getProductDiscountValue,
  getProductName,
} = vi.hoisted(() => ({
  sendDiscountCodeEmail: vi.fn(),
  sendDiscountReminderEmail: vi.fn(),
  getProductDiscountValue: vi.fn(() => 100),
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
    }),
  };

  return { db, recordMap };
}

async function loadModule() {
  vi.resetModules();

  vi.doMock("../_generated/server", () => ({
    internalAction: wrapDefinition,
    internalMutation: wrapDefinition,
    mutation: wrapDefinition,
    query: wrapDefinition,
  }));

  vi.doMock("../_generated/api", () => ({
    api: {
      storeFront: {
        offers: {
          getById: "offers.getById",
          getAll: "offers.getAll",
        },
        user: {
          getLastViewedProducts: "user.getLastViewedProducts",
        },
      },
      inventory: {
        promoCode: {
          getById: "promoCode.getById",
        },
        stores: {
          getById: "stores.getById",
        },
        bestSeller: {
          getAll: "bestSeller.getAll",
        },
      },
    },
    internal: {
      storeFront: {
        offers: {
          sendOfferEmail: "offers.sendOfferEmail",
          sendOfferReminderEmail: "offers.sendOfferReminderEmail",
          updateStatus: "offers.updateStatus",
        },
      },
    },
  }));

  vi.doMock("../mailersend", () => ({
    sendDiscountCodeEmail,
    sendDiscountReminderEmail,
  }));

  vi.doMock("../utils", () => ({
    currencyFormatter: (currency: string) => ({
      format: (value: number) => `${currency} ${value}`,
    }),
    getProductName,
  }));

  vi.doMock("../inventory/utils", () => ({
    getProductDiscountValue,
  }));

  return import("./offers");
}

describe("storeFront offers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STORE_URL = "https://shop.example.com";
  });

  it("creates offers with validation, duplicate guard, and success flow", async () => {
    const { create } = await loadModule();

    const invalidCtx = {
      db: createDbHarness().db,
      scheduler: { runAfter: vi.fn() },
    };
    const invalid = await create.handler(invalidCtx as never, {
      email: "not-an-email",
      promoCodeId: "promo_1",
      storeFrontUserId: "user_1",
      storeId: "store_1",
      ipAddress: "127.0.0.1",
    });
    expect(invalid).toEqual({
      success: false,
      message: "Invalid email address",
    });

    const duplicateHarness = createDbHarness({
      queryQueues: {
        "offer:first": [{ _id: "offer_existing" }],
      },
    });
    const duplicateCtx = {
      db: duplicateHarness.db,
      scheduler: { runAfter: vi.fn() },
    };
    const duplicate = await create.handler(duplicateCtx as never, {
      email: "ada@example.com",
      promoCodeId: "promo_1",
      storeFrontUserId: "user_1",
      storeId: "store_1",
      ipAddress: "127.0.0.1",
    });
    expect(duplicate).toEqual({
      success: false,
      message: "You've already requested this offer.",
    });

    const successHarness = createDbHarness({
      queryQueues: {
        "offer:first": [null],
      },
    });
    const successCtx = {
      db: successHarness.db,
      scheduler: { runAfter: vi.fn().mockResolvedValue(undefined) },
    };
    const success = await create.handler(successCtx as never, {
      email: "ada@example.com",
      promoCodeId: "promo_1",
      storeFrontUserId: "user_1",
      storeId: "store_1",
      ipAddress: "127.0.0.1",
    });
    expect(success).toEqual({
      success: true,
      message: "Offer requested successfully!",
    });
    expect(successCtx.scheduler.runAfter).toHaveBeenCalledWith(
      0,
      "offers.sendOfferEmail",
      {
        offerId: "offer_1",
      }
    );
    expect(successHarness.db.patch).toHaveBeenCalledWith("user_1", {
      email: "ada@example.com",
    });
  });

  it("sends offer emails across missing/promo/success/error paths", async () => {
    const { sendOfferEmail } = await loadModule();

    const missingOfferCtx = {
      runQuery: vi.fn().mockResolvedValue(null),
      runMutation: vi.fn(),
    };
    const missingOffer = await sendOfferEmail.handler(missingOfferCtx as never, {
      offerId: "offer_1",
    });
    expect(missingOffer).toEqual({
      success: false,
      message: "Offer not found or already processed",
    });

    const missingPromoCtx = {
      runQuery: vi
        .fn()
        .mockResolvedValueOnce({
          _id: "offer_1",
          status: "pending",
          email: "ada@example.com",
          promoCodeId: "promo_missing",
          storeId: "store_1",
          storeFrontUserId: "user_1",
        })
        .mockResolvedValueOnce(null),
      runMutation: vi.fn(),
    };
    const missingPromo = await sendOfferEmail.handler(missingPromoCtx as never, {
      offerId: "offer_1",
    });
    expect(missingPromo).toEqual({
      success: false,
      message: "Promo code not found",
    });
    expect(missingPromoCtx.runMutation).toHaveBeenCalledWith("offers.updateStatus", {
      id: "offer_1",
      status: "error",
      errorMessage: "Promo code not found",
    });

    sendDiscountCodeEmail.mockResolvedValueOnce({ ok: true });
    const successCtx = {
      runQuery: vi
        .fn()
        .mockResolvedValueOnce({
          _id: "offer_2",
          status: "pending",
          email: "ada@example.com",
          promoCodeId: "promo_2",
          storeId: "store_1",
          storeFrontUserId: "user_1",
        })
        .mockResolvedValueOnce({
          _id: "promo_2",
          code: "WELCOME10",
          displayText: "10% off",
          validTo: Date.now() + 10_000,
          span: "entire-order",
          discountType: "percentage",
          discountValue: 10,
        })
        .mockResolvedValueOnce({
          _id: "store_1",
          currency: "USD",
        })
        .mockResolvedValueOnce([
          {
            productId: "product_1",
            productSku: {
              sku: "SKU-1",
              name: "Body Wave",
              price: 5000,
              images: ["img1"],
              productCategory: "Hair",
            },
          },
        ])
        .mockResolvedValueOnce([
          {
            sku: "SKU-2",
            productId: "product_2",
            name: "Closure",
            price: 4500,
            images: ["img2"],
          },
        ]),
      runMutation: vi.fn(),
    };
    const success = await sendOfferEmail.handler(successCtx as never, {
      offerId: "offer_2",
    });
    expect(success).toEqual({
      success: true,
      message: "Discount code email sent",
    });
    expect(sendDiscountCodeEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        customerEmail: "ada@example.com",
        promoCode: "WELCOME10",
      })
    );
    expect(successCtx.runMutation).toHaveBeenCalledWith("offers.updateStatus", {
      id: "offer_2",
      status: "sent",
      sentAt: expect.any(Number),
    });

    sendDiscountCodeEmail.mockRejectedValueOnce("mailer down");
    const errorCtx = {
      runQuery: vi
        .fn()
        .mockResolvedValueOnce({
          _id: "offer_3",
          status: "pending",
          email: "ada@example.com",
          promoCodeId: "promo_3",
          storeId: "store_1",
          storeFrontUserId: "user_1",
        })
        .mockResolvedValueOnce({
          _id: "promo_3",
          code: "WELCOME10",
          displayText: "10% off",
          validTo: Date.now() + 10_000,
          span: "entire-order",
          discountType: "percentage",
          discountValue: 10,
        })
        .mockResolvedValueOnce(null),
      runMutation: vi.fn(),
    };
    const error = await sendOfferEmail.handler(errorCtx as never, {
      offerId: "offer_3",
    });
    expect(error).toEqual({
      success: false,
      message: "Failed to send discount code email",
    });
    expect(errorCtx.runMutation).toHaveBeenCalledWith("offers.updateStatus", {
      id: "offer_3",
      status: "error",
      errorMessage: "Unknown error",
    });
  });

  it("sends reminder emails with guard, success, and error paths", async () => {
    const { sendOfferReminderEmail } = await loadModule();

    const missingOfferCtx = {
      runQuery: vi.fn().mockResolvedValue(null),
      runMutation: vi.fn(),
    };
    const missingOffer = await sendOfferReminderEmail.handler(
      missingOfferCtx as never,
      {
        offerId: "offer_1",
      }
    );
    expect(missingOffer).toEqual({
      success: false,
      message: "Offer not found or already redeemed",
    });

    const missingPromoCtx = {
      runQuery: vi
        .fn()
        .mockResolvedValueOnce({
          _id: "offer_2",
          email: "ada@example.com",
          storeId: "store_1",
          promoCodeId: "promo_missing",
          storeFrontUserId: "user_1",
          isRedeemed: false,
        })
        .mockResolvedValueOnce(null),
      runMutation: vi.fn(),
    };
    const missingPromo = await sendOfferReminderEmail.handler(
      missingPromoCtx as never,
      {
        offerId: "offer_2",
      }
    );
    expect(missingPromo).toEqual({
      success: false,
      message: "Promo code not found",
    });
    expect(missingPromoCtx.runMutation).toHaveBeenCalledWith("offers.updateStatus", {
      id: "offer_2",
      status: "error",
      errorMessage: "Promo code not found",
    });

    const missingStoreCtx = {
      runQuery: vi
        .fn()
        .mockResolvedValueOnce({
          _id: "offer_3",
          email: "ada@example.com",
          storeId: "store_1",
          promoCodeId: "promo_1",
          storeFrontUserId: "user_1",
          isRedeemed: false,
        })
        .mockResolvedValueOnce({
          _id: "promo_1",
          code: "WELCOME10",
          displayText: "10% off",
          discountType: "percentage",
          discountValue: 10,
        })
        .mockResolvedValueOnce(null),
      runMutation: vi.fn(),
    };
    const missingStore = await sendOfferReminderEmail.handler(
      missingStoreCtx as never,
      {
        offerId: "offer_3",
      }
    );
    expect(missingStore).toEqual({
      success: false,
      message: "Store not found",
    });

    sendDiscountReminderEmail.mockResolvedValueOnce({ ok: true });
    const successCtx = {
      runQuery: vi
        .fn()
        .mockResolvedValueOnce({
          _id: "offer_4",
          email: "ada@example.com",
          storeId: "store_1",
          promoCodeId: "promo_2",
          storeFrontUserId: "user_1",
          isRedeemed: false,
        })
        .mockResolvedValueOnce({
          _id: "promo_2",
          code: "WELCOME10",
          displayText: "10% off",
          discountType: "percentage",
          discountValue: 10,
        })
        .mockResolvedValueOnce({
          _id: "store_1",
          currency: "USD",
        })
        .mockResolvedValueOnce([
          {
            productId: "product_1",
            productSku: {
              sku: "SKU-1",
              name: "Body Wave",
              price: 5000,
              images: ["img1"],
              productCategory: "Hair",
            },
          },
          {
            productId: "product_2",
            productSku: {
              sku: "SKU-2",
              name: "Bundle",
              price: 4000,
              images: ["img2"],
              productCategory: "Beauty",
            },
          },
        ])
        .mockResolvedValueOnce([
          {
            sku: "SKU-3",
            productId: "product_3",
            name: "Closure",
            price: 4500,
            images: ["img3"],
          },
        ]),
      runMutation: vi.fn(),
    };
    const success = await sendOfferReminderEmail.handler(successCtx as never, {
      offerId: "offer_4",
    });
    expect(success).toEqual({
      success: true,
      message: "Discount reminder email sent",
    });
    expect(successCtx.runMutation).toHaveBeenCalledWith("offers.updateStatus", {
      id: "offer_4",
      status: "reminded",
      activity: expect.objectContaining({
        action: "sent_first_reminder",
      }),
    });

    sendDiscountReminderEmail.mockRejectedValueOnce(new Error("send failed"));
    const errorCtx = {
      runQuery: vi
        .fn()
        .mockResolvedValueOnce({
          _id: "offer_5",
          email: "ada@example.com",
          storeId: "store_1",
          promoCodeId: "promo_2",
          storeFrontUserId: "user_1",
          isRedeemed: false,
        })
        .mockResolvedValueOnce({
          _id: "promo_2",
          code: "WELCOME10",
          displayText: "10% off",
          discountType: "percentage",
          discountValue: 10,
        })
        .mockResolvedValueOnce({
          _id: "store_1",
          currency: "USD",
        })
        .mockResolvedValueOnce([
          {
            productId: "product_1",
            productSku: {
              sku: "SKU-1",
              name: "Body Wave",
              price: 5000,
              images: ["img1"],
              productCategory: "Hair",
            },
          },
        ])
        .mockResolvedValueOnce([]),
      runMutation: vi.fn(),
    };
    const error = await sendOfferReminderEmail.handler(errorCtx as never, {
      offerId: "offer_5",
    });
    expect(error).toEqual({
      success: false,
      message: "Failed to send discount code email",
    });
  });

  it("schedules reminder emails in bulk", async () => {
    const { sendOfferReminderEmails } = await loadModule();

    const noneCtx = {
      runQuery: vi.fn().mockResolvedValue([]),
      scheduler: { runAfter: vi.fn() },
    };
    const none = await sendOfferReminderEmails.handler(noneCtx as never, {
      storeId: "store_1",
    });
    expect(none).toEqual({
      success: true,
      message: "No offers to send reminder emails for",
    });

    const bulkCtx = {
      runQuery: vi
        .fn()
        .mockResolvedValue([{ _id: "offer_1" }, { _id: "offer_2" }]),
      scheduler: { runAfter: vi.fn().mockResolvedValue(undefined) },
    };
    const bulk = await sendOfferReminderEmails.handler(bulkCtx as never, {
      storeId: "store_1",
    });
    expect(bulk).toEqual({
      success: true,
      message: "Discount reminder emails sent for 2 offer(s)",
    });
    expect(bulkCtx.scheduler.runAfter).toHaveBeenCalledTimes(2);
  });

  it("updates offer status and appends activity", async () => {
    const { updateStatus } = await loadModule();
    const { db } = createDbHarness({
      records: {
        offer_1: {
          _id: "offer_1",
          activity: [{ action: "created", timestamp: 1 }],
        },
      },
    });

    await updateStatus.handler({ db } as never, {
      id: "offer_1",
      status: "sent",
      sentAt: 2000,
      errorMessage: "none",
      activity: { action: "sent_first_reminder", timestamp: 3000 },
    });
    expect(db.patch).toHaveBeenCalledWith("offer_1", {
      status: "sent",
      sentAt: 2000,
      errorMessage: "none",
      activity: [
        { action: "created", timestamp: 1 },
        { action: "sent_first_reminder", timestamp: 3000 },
      ],
    });

    await updateStatus.handler({ db } as never, {
      id: "offer_missing",
      status: "error",
    });
    expect(db.patch).toHaveBeenLastCalledWith("offer_missing", {
      status: "error",
    });
  });

  it("supports offer query handlers", async () => {
    const mod = await loadModule();
    const { db } = createDbHarness({
      queryQueues: {
        "offer:collect": [
          [{ _id: "offer_store_1" }],
          [{ _id: "offer_promo_1" }],
          [{ _id: "offer_email_1" }],
          [
            {
              _id: "offer_user_1",
              promoCodeId: "promo_1",
            },
          ],
          [{ _id: "offer_all_status" }],
          [{ _id: "offer_all_any" }],
        ],
      },
      records: {
        offer_1: { _id: "offer_1", status: "sent" },
        promo_1: { _id: "promo_1", code: "WELCOME10" },
      },
    });

    const byId = await mod.getById.handler({ db } as never, { id: "offer_1" });
    expect(byId).toEqual({ _id: "offer_1", status: "sent" });

    const byStore = await mod.getByStoreId.handler({ db } as never, {
      storeId: "store_1",
    });
    expect(byStore).toEqual([{ _id: "offer_store_1" }]);

    const byPromo = await mod.getByPromoCodeId.handler({ db } as never, {
      promoCodeId: "promo_1",
    });
    expect(byPromo).toEqual([{ _id: "offer_promo_1" }]);

    const byEmail = await mod.getByEmail.handler({ db } as never, {
      email: "ada@example.com",
    });
    expect(byEmail).toEqual([{ _id: "offer_email_1" }]);

    const byUser = await mod.getByStorefrontUserId.handler({ db } as never, {
      storeFrontUserId: "user_1",
    });
    expect(byUser).toEqual([
      {
        _id: "offer_user_1",
        promoCodeId: "promo_1",
        promoCode: { _id: "promo_1", code: "WELCOME10" },
      },
    ]);

    const withStatus = await mod.getAll.handler({ db } as never, {
      storeId: "store_1",
      status: "sent",
    });
    expect(withStatus).toEqual([{ _id: "offer_all_status" }]);

    const withoutStatus = await mod.getAll.handler({ db } as never, {
      storeId: "store_1",
    });
    expect(withoutStatus).toEqual([{ _id: "offer_all_any" }]);
  });
});
