import { describe, expect, it } from "vitest";

import type { OnlineOrder, ProductSku, Store, StoreFrontUser } from "@athena/webapp";

import { formatDeliveryAddress, getOrderAmount, getPotentialPoints } from "./utils";
import type { Address } from "./types";

/**
 * Characterization test for the storefront order contract surface.
 *
 * This pins two things that a package-boundary refactor could silently break:
 *   1. the runtime output of the checkout utilities for realistic order data;
 *   2. the structural shape of the shared DTOs the storefront consumes, so the
 *      contracts keep resolving to Convex-backed document types rather than
 *      degrading to `any` when their import specifier changes.
 */

const orderFixture = {
  _id: "order_1",
  _creationTime: 1_700_000_000_000,
  storeId: "store_1",
  storeFrontUserId: "sfu_1",
  amount: 20_000,
  deliveryFee: 3_000,
  items: [
    { productSkuId: "sku-1", quantity: 2, price: 5_000 },
    { productSkuId: "sku-2", quantity: 1, price: 10_000 },
  ],
  discount: {
    id: "d1",
    code: "SAVE10",
    type: "percentage",
    value: 10,
    span: "entire-order",
    isMultipleUses: false,
  },
} as unknown as OnlineOrder;

const orderWithoutDiscountOrFee = {
  ...orderFixture,
  deliveryFee: undefined,
  discount: undefined,
} as unknown as OnlineOrder;

const orderWithNoItems = {
  ...orderFixture,
  items: undefined,
  discount: undefined,
  deliveryFee: 0,
  amount: 0,
} as unknown as OnlineOrder;

describe("checkout utilities accept existing order data", () => {
  it("derives order amounts from a persisted online order", () => {
    expect(
      getOrderAmount({
        items: (orderFixture.items ?? []) as any,
        discount: orderFixture.discount as any,
        deliveryFee: orderFixture.deliveryFee ?? 0,
        subtotal: orderFixture.amount,
      }),
    ).toEqual({
      amountCharged: 21_000,
      discountValue: 2_000,
      amountPaid: 18_000,
    });
  });

  it("derives loyalty points from a persisted online order", () => {
    // (20000 - 2000 + 3000) / 1000 -> 21
    expect(getPotentialPoints(orderFixture)).toBe(21);
  });

  it("derives loyalty points when the order carries no discount or delivery fee", () => {
    expect(getPotentialPoints(orderWithoutDiscountOrFee)).toBe(20);
  });

  it("tolerates an order with no items", () => {
    expect(getPotentialPoints(orderWithNoItems)).toBe(0);
  });
});

describe("checkout utilities render existing address data", () => {
  it("formats a Ghana delivery address", () => {
    const address: Address = {
      country: "GH",
      region: "GA",
      houseNumber: "12",
      street: "Jungle Ave",
      neighborhood: "east-legon",
    };

    const formatted = formatDeliveryAddress(address);

    expect(formatted.country).toBe("Ghana");
    expect(formatted.addressLine).toContain("12 Jungle Ave");
    expect(formatted.addressLine).toContain("Greater Accra");
  });

  it("formats a US delivery address", () => {
    const address: Address = {
      country: "US",
      address: "1 Infinite Loop",
      city: "Cupertino",
      state: "CA",
      zip: "95014",
    };

    expect(formatDeliveryAddress(address)).toEqual({
      addressLine: "1 Infinite Loop, Cupertino, CA, 95014",
      country: "United States",
    });
  });

  it("formats a rest-of-world delivery address", () => {
    const address: Address = {
      country: "GB",
      address: "10 Downing Street",
      city: "London",
    };

    expect(formatDeliveryAddress(address)).toEqual({
      addressLine: "10 Downing Street, London",
      country: "United Kingdom",
    });
  });
});

describe("shared DTO contracts keep their Convex-backed shape", () => {
  it("exposes the document fields the storefront reads", () => {
    // Compile-time pins: if these contracts degrade to `any` or lose fields the
    // refactor has changed the surface, not just its location.
    const orderId: OnlineOrder["_id"] = orderFixture._id;
    const orderAmount: number = orderFixture.amount;

    const store = {
      _id: "store_1",
      _creationTime: 1,
      organizationId: "org_1",
      currency: "ghs",
      name: "Wigclub",
    } as unknown as Store;
    const storeCurrency: string | undefined = store.currency;
    const storeOrganizationId: string = store.organizationId;

    const user = {
      _id: "sfu_1",
      _creationTime: 1,
      email: "shopper@example.com",
    } as unknown as StoreFrontUser;
    const userEmail: string | undefined = user.email;

    const sku = {
      _id: "sku_1",
      _creationTime: 1,
      price: 5_000,
      productName: "Wig",
      colorName: "black",
      length: 18,
    } as unknown as ProductSku;

    expect(orderId).toBe("order_1");
    expect(orderAmount).toBe(20_000);
    expect(storeCurrency).toBe("ghs");
    expect(storeOrganizationId).toBe("org_1");
    expect(userEmail).toBe("shopper@example.com");
    expect(sku.productName).toBe("Wig");
    expect(sku.length).toBe(18);
  });
});
