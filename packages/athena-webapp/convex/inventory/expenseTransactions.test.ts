import { beforeEach, describe, expect, it, vi } from "vitest";

const reportingMocks = vi.hoisted(() => ({
  applyInventoryEffectWithCtx: vi.fn(),
  resolveReportingOperatingPeriodWithCtx: vi.fn(),
}));

vi.mock("../reporting/inventory/effects", () => ({
  applyInventoryEffectWithCtx: reportingMocks.applyInventoryEffectWithCtx,
}));
vi.mock("../reporting/operatingPeriods", () => ({
  resolveReportingOperatingPeriodWithCtx:
    reportingMocks.resolveReportingOperatingPeriodWithCtx,
}));

import { ok } from "../../shared/commandResult";
import { assertConformsToExportedReturns } from "../lib/returnValidatorContract";
import {
  createExpenseTransactionFromSessionHandler,
  formatExpenseStaffProfileName,
  getExpenseTransactionById,
  getExpenseTransactions,
  voidExpenseTransaction,
  voidExpenseTransactionHandler,
} from "./expenseTransactions";

beforeEach(() => {
  reportingMocks.resolveReportingOperatingPeriodWithCtx.mockResolvedValue({
    kind: "missing_schedule",
  });
  reportingMocks.applyInventoryEffectWithCtx.mockImplementation(
    async (ctx: any, args: Record<string, any>) => {
      await ctx.db.patch("productSku", args.productSkuId, {
        inventoryCount: args.compatibilityBalance.onHandQuantity,
        quantityAvailable: args.compatibilityBalance.sellableQuantity,
      });
      return { movement: null };
    },
  );
});

describe("formatExpenseStaffProfileName", () => {
  it("accepts representative public return contracts", () => {
    assertConformsToExportedReturns(getExpenseTransactions, [
      {
        _creationTime: 1,
        _id: "expense-1",
        completedAt: 2,
        itemCount: 1,
        sessionId: "session-1",
        staffProfileId: "staff-1",
        staffProfileName: "Ato K.",
        status: "completed",
        storeId: "store-1",
        totalValue: 100,
        transactionNumber: "EXP-1",
      },
    ]);
    assertConformsToExportedReturns(getExpenseTransactionById, {
      _creationTime: 1,
      _id: "expense-1",
      completedAt: 2,
      items: [],
      sessionId: "session-1",
      staffProfile: null,
      staffProfileId: "staff-1",
      status: "completed",
      storeId: "store-1",
      totalValue: 100,
      transactionNumber: "EXP-1",
    });
    assertConformsToExportedReturns(
      voidExpenseTransaction,
      ok({ transactionId: "expense-1" }),
    );
  });

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
    reportingMocks.applyInventoryEffectWithCtx.mockClear();
    const ctx = createFakeMutationCtx({
      expenseSession: [
        {
          _id: "expense-session-1",
          storeId: "store-1",
          staffProfileId: "staff-1",
          registerNumber: "1",
        },
      ],
      store: [
        {
          _id: "store-1",
          organizationId: "org-1",
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
          productId: "product-1",
          quantityAvailable: 4,
          images: [],
          storeId: "store-1",
        },
        {
          _id: "sku-pending",
          sku: "PENDING-1",
          inventoryCount: 0,
          productId: "product-pending",
          quantityAvailable: 0,
          images: [],
          storeId: "store-1",
        },
        {
          _id: "sku-no-hold",
          sku: "NOHOLD-1",
          inventoryCount: 4,
          productId: "product-2",
          quantityAvailable: 0,
          images: [],
          storeId: "store-1",
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
          quantityAvailable: 4,
        },
      },
      {
        id: "sku-no-hold",
        patch: {
          inventoryCount: 3,
          quantityAvailable: 0,
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
    expect(reportingMocks.applyInventoryEffectWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        actorStaffProfileId: "staff-1",
        businessEventKey:
          "expense_transaction:expenseTransaction-1:sku:sku-1:completed",
        physicalQuantityDelta: -1,
        sellableQuantityDelta: 0,
        valuation: {
          disposition: "inventory_expense",
          kind: "outbound",
          quantity: 1,
        },
      }),
    );
    const replay = await createExpenseTransactionFromSessionHandler(ctx, {
      sessionId: "expense-session-1" as never,
      notes: "Damaged item",
    });
    expect(replay).toEqual(result);
    expect(ctx.inserts.expenseTransaction).toHaveLength(1);
    expect(reportingMocks.applyInventoryEffectWithCtx).toHaveBeenCalledTimes(2);
  });

  it("voids trusted inventory through a return of the original expense basis", async () => {
    reportingMocks.applyInventoryEffectWithCtx.mockClear();
    const ctx = createFakeMutationCtx({
      expenseTransaction: [
        {
          _id: "expense-1",
          completedAt: 1_000,
          sessionId: "expense-session-1",
          staffProfileId: "staff-1",
          status: "completed",
          storeId: "store-1",
          totalValue: 200,
          transactionNumber: "EXP-1",
        },
      ],
      expenseTransactionItem: [
        {
          _id: "expense-item-1",
          inventoryHoldApplied: true,
          productId: "product-1",
          productSkuId: "sku-1",
          quantity: 2,
          transactionId: "expense-1",
        },
      ],
      productSku: [
        {
          _id: "sku-1",
          inventoryCount: 3,
          productId: "product-1",
          quantityAvailable: 1,
          sku: "SKU-1",
          storeId: "store-1",
        },
      ],
      reportingInventoryEffect: [
        {
          _id: "effect-1",
          businessEventKey: "expense_transaction:expense-1:sku:sku-1:completed",
          costedQuantityDelta: -2,
          currencyCode: "GHS",
          outboundBasisMinor: 200,
          sourceDomain: "inventory",
          storeId: "store-1",
          uncostedQuantityDelta: 0,
        },
      ],
      store: [{ _id: "store-1", organizationId: "org-1" }],
    });

    const result = await voidExpenseTransactionHandler(ctx, {
      transactionId: "expense-1" as never,
      voidReason: "Entered in error",
    });

    expect(result).toEqual(ok({ transactionId: "expense-1" }));
    expect(reportingMocks.applyInventoryEffectWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        businessEventKey: "expense_transaction:expense-1:sku:sku-1:void",
        compatibilityBalance: {
          onHandQuantity: 5,
          sellableQuantity: 3,
        },
        physicalQuantityDelta: 2,
        sellableQuantityDelta: 2,
        valuation: expect.objectContaining({
          disposition: "sellable",
          kind: "return",
          quantity: 2,
          originalBasis: expect.objectContaining({
            allocatedKnownCost: 200,
            costedQuantity: 2,
            currency: "GHS",
          }),
        }),
      }),
    );
    expect(ctx.patches.expenseTransaction).toEqual([
      {
        id: "expense-1",
        patch: expect.objectContaining({
          notes: "Entered in error",
          status: "void",
          voidedAt: expect.any(Number),
        }),
      },
    ]);
  });
});

function createFakeMutationCtx(
  seed: Record<string, Array<Record<string, unknown>>>,
) {
  const tables = new Map(
    Object.entries(seed).map(([tableName, rows]) => [tableName, [...rows]]),
  );
  const inserts: Record<string, Array<Record<string, unknown>>> = {};
  const patches: Record<
    string,
    Array<{ id: string; patch: Record<string, unknown> }>
  > = {};

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
            predicate: (query: {
              eq: (field: string, value: unknown) => unknown;
            }) => unknown,
          ) {
            const query = {
              eq(field: string, value: unknown) {
                indexField = field;
                indexValue = value;
                return query;
              },
            };
            predicate(query);

            return this;
          },
          async collect() {
            return rowsFor(tableName).filter((row) =>
              indexField ? row[indexField] === indexValue : true,
            );
          },
          async first() {
            // eslint-disable-next-line @convex-dev/no-collect-in-query -- test fake, not a Convex query
            return (await this.collect())[0] ?? null;
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
      async patch(
        tableName: string,
        id: string,
        patch: Record<string, unknown>,
      ) {
        patches[tableName] = [...(patches[tableName] ?? []), { id, patch }];
        const row = rowsFor(tableName).find(
          (candidate) => candidate._id === id,
        );
        if (row) {
          Object.assign(row, patch);
        }
      },
    },
    scheduler: {
      runAfter: vi.fn().mockResolvedValue(undefined),
    },
  };

  return ctx as never as typeof ctx &
    Parameters<typeof createExpenseTransactionFromSessionHandler>[0];
}
