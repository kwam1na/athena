import { describe, expect, it } from "vitest";
import {
  buildCanonicalCheckoutProducts,
  computePaystackSignature,
  hasValidPositiveQuantity,
  isAuthorizedResourceOwner,
  isAmountTampered,
  isDuplicateChargeSuccess,
  isValidPaystackSignature,
  timingSafeEqualHex,
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

  describe("timingSafeEqualHex", () => {
    it("compares equal-length hex strings and rejects mismatches", () => {
      expect(timingSafeEqualHex("abcd", "abcd")).toBe(true);
      expect(timingSafeEqualHex("abcd", "abce")).toBe(false);
      expect(timingSafeEqualHex("abcd", "abc")).toBe(false);
    });
  });

  describe("isValidPaystackSignature", () => {
    it("validates signed payloads and rejects bad signatures", async () => {
      const body = JSON.stringify({
        event: "charge.success",
        data: { id: 10 },
      });
      const secret = "test_secret";

      const computed = await computePaystackSignature(body, secret);
      expect(await isValidPaystackSignature(body, secret, computed)).toBe(true);
      // Uppercase headers are normalized before comparison.
      expect(
        await isValidPaystackSignature(body, secret, computed.toUpperCase())
      ).toBe(true);
      expect(await isValidPaystackSignature(body, secret, "bad-signature")).toBe(
        false
      );
      // A payload signed with a different secret must not validate.
      expect(
        await isValidPaystackSignature(body, "other_secret", computed)
      ).toBe(false);
    });

    it("produces the known HMAC-SHA512 hex digest for a fixed input", async () => {
      // Cross-checked against Node's crypto.createHmac("sha512", ...).
      const computed = await computePaystackSignature("hello", "secret");
      expect(computed).toBe(
        "db1595ae88a62fd151ec1cba81b98c39df82daae7b4cb9820f446d5bf02f1dcfca6683d88cab3e273f5963ab8ec469a746b5b19086371239f67d1e5f99a79440"
      );
    });
  });

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
