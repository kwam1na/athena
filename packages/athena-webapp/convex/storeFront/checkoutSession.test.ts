import { describe, expect, it } from "vitest";
import type { Id } from "../_generated/dataModel";

import {
  buildCheckoutReservationActivityArgs,
  recordCheckoutReservationActivities,
} from "./checkoutSession";
import {
  buildServerPricedCheckoutProducts,
  resolveServerDeliveryFee,
} from "./helpers/paymentHelpers";

function createReservationActivityCtx() {
  const productSku = new Map<string, Record<string, unknown>>([
    [
      "sku-1",
      {
        _id: "sku-1",
        inventoryCount: 5,
        productId: "product-1",
        quantityAvailable: 3,
        storeId: "store-1",
      },
    ],
  ]);
  const skuActivityEvent = new Map<string, Record<string, unknown>>();

  const ctx = {
    db: {
      get: async (table: string, id: string) => {
        if (table !== "productSku") return null;
        return productSku.get(id) ?? null;
      },
      insert: async (table: string, input: Record<string, unknown>) => {
        if (table !== "skuActivityEvent") {
          throw new Error(`Unexpected insert into ${table}`);
        }
        const id = `sku-activity-${skuActivityEvent.size + 1}`;
        skuActivityEvent.set(id, { _id: id, ...input });
        return id;
      },
      query: (table: string) => {
        if (table !== "skuActivityEvent") {
          throw new Error(`Unexpected query against ${table}`);
        }

        return {
          withIndex(
            _indexName: string,
            apply: (builder: {
              eq: (field: string, value: unknown) => unknown;
            }) => void,
          ) {
            const filters: Record<string, unknown> = {};
            const builder = {
              eq(field: string, value: unknown) {
                filters[field] = value;
                return builder;
              },
            };
            apply(builder);
            const page = Array.from(skuActivityEvent.values()).filter(
              (record) =>
                Object.entries(filters).every(
                  ([field, value]) => record[field] === value,
                ),
            );

            return {
              first: async () => page[0] ?? null,
            };
          },
        };
      },
    },
  };

  return { ctx: ctx as any, skuActivityEvent };
}

describe("checkout session server-authoritative money", () => {
  it("prices checkout items from server SKU data instead of client payload money", () => {
    const priced = buildServerPricedCheckoutProducts({
      products: [
        {
          productId: "client-product" as any,
          productSku: "CLIENT-SKU",
          productSkuId: "sku-1" as any,
          quantity: 2,
          price: 1,
        },
      ],
      productSkus: [
        {
          _id: "sku-1" as any,
          price: 4_500,
          productId: "server-product" as any,
          sku: "SERVER-SKU",
        },
      ],
    });

    expect(priced).toMatchObject({
      missingProductSkuIds: [],
      subtotal: 9_000,
      products: [
        {
          price: 4_500,
          productId: "server-product",
          productSku: "SERVER-SKU",
          productSkuId: "sku-1",
          quantity: 2,
        },
      ],
    });
  });

  it("resolves delivery fees from store config and waiver rules", () => {
    expect(
      resolveServerDeliveryFee({
        deliveryDetails: { country: "GH", region: "AA" },
        deliveryMethod: "delivery",
        deliveryOption: "outside-accra",
        storeConfig: {
          commerce: {
            deliveryFees: {
              otherRegions: 12_500,
            },
            waiveDeliveryFees: {
              otherRegions: true,
              minimumOrderAmount: 20_000,
            },
          },
        },
        subtotal: 19_999,
      }),
    ).toBe(12_500);

    expect(
      resolveServerDeliveryFee({
        deliveryDetails: { country: "GH", region: "AA" },
        deliveryMethod: "delivery",
        deliveryOption: "outside-accra",
        storeConfig: {
          commerce: {
            deliveryFees: {
              otherRegions: 12_500,
            },
            waiveDeliveryFees: {
              otherRegions: true,
              minimumOrderAmount: 20_000,
            },
          },
        },
        subtotal: 20_000,
      }),
    ).toBe(0);
  });
});

describe("checkout reservation SKU activity", () => {
  it("builds checkout reservation activity without another availability mutation", () => {
    const activity = buildCheckoutReservationActivityArgs({
      activityType: "reservation_acquired",
      productId: "product-1" as Id<"product">,
      productSkuId: "sku-1" as Id<"productSku">,
      quantity: 2,
      quantityDelta: -2,
      sessionId: "checkout-session-1" as Id<"checkoutSession">,
      sourceLineId: "checkout-item-1" as Id<"checkoutSessionItem">,
      status: "active",
      storeFrontUserId: "guest-1" as Id<"guest">,
      storeId: "store-1" as Id<"store">,
    });

    expect(activity).toMatchObject({
      activityType: "reservation_acquired",
      checkoutSessionId: "checkout-session-1",
      idempotencyKey:
        "checkoutSession:checkout-session-1:checkout-item-1:reservation_acquired:2:active",
      productSkuId: "sku-1",
      quantityDelta: -2,
      reservationQuantity: 2,
      sourceId: "checkout-session-1",
      sourceLineId: "checkout-item-1",
      sourceType: "checkoutSession",
      status: "active",
      storeId: "store-1",
    });
    expect(activity).not.toHaveProperty("quantityAvailable");
    expect(activity).not.toHaveProperty("inventoryCount");
  });

  it("records release activity idempotently before checkout rows can be deleted", async () => {
    const { ctx, skuActivityEvent } = createReservationActivityCtx();
    const release = {
      activityType: "reservation_expired",
      productId: "product-1" as Id<"product">,
      productSkuId: "sku-1" as Id<"productSku">,
      quantity: 2,
      quantityDelta: 2,
      reason: "expired",
      sessionId: "checkout-session-1" as Id<"checkoutSession">,
      sourceLineId: "checkout-item-1" as Id<"checkoutSessionItem">,
      status: "expired" as const,
      storeFrontUserId: "guest-1" as Id<"guest">,
      storeId: "store-1" as Id<"store">,
    };

    await recordCheckoutReservationActivities(ctx, [release]);
    await recordCheckoutReservationActivities(ctx, [release]);

    expect(skuActivityEvent).toHaveLength(1);
    expect(Array.from(skuActivityEvent.values())[0]).toMatchObject({
      activityType: "reservation_expired",
      checkoutSessionId: "checkout-session-1",
      reservationQuantity: 2,
      sourceLineId: "checkout-item-1",
      status: "expired",
    });
  });
});
