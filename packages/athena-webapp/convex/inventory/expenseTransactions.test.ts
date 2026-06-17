import { describe, expect, it } from "vitest";

import {
  createExpenseTransactionFromSessionHandler,
  formatExpenseStaffProfileName,
} from "./expenseTransactions";

describe("formatExpenseStaffProfileName", () => {
  it("abbreviates the last name when structured staff names are available", () => {
    expect(
      formatExpenseStaffProfileName({
        firstName: "Kwamina",
        lastName: "Nuh",
        fullName: "Kwamina Nuh",
      }),
    ).toBe("Kwamina N.");
  });

  it("abbreviates the last name from full name when structured names are missing", () => {
    expect(
      formatExpenseStaffProfileName({
        fullName: "Kwamina Mensah",
      }),
    ).toBe("Kwamina M.");
  });

  it("keeps single-part full names readable", () => {
    expect(
      formatExpenseStaffProfileName({
        fullName: "Operations",
      }),
    ).toBe("Operations");
  });
});

describe("createExpenseTransactionFromSessionHandler", () => {
  it("skips trusted inventory finalization for pending checkout expense items", async () => {
    const ctx = createFakeMutationCtx({
      expenseSession: [
        {
          _id: "expense-session-1",
          storeId: "store-1",
          staffProfileId: "staff-1",
          registerNumber: "1",
        },
      ],
      expenseSessionItem: [
        {
          _id: "trusted-item-1",
          sessionId: "expense-session-1",
          productId: "product-1",
          productSkuId: "sku-1",
          productName: "Trusted product",
          productSku: "SKU-1",
          quantity: 1,
          price: 100,
        },
        {
          _id: "pending-item-1",
          sessionId: "expense-session-1",
          productId: "product-pending",
          productSkuId: "sku-pending",
          pendingCheckoutItemId: "pending-checkout-1",
          productName: "Pending product",
          productSku: "PENDING-1",
          quantity: 2,
          price: 150,
        },
        {
          _id: "trusted-no-hold-item-1",
          sessionId: "expense-session-1",
          productId: "product-2",
          productSkuId: "sku-no-hold",
          inventoryHoldApplied: false,
          productName: "Physically held product",
          productSku: "NOHOLD-1",
          quantity: 1,
          price: 200,
        },
      ],
      productSku: [
        {
          _id: "sku-1",
          sku: "SKU-1",
          inventoryCount: 5,
          quantityAvailable: 4,
          images: [],
        },
        {
          _id: "sku-pending",
          sku: "PENDING-1",
          inventoryCount: 0,
          quantityAvailable: 0,
          images: [],
        },
        {
          _id: "sku-no-hold",
          sku: "NOHOLD-1",
          inventoryCount: 4,
          quantityAvailable: 0,
          images: [],
        },
      ],
    });

    const result = await createExpenseTransactionFromSessionHandler(ctx, {
      sessionId: "expense-session-1" as never,
      notes: "Damaged item",
    });

    expect(result.kind).toBe("ok");
    expect(ctx.patches.productSku).toEqual([
      {
        id: "sku-1",
        patch: {
          inventoryCount: 4,
        },
      },
      {
        id: "sku-no-hold",
        patch: {
          inventoryCount: 3,
        },
      },
    ]);
    expect(ctx.inserts.expenseTransactionItem).toContainEqual(
      expect.objectContaining({
        productSkuId: "sku-pending",
        pendingCheckoutItemId: "pending-checkout-1",
        quantity: 2,
      }),
    );
    expect(ctx.inserts.expenseTransactionItem).toContainEqual(
      expect.objectContaining({
        productSkuId: "sku-no-hold",
        inventoryHoldApplied: false,
        quantity: 1,
      }),
    );
  });
});

function createFakeMutationCtx(seed: Record<string, Array<Record<string, unknown>>>) {
  const tables = new Map(
    Object.entries(seed).map(([tableName, rows]) => [tableName, [...rows]]),
  );
  const inserts: Record<string, Array<Record<string, unknown>>> = {};
  const patches: Record<string, Array<{ id: string; patch: Record<string, unknown> }>> =
    {};

  function rowsFor(tableName: string) {
    const rows = tables.get(tableName);
    if (!rows) {
      const nextRows: Array<Record<string, unknown>> = [];
      tables.set(tableName, nextRows);
      return nextRows;
    }

    return rows;
  }

  const ctx = {
    inserts,
    patches,
    db: {
      async get(tableName: string, id: string) {
        return rowsFor(tableName).find((row) => row._id === id) ?? null;
      },
      query(tableName: string) {
        let indexField = "";
        let indexValue: unknown;

        return {
          withIndex(
            _indexName: string,
            predicate: (query: { eq: (field: string, value: unknown) => unknown }) => unknown,
          ) {
            predicate({
              eq(field, value) {
                indexField = field;
                indexValue = value;
                return undefined;
              },
            });

            return this;
          },
          async collect() {
            return rowsFor(tableName).filter((row) =>
              indexField ? row[indexField] === indexValue : true,
            );
          },
        };
      },
      async insert(tableName: string, input: Record<string, unknown>) {
        const id = `${tableName}-${(inserts[tableName]?.length ?? 0) + 1}`;
        const row = { _id: id, ...input };
        rowsFor(tableName).push(row);
        inserts[tableName] = [...(inserts[tableName] ?? []), input];
        return id;
      },
      async patch(tableName: string, id: string, patch: Record<string, unknown>) {
        patches[tableName] = [...(patches[tableName] ?? []), { id, patch }];
        const row = rowsFor(tableName).find((candidate) => candidate._id === id);
        if (row) {
          Object.assign(row, patch);
        }
      },
    },
  };

  return ctx as never as typeof ctx & Parameters<typeof createExpenseTransactionFromSessionHandler>[0];
}
