import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import schema from "../schema";

type IndexExpectation = {
  table: string;
  descriptor: string;
  fields: string[];
};

function getTableIndexes(tableName: string) {
  return ((schema as any).tables[tableName]?.indexes ?? []) as Array<{
    indexDescriptor: string;
    fields: string[];
  }>;
}

function expectIndex({ table, descriptor, fields }: IndexExpectation) {
  expect(getTableIndexes(table)).toContainEqual({
    indexDescriptor: descriptor,
    fields,
  });
}

function getSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("commerce query indexing", () => {
  it("defines the additive schema indexes for commerce lookups", () => {
    [
      {
        table: "bag",
        descriptor: "by_storeFrontUserId",
        fields: ["storeFrontUserId"],
      },
      {
        table: "savedBag",
        descriptor: "by_storeFrontUserId",
        fields: ["storeFrontUserId"],
      },
      {
        table: "savedBagItem",
        descriptor: "by_savedBagId",
        fields: ["savedBagId"],
      },
      {
        table: "checkoutSession",
        descriptor: "by_storeFrontUserId",
        fields: ["storeFrontUserId"],
      },
      {
        table: "checkoutSession",
        descriptor: "by_storeId",
        fields: ["storeId"],
      },
      {
        table: "onlineOrder",
        descriptor: "by_checkoutSessionId",
        fields: ["checkoutSessionId"],
      },
      {
        table: "onlineOrder",
        descriptor: "by_customerProfileId",
        fields: ["customerProfileId"],
      },
      {
        table: "onlineOrder",
        descriptor: "by_externalTransactionId",
        fields: ["externalTransactionId"],
      },
      {
        table: "onlineOrder",
        descriptor: "by_storeFrontUserId",
        fields: ["storeFrontUserId"],
      },
      {
        table: "onlineOrder",
        descriptor: "by_storeId",
        fields: ["storeId"],
      },
      {
        table: "onlineOrder",
        descriptor: "by_externalReference",
        fields: ["externalReference"],
      },
      {
        table: "onlineOrderItem",
        descriptor: "by_orderId",
        fields: ["orderId"],
      },
      {
        table: "promoCodeItem",
        descriptor: "by_productSkuId",
        fields: ["productSkuId"],
      },
      {
        table: "redeemedPromoCode",
        descriptor: "by_promoCodeId_storeFrontUserId",
        fields: ["promoCodeId", "storeFrontUserId"],
      },
      {
        table: "analytics",
        descriptor: "by_promoCodeId",
        fields: ["promoCodeId"],
      },
    ].forEach(expectIndex);
  });

  it("uses indexed lookups in the bag and saved-bag modules", () => {
    const bagSource = getSource("./bag.ts");
    const savedBagSource = getSource("./savedBag.ts");

    expect(bagSource).toContain('.withIndex("by_storeFrontUserId"');
    expect(savedBagSource).toContain('.withIndex("by_storeFrontUserId"');
    expect(savedBagSource).toContain('.withIndex("by_savedBagId"');
  });

  it("uses indexed lookups in the checkout-session and online-order modules", () => {
    const checkoutSessionSource = getSource("./checkoutSession.ts");
    const onlineOrderSource = getSource("./onlineOrder.ts");
    const helperSource = getSource("./helpers/onlineOrder.ts");
    const analyticsSource = getSource("./analytics.ts");

    expect(checkoutSessionSource).toContain('.withIndex("by_storeFrontUserId"');
    expect(checkoutSessionSource).toContain('.withIndex("by_sessionId"');
    expect(onlineOrderSource).toContain('.withIndex("by_checkoutSessionId"');
    expect(onlineOrderSource).toContain('.withIndex("by_storeFrontUserId"');
    expect(onlineOrderSource).toContain('.withIndex("by_orderId"');
    expect(helperSource).toContain('.withIndex("by_externalReference"');
    expect(helperSource).toContain('.withIndex("by_externalTransactionId"');
    expect(analyticsSource).toContain('.withIndex("by_promoCodeId"');
  });

  it("rejects archived products before checkout sessions can be created", () => {
    const checkoutSessionSource = getSource("./checkoutSession.ts");

    expect(checkoutSessionSource).toContain(
      'product.availability === "archived"',
    );
    expect(checkoutSessionSource).toContain(
      "Some items in your bag are no longer available",
    );
  });
});
