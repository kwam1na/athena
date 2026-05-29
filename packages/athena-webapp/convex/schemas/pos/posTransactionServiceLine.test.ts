import { describe, expect, it } from "vitest";

import { posTransactionServiceLineSchema } from "./posTransactionServiceLine";

describe("posTransactionServiceLineSchema", () => {
  it("links completed service sale lines to transactions and service cases without product ids", () => {
    const fields = (posTransactionServiceLineSchema as any).json.value;

    expect(fields.transactionId).toEqual(
      expect.objectContaining({
        fieldType: expect.objectContaining({
          tableName: "posTransaction",
        }),
      }),
    );
    expect(fields.serviceCaseId).toEqual(
      expect.objectContaining({
        fieldType: expect.objectContaining({
          tableName: "serviceCase",
        }),
      }),
    );
    expect(fields.serviceCatalogId).toEqual(
      expect.objectContaining({
        fieldType: expect.objectContaining({
          tableName: "serviceCatalog",
        }),
        optional: true,
      }),
    );
    expect(fields.productId).toBeUndefined();
    expect(fields.productSkuId).toBeUndefined();
  });
});
