import { describe, expect, it } from "vitest";

import {
  buildServerPricedCheckoutProducts,
  resolveServerDeliveryFee,
} from "./helpers/paymentHelpers";

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
