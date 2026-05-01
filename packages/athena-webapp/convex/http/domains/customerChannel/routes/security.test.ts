import { describe, expect, it } from "vitest";
import {
  buildCanonicalCheckoutProducts,
  hasValidPositiveQuantity,
  isAuthorizedResourceOwner,
  isAmountTampered,
  isDuplicateChargeSuccess,
  // isValidPaystackSignature,
} from "./security";

describe("security helpers", () => {
  describe("buildCanonicalCheckoutProducts", () => {
    it("builds canonical products and amount from bag items", () => {
      const result = buildCanonicalCheckoutProducts([
        {
          productId: "product-1",
          productSku: "sku-a",
          productSkuId: "sku-id-a",
          quantity: 2,
          price: 2500, // 25 GHS in pesewas
        },
        {
          productId: "product-2",
          productSku: "sku-b",
          productSkuId: "sku-id-b",
          quantity: 1,
          price: 10000, // 100 GHS in pesewas
        },
      ]);

      expect(result.products).toEqual([
        {
          productId: "product-1",
          productSku: "sku-a",
          productSkuId: "sku-id-a",
          quantity: 2,
          price: 2500,
        },
        {
          productId: "product-2",
          productSku: "sku-b",
          productSkuId: "sku-id-b",
          quantity: 1,
          price: 10000,
        },
      ]);
      expect(result.amount).toBe(15000); // (2500*2) + (10000*1) = 15000 pesewas
    });

    it("returns amount in pesewas (prices already stored as pesewas)", () => {
      const result = buildCanonicalCheckoutProducts([
        {
          productId: "product-1",
          productSku: "sku-a",
          productSkuId: "sku-id-a",
          quantity: 1,
          price: 2999, // 29.99 GHS in pesewas
        },
      ]);
      expect(result.amount).toBe(2999);
    });
  });

  describe("hasValidPositiveQuantity", () => {
    it("returns false for zero or negative quantities", () => {
      expect(hasValidPositiveQuantity(0)).toBe(false);
      expect(hasValidPositiveQuantity(-1)).toBe(false);
      expect(hasValidPositiveQuantity(2)).toBe(true);
    });
  });

  describe("isAuthorizedResourceOwner", () => {
    it("returns true only for matching owners", () => {
      expect(isAuthorizedResourceOwner("owner-1", "owner-1")).toBe(true);
      expect(isAuthorizedResourceOwner("owner-1", "owner-2")).toBe(false);
      expect(isAuthorizedResourceOwner("owner-1", null)).toBe(false);
    });
  });

  describe("isAmountTampered", () => {
    it("detects mismatched amount", () => {
      expect(isAmountTampered(100, 100)).toBe(false);
      expect(isAmountTampered(100, 101)).toBe(true);
    });
  });

  // describe("isValidPaystackSignature", () => {
  //   it("validates signed payloads and rejects bad signatures", () => {
  //     const body = JSON.stringify({
  //       event: "charge.success",
  //       data: { id: 10 },
  //     });
  //     const secret = "test_secret";

  //     const valid = isValidPaystackSignature(body, secret);
  //     expect(
  //       isValidPaystackSignature(body, secret, valid.computedSignature)
  //     ).toBe(true);
  //     expect(
  //       isValidPaystackSignature(body, secret, "bad-signature")
  //     ).toBe(false);
  //   });
  // });

  describe("isDuplicateChargeSuccess", () => {
    it("flags duplicates for already-paid or already-ordered sessions", () => {
      expect(
        isDuplicateChargeSuccess({
          hasCompletedPayment: true,
          placedOrderId: undefined,
          hasExistingOrder: false,
          incomingTransactionId: "tx-1",
          existingTransactionId: undefined,
        }),
      ).toBe(true);

      expect(
        isDuplicateChargeSuccess({
          hasCompletedPayment: false,
          placedOrderId: "order-1",
          hasExistingOrder: false,
          incomingTransactionId: "tx-1",
          existingTransactionId: undefined,
        }),
      ).toBe(true);

      expect(
        isDuplicateChargeSuccess({
          hasCompletedPayment: false,
          placedOrderId: undefined,
          hasExistingOrder: true,
          incomingTransactionId: "tx-1",
          existingTransactionId: undefined,
        }),
      ).toBe(true);

      expect(
        isDuplicateChargeSuccess({
          hasCompletedPayment: false,
          placedOrderId: undefined,
          hasExistingOrder: false,
          incomingTransactionId: "tx-1",
          existingTransactionId: "tx-1",
        }),
      ).toBe(true);

      expect(
        isDuplicateChargeSuccess({
          hasCompletedPayment: false,
          placedOrderId: undefined,
          hasExistingOrder: false,
          incomingTransactionId: "tx-1",
          existingTransactionId: "tx-2",
        }),
      ).toBe(false);
    });
  });
});
