import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  adjustTransactionItems,
  completeTransaction,
  correctTransactionCustomer,
  correctTransactionPaymentMethod,
  createTransactionFromSession,
  getCompletedTransactions,
  getRecentTransactionsWithCustomers,
  getTodaySummary,
  getTransaction,
  getTransactionById,
  getTransactionsByStore,
  markReceiptPrinted,
  updateInventory,
  voidTransaction,
} from "./transactions";
import type { Id } from "../../_generated/dataModel";
import { assertConformsToExportedReturns } from "../../lib/returnValidatorContract";
import * as athenaUserAuth from "../../lib/athenaUserAuth";
import * as correctionCommands from "../application/commands/correctTransaction";
import * as itemAdjustmentCommands from "../application/commands/adjustTransactionItems";
import * as completeTransactionCommands from "../application/commands/completeTransaction";
import * as transactionQueries from "../application/queries/getTransactions";

vi.mock("../../lib/athenaUserAuth", () => ({
  requireAuthenticatedAthenaUserWithCtx: vi.fn(),
  requireOrganizationMemberRoleWithCtx: vi.fn(),
}));

vi.mock("../application/queries/getTransactions", () => ({
  getCompletedTransactions: vi.fn(),
  getRecentTransactionsWithCustomers: vi.fn(),
  getTodaySummary: vi.fn(),
  getTransaction: vi.fn(),
  getTransactionById: vi.fn(),
  getTransactionsByStore: vi.fn(),
}));

vi.mock("../application/commands/adjustTransactionItems", () => ({
  adjustTransactionItems: vi.fn(),
}));

vi.mock("../application/commands/correctTransaction", () => ({
  correctTransactionCustomer: vi.fn(),
  correctTransactionPaymentMethod: vi.fn(),
}));

vi.mock("../application/commands/completeTransaction", () => ({
  completeTransaction: vi.fn(),
  createTransactionFromSessionHandler: vi.fn(),
  updateInventory: vi.fn(),
  voidTransaction: vi.fn(),
}));

type SerializedValidator = {
  type: string;
  value?: SerializedValidator[] | Record<string, SerializedValidator & { fieldType?: SerializedValidator; optional?: boolean }>;
};

function exportReturns(definition: unknown): string {
  return (definition as { exportReturns(): string }).exportReturns();
}

function parseValidator(validator: unknown): SerializedValidator {
  return JSON.parse(String(validator)) as SerializedValidator;
}

function getHandler(definition: unknown) {
  return (definition as { _handler: Function })._handler;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("POS public transaction query validators", () => {
  it("validates representative public transaction results against exported return validators", () => {
    const validationError = {
      kind: "user_error" as const,
      error: {
        code: "validation_failed" as const,
        message: "Validation failed.",
      },
    };

    assertConformsToExportedReturns(completeTransaction, validationError);
    assertConformsToExportedReturns(getCompletedTransactions, []);
    assertConformsToExportedReturns(getTransactionById, null);
    assertConformsToExportedReturns(voidTransaction, validationError);
    assertConformsToExportedReturns(createTransactionFromSession, validationError);
    assertConformsToExportedReturns(correctTransactionCustomer, validationError);
    assertConformsToExportedReturns(
      correctTransactionPaymentMethod,
      validationError,
    );
    assertConformsToExportedReturns(adjustTransactionItems, validationError);
    assertConformsToExportedReturns(getRecentTransactionsWithCustomers, []);
    assertConformsToExportedReturns(markReceiptPrinted, {
      kind: "ok" as const,
      data: null,
    });
    assertConformsToExportedReturns(getTodaySummary, {
      averageTransaction: 0,
      date: "2026-06-19",
      operatorSnapshot: {
        busiestHour: null,
        comparison: {
          averageTransactionDeltaPercent: 0,
          currentAverageTransaction: 0,
          currentItemsSold: 0,
          currentSales: 0,
          currentTransactions: 0,
          itemsSoldDeltaPercent: 0,
          salesDeltaPercent: 0,
          transactionDeltaPercent: 0,
          yesterdayAverageTransaction: 0,
          yesterdayItemsSold: 0,
          yesterdaySales: 0,
          yesterdayTransactions: 0,
        },
        historyDays: 14,
        isLimited: false,
        paymentMix: [],
        topItems: [],
        trend: [],
        usableHistoryDays: 0,
      },
      totalItemsSold: 0,
      totalSales: 0,
      totalTransactions: 0,
    });
  });

  it("allows payment correction to return inline approval requirements", () => {
    const validator = parseValidator(exportReturns(correctTransactionPaymentMethod));

    expect(validator.type).toBe("union");
    expect(JSON.stringify(validator)).toContain("approval_required");
    expect(JSON.stringify(validator)).toContain("inline_manager_proof");
  });

  it("allows item adjustments to return inline approval requirements", () => {
    const validator = parseValidator(exportReturns(adjustTransactionItems));

    expect(validator.type).toBe("union");
    expect(JSON.stringify(validator)).toContain("approval_required");
    expect(JSON.stringify(validator)).toContain("inline_manager_proof");
    expect(JSON.stringify(validator)).toContain("posTransactionAdjustment");
  });

  it("allows completed transaction voids to return approval requirements and stable success data", () => {
    const validator = parseValidator(exportReturns(voidTransaction));
    const validatorJson = JSON.stringify(validator);

    expect(validator.type).toBe("union");
    expect(validatorJson).toContain("approval_required");
    expect(validatorJson).toContain("inline_manager_proof");
    expect(validatorJson).toContain("paymentAllocation");
    expect(validatorJson).toContain("inventoryMovement");
    expect(validatorJson).toContain("operationalEvent");
    expect(validatorJson).toContain("approvalProof");
    expect(validatorJson).toContain("voidedAt");
  });

  it("exposes session trace ids for completed transaction lists", () => {
    const validator = parseValidator(exportReturns(getCompletedTransactions));

    expect(validator.type).toBe("array");
    expect(validator.value).toMatchObject({
      type: "object",
      value: {
        sessionTraceId: expect.any(Object),
        paymentMethods: {
          fieldType: {
            type: "array",
            value: { type: "string" },
          },
          optional: false,
        },
        hasMultiplePaymentMethods: {
          fieldType: { type: "boolean" },
          optional: false,
        },
        status: expect.any(Object),
        voidedAt: expect.any(Object),
        serviceLineCount: {
          fieldType: { type: "number" },
          optional: false,
        },
        servicePaymentTotal: {
          fieldType: { type: "number" },
          optional: false,
        },
      },
    });
  });

  it("exposes session trace, terminal, and service line fields for transaction details", () => {
    const validator = parseValidator(exportReturns(getTransactionById));

    expect(validator.type).toBe("union");
    expect(Array.isArray(validator.value)).toBe(true);
    expect((validator.value as SerializedValidator[])[1]).toMatchObject({
      type: "object",
      value: {
        sessionTraceId: expect.any(Object),
        terminalId: expect.any(Object),
        serviceLines: {
          fieldType: {
            type: "array",
            value: {
              type: "object",
              value: {
                serviceCaseId: expect.any(Object),
                serviceCaseTitle: expect.any(Object),
                servicePaymentStatus: expect.any(Object),
                serviceStatus: expect.any(Object),
                totalPrice: expect.any(Object),
              },
            },
          },
          optional: false,
        },
        serviceLineCount: {
          fieldType: { type: "number" },
          optional: false,
        },
        servicePaymentTotal: {
          fieldType: { type: "number" },
          optional: false,
        },
      },
    });
  });
});

describe("POS public transaction read and correction authorization", () => {
  beforeEach(() => {
    vi.mocked(athenaUserAuth.requireAuthenticatedAthenaUserWithCtx).mockResolvedValue({
      _id: "user-1",
    } as never);
  });

  function createTransactionAuthCtx(options?: {
    customerStoreId?: string;
    staffStoreId?: string;
  }) {
    return {
      db: {
        get: vi.fn(async (tableName: string, id: string) => {
          if (tableName === "store" && id === "store-1") {
            return { _id: "store-1", organizationId: "org-1" };
          }
          if (tableName === "staffProfile" && id === "staff-1") {
            return {
              _id: "staff-1",
              status: "active",
              storeId: options?.staffStoreId ?? "store-1",
            };
          }
          if (tableName === "customerProfile" && id === "customer-1") {
            return {
              _id: "customer-1",
              fullName: "Akos Customer",
              storeId: options?.customerStoreId ?? "store-1",
            };
          }
          return null;
        }),
      },
    };
  }

  function createMembership(role: "full_admin" | "pos_only") {
    return {
      _creationTime: 0,
      _id: `member-${role}` as Id<"organizationMember">,
      organizationId: "org-1" as Id<"organization">,
      role,
      userId: "user-1" as Id<"athenaUser">,
    };
  }

  function createStorePulseSummary(): Awaited<
    ReturnType<typeof transactionQueries.getTodaySummary>
  > {
    return {
      averageTransaction: 8215,
      date: "2026-06-21",
      operatorSnapshot: {
        busiestHour: {
          hour: 12,
          label: "12 PM",
          totalSales: 8215,
          transactionCount: 3,
        },
        comparison: {
          averageTransactionDeltaPercent: -37,
          currentAverageTransaction: 2738.33,
          currentItemsSold: 15,
          currentSales: 8215,
          currentTransactions: 3,
          itemsSoldDeltaPercent: -17,
          salesDeltaPercent: -37,
          transactionDeltaPercent: -40,
          yesterdayAverageTransaction: 4338,
          yesterdayItemsSold: 18,
          yesterdaySales: 13014,
          yesterdayTransactions: 5,
        },
        historyDays: 14,
        isLimited: false,
        paymentMix: [
          {
            count: 1,
            label: "Mobile money",
            method: "mobile_money",
            share: 82,
            total: 6800,
          },
        ],
        topItems: [
          {
            name: "Jowo",
            productSku: "JOWO",
            quantity: 5,
            totalSales: 4000,
          },
        ],
        trend: [
          {
            averageTransaction: 6507,
            date: "2026-06-20",
            label: "Jun 20",
            totalItemsSold: 18,
            totalSales: 13014,
            transactionCount: 5,
          },
          {
            averageTransaction: 2738.33,
            date: "2026-06-21",
            label: "Jun 21",
            totalItemsSold: 15,
            totalSales: 8215,
            transactionCount: 3,
          },
        ],
        usableHistoryDays: 2,
      },
      totalItemsSold: 15,
      totalSales: 8215,
      totalTransactions: 3,
    };
  }

  it("requires store membership before returning completed transactions", async () => {
    vi.mocked(transactionQueries.getCompletedTransactions).mockResolvedValue([
      {
        _id: "txn-1",
        transactionNumber: "SALE-1",
      },
    ] as never);
    const ctx = createTransactionAuthCtx();

    await getHandler(getCompletedTransactions)(ctx as never, {
      storeId: "store-1" as Id<"store">,
    });

    expect(athenaUserAuth.requireOrganizationMemberRoleWithCtx).toHaveBeenCalledWith(
      ctx,
      {
        allowedRoles: ["full_admin", "pos_only"],
        failureMessage: "You cannot view POS transactions for this store.",
        organizationId: "org-1",
        userId: "user-1",
      },
    );
    expect(transactionQueries.getCompletedTransactions).toHaveBeenCalled();
  });

  it("forces today's redacted POS pulse summary for non-full-admin store members", async () => {
    vi.mocked(
      athenaUserAuth.requireOrganizationMemberRoleWithCtx,
    ).mockResolvedValue(createMembership("pos_only"));
    vi.mocked(transactionQueries.getTodaySummary).mockResolvedValue(
      createStorePulseSummary(),
    );
    const ctx = createTransactionAuthCtx();

    const result = await getHandler(getTodaySummary)(ctx as never, {
      pulseWindow: "all_time",
      storeId: "store-1" as Id<"store">,
    });

    expect(transactionQueries.getTodaySummary).toHaveBeenCalledWith(ctx, {
      pulseWindow: "today",
      storeId: "store-1",
    });
    expect(result).toMatchObject({
      averageTransaction: 0,
      totalItemsSold: 15,
      totalSales: 0,
      totalTransactions: 3,
    });
    expect(result.operatorSnapshot.comparison).toMatchObject({
      currentItemsSold: 15,
      currentSales: 0,
      currentTransactions: 3,
      itemsSoldDeltaPercent: 0,
      salesDeltaPercent: 0,
      transactionDeltaPercent: 0,
      yesterdaySales: 0,
      yesterdayTransactions: 0,
    });
    expect(result.operatorSnapshot.busiestHour).toBeNull();
    expect(result.operatorSnapshot.paymentMix).toEqual([]);
    expect(result.operatorSnapshot.topItems).toEqual([]);
    expect(result.operatorSnapshot.trend).toEqual([]);
  });

  it("keeps the requested POS pulse window and financial fields for full admins", async () => {
    const summary = createStorePulseSummary();
    vi.mocked(
      athenaUserAuth.requireOrganizationMemberRoleWithCtx,
    ).mockResolvedValue(createMembership("full_admin"));
    vi.mocked(transactionQueries.getTodaySummary).mockResolvedValue(summary);
    const ctx = createTransactionAuthCtx();

    const result = await getHandler(getTodaySummary)(ctx as never, {
      pulseWindow: "all_time",
      storeId: "store-1" as Id<"store">,
    });

    expect(transactionQueries.getTodaySummary).toHaveBeenCalledWith(ctx, {
      pulseWindow: "all_time",
      storeId: "store-1",
    });
    expect(result).toBe(summary);
  });

  it.each([
    [
      "getTransactionsByStore",
      getTransactionsByStore,
      transactionQueries.getTransactionsByStore,
      { storeId: "store-1" },
    ],
    [
      "getRecentTransactionsWithCustomers",
      getRecentTransactionsWithCustomers,
      transactionQueries.getRecentTransactionsWithCustomers,
      { storeId: "store-1" },
    ],
    ["getTodaySummary", getTodaySummary, transactionQueries.getTodaySummary, { storeId: "store-1" }],
  ])("does not run %s when store authorization fails", async (_label, definition, queryMock, args) => {
    vi.mocked(transactionQueries.getTransaction).mockResolvedValue({
      _id: "txn-1",
      storeId: "store-1",
    } as never);
    vi.mocked(
      athenaUserAuth.requireOrganizationMemberRoleWithCtx,
    ).mockRejectedValueOnce(new Error("denied"));

    await expect(
      getHandler(definition)(createTransactionAuthCtx() as never, args),
    ).rejects.toThrow("denied");

    expect(queryMock).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining(args),
    );
  });

  it("derives the actor and validates staff/store before correcting transaction customer", async () => {
    vi.mocked(transactionQueries.getTransaction).mockResolvedValue({
      _id: "txn-1",
      storeId: "store-1",
    } as never);
    vi.mocked(correctionCommands.correctTransactionCustomer).mockResolvedValue({
      transactionId: "txn-1",
      customerProfileId: "customer-1",
    } as never);
    const ctx = createTransactionAuthCtx();

    await expect(
      getHandler(correctTransactionCustomer)(ctx as never, {
        actorStaffProfileId: "staff-1" as Id<"staffProfile">,
        actorUserId: "forged-user" as Id<"athenaUser">,
        customerProfileId: "customer-1" as Id<"customerProfile">,
        reason: "Wrong customer",
        transactionId: "txn-1" as Id<"posTransaction">,
      }),
    ).resolves.toMatchObject({ kind: "ok" });

    expect(correctionCommands.correctTransactionCustomer).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        actorUserId: "user-1",
        customerProfileId: "customer-1",
        transactionId: "txn-1",
      }),
    );
  });

  it("derives the actor and validates staff/store before correcting transaction payment method", async () => {
    vi.mocked(transactionQueries.getTransaction).mockResolvedValue({
      _id: "txn-1",
      storeId: "store-1",
    } as never);
    vi.mocked(correctionCommands.correctTransactionPaymentMethod).mockResolvedValue({
      paymentMethod: "card",
      previousPaymentMethod: "cash",
      transactionId: "txn-1",
    } as never);
    const ctx = createTransactionAuthCtx();

    await expect(
      getHandler(correctTransactionPaymentMethod)(ctx as never, {
        actorStaffProfileId: "staff-1" as Id<"staffProfile">,
        actorUserId: "forged-user" as Id<"athenaUser">,
        paymentMethod: "card",
        reason: "Wrong payment method",
        transactionId: "txn-1" as Id<"posTransaction">,
      }),
    ).resolves.toMatchObject({ kind: "ok" });

    expect(correctionCommands.correctTransactionPaymentMethod).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        actorUserId: "user-1",
        paymentMethod: "card",
        transactionId: "txn-1",
      }),
    );
  });

  it("rejects cross-store customer correction before invoking the command", async () => {
    vi.mocked(transactionQueries.getTransaction).mockResolvedValue({
      _id: "txn-1",
      storeId: "store-1",
    } as never);

    await expect(
      getHandler(correctTransactionCustomer)(
        createTransactionAuthCtx({ customerStoreId: "store-2" }) as never,
        {
          actorStaffProfileId: "staff-1" as Id<"staffProfile">,
          customerProfileId: "customer-1" as Id<"customerProfile">,
          reason: "Wrong customer",
          transactionId: "txn-1" as Id<"posTransaction">,
        },
      ),
    ).resolves.toMatchObject({
      kind: "user_error",
      error: {
        code: "precondition_failed",
      },
    });

    expect(correctionCommands.correctTransactionCustomer).not.toHaveBeenCalled();
  });
});

describe("legacy POS public checkout mutations", () => {
  beforeEach(() => {
    vi.mocked(athenaUserAuth.requireAuthenticatedAthenaUserWithCtx).mockResolvedValue({
      _id: "user-1",
    } as never);
  });

  function createCtx() {
    return {
      db: {
        get: vi.fn(async (tableName: string, id: string) => {
          if (tableName === "store" && id === "store-1") {
            return { _id: "store-1", organizationId: "org-1" };
          }
          if (tableName === "productSku" && id === "sku-1") {
            return { _id: "sku-1", storeId: "store-1" };
          }
          return null;
        }),
      },
    };
  }

  it("limits direct completeTransaction to full admins before invoking the command", async () => {
    vi.mocked(completeTransactionCommands.completeTransaction).mockResolvedValue({
      kind: "ok",
      data: {
        transactionId: "txn-1",
        transactionItems: [],
        transactionNumber: "POS-001",
      },
    } as never);
    const ctx = createCtx();

    await expect(
      getHandler(completeTransaction)(ctx as never, {
        storeId: "store-1" as Id<"store">,
        items: [],
        payments: [{ method: "cash", amount: 0 }],
        subtotal: 0,
        tax: 0,
        total: 0,
        registerSessionId: "register-1" as Id<"registerSession">,
        staffProfileId: "staff-1" as Id<"staffProfile">,
        terminalId: "terminal-1" as Id<"posTerminal">,
      }),
    ).resolves.toMatchObject({ kind: "ok" });

    expect(
      athenaUserAuth.requireOrganizationMemberRoleWithCtx,
    ).toHaveBeenCalledWith(ctx, {
      allowedRoles: ["full_admin"],
      failureMessage: "You cannot complete this POS sale.",
      organizationId: "org-1",
      userId: "user-1",
    });
    expect(completeTransactionCommands.completeTransaction).toHaveBeenCalled();
  });

  it("does not complete a direct transaction without register staff and terminal context", async () => {
    const ctx = createCtx();

    await expect(
      getHandler(completeTransaction)(ctx as never, {
        storeId: "store-1" as Id<"store">,
        items: [],
        payments: [{ method: "cash", amount: 0 }],
        subtotal: 0,
        tax: 0,
        total: 0,
      }),
    ).resolves.toMatchObject({
      kind: "user_error",
      error: {
        code: "validation_failed",
      },
    });

    expect(completeTransactionCommands.completeTransaction).not.toHaveBeenCalled();
  });

  it("does not complete a direct transaction when authorization fails", async () => {
    vi.mocked(
      athenaUserAuth.requireOrganizationMemberRoleWithCtx,
    ).mockRejectedValueOnce(new Error("You cannot complete this POS sale."));
    const ctx = createCtx();

    await expect(
      getHandler(completeTransaction)(ctx as never, {
        storeId: "store-1" as Id<"store">,
        items: [],
        payments: [{ method: "cash", amount: 0 }],
        subtotal: 0,
        tax: 0,
        total: 0,
      }),
    ).rejects.toThrow("You cannot complete this POS sale.");

    expect(completeTransactionCommands.completeTransaction).not.toHaveBeenCalled();
  });

  it("marks a transaction receipt as printed after authorization", async () => {
    vi.mocked(transactionQueries.getTransaction).mockResolvedValue({
      _id: "txn-1",
      storeId: "store-1",
      receiptPrinted: false,
    } as never);
    const patch = vi.fn();
    const ctx = {
      db: {
        get: vi.fn(async (tableName: string, id: string) => {
          if (tableName === "store" && id === "store-1") {
            return { _id: "store-1", organizationId: "org-1" };
          }
          return null;
        }),
        patch,
      },
    };

    await expect(
      getHandler(markReceiptPrinted)(ctx as never, {
        transactionId: "txn-1" as Id<"posTransaction">,
      }),
    ).resolves.toEqual({
      kind: "ok",
      data: null,
    });

    expect(patch).toHaveBeenCalledWith("posTransaction", "txn-1", {
      receiptPrinted: true,
    });
    expect(
      athenaUserAuth.requireOrganizationMemberRoleWithCtx,
    ).toHaveBeenCalledWith(ctx, {
      allowedRoles: ["full_admin", "pos_only"],
      failureMessage: "You cannot update this transaction.",
      organizationId: "org-1",
      userId: "user-1",
    });
  });

  it("does not patch a transaction whose receipt was already printed", async () => {
    vi.mocked(transactionQueries.getTransaction).mockResolvedValue({
      _id: "txn-1",
      storeId: "store-1",
      receiptPrinted: true,
    } as never);
    const patch = vi.fn();
    const ctx = {
      db: {
        get: vi.fn(async (tableName: string, id: string) => {
          if (tableName === "store" && id === "store-1") {
            return { _id: "store-1", organizationId: "org-1" };
          }
          return null;
        }),
        patch,
      },
    };

    await expect(
      getHandler(markReceiptPrinted)(ctx as never, {
        transactionId: "txn-1" as Id<"posTransaction">,
      }),
    ).resolves.toEqual({
      kind: "ok",
      data: null,
    });

    expect(patch).not.toHaveBeenCalled();
  });

  it("does not patch a receipt print when authorization fails", async () => {
    vi.mocked(transactionQueries.getTransaction).mockResolvedValue({
      _id: "txn-1",
      storeId: "store-1",
      receiptPrinted: false,
    } as never);
    vi.mocked(
      athenaUserAuth.requireOrganizationMemberRoleWithCtx,
    ).mockRejectedValueOnce(new Error("You cannot update this transaction."));
    const patch = vi.fn();
    const ctx = {
      db: {
        get: vi.fn(async (tableName: string, id: string) => {
          if (tableName === "store" && id === "store-1") {
            return { _id: "store-1", organizationId: "org-1" };
          }
          return null;
        }),
        patch,
      },
    };

    await expect(
      getHandler(markReceiptPrinted)(ctx as never, {
        transactionId: "txn-1" as Id<"posTransaction">,
      }),
    ).rejects.toThrow("You cannot update this transaction.");

    expect(patch).not.toHaveBeenCalled();
  });

  it("returns a command error when receipt print transaction is not found", async () => {
    vi.mocked(transactionQueries.getTransaction).mockResolvedValue(null);
    const patch = vi.fn();
    const ctx = {
      db: {
        get: vi.fn(),
        patch,
      },
    };

    await expect(
      getHandler(markReceiptPrinted)(ctx as never, {
        transactionId: "txn-1" as Id<"posTransaction">,
      }),
    ).resolves.toEqual({
      kind: "user_error",
      error: expect.objectContaining({
        code: "not_found",
        message: "Transaction not found.",
      }),
    });

    expect(patch).not.toHaveBeenCalled();
  });

  it("authorizes direct inventory updates by SKU store before invoking the command", async () => {
    vi.mocked(completeTransactionCommands.updateInventory).mockResolvedValue({
      kind: "ok",
      data: { productSkuId: "sku-1" },
    } as never);
    const ctx = createCtx();

    await getHandler(updateInventory)(ctx as never, {
      skuId: "sku-1" as Id<"productSku">,
      quantityToSubtract: 2,
    });

    expect(
      athenaUserAuth.requireOrganizationMemberRoleWithCtx,
    ).toHaveBeenCalledWith(ctx, {
      allowedRoles: ["full_admin", "pos_only"],
      failureMessage: "You cannot update POS inventory for this store.",
      organizationId: "org-1",
      userId: "user-1",
    });
    expect(completeTransactionCommands.updateInventory).toHaveBeenCalledWith(
      ctx,
      {
        skuId: "sku-1",
        quantityToSubtract: 2,
      },
    );
  });

  it("does not update inventory when SKU-store authorization fails", async () => {
    vi.mocked(
      athenaUserAuth.requireOrganizationMemberRoleWithCtx,
    ).mockRejectedValueOnce(
      new Error("You cannot update POS inventory for this store."),
    );
    const ctx = createCtx();

    await expect(
      getHandler(updateInventory)(ctx as never, {
        skuId: "sku-1" as Id<"productSku">,
        quantityToSubtract: 2,
      }),
    ).rejects.toThrow("You cannot update POS inventory for this store.");

    expect(completeTransactionCommands.updateInventory).not.toHaveBeenCalled();
  });
});

describe("voidTransaction public mutation", () => {
  function createAuthorizedVoidCtx(overrides?: {
    credential?: Record<string, unknown> | null;
    proof?: Record<string, unknown> | null;
    staffProfile?: Record<string, unknown> | null;
  }) {
    const staffProof = {
      _id: "proof-row-1",
      credentialId: "credential-1",
      credentialVersion: 3,
      expiresAt: Date.now() + 60_000,
      staffProfileId: "staff-1",
      status: "active",
      storeId: "store-1",
      terminalId: "terminal-1",
      ...overrides?.proof,
    };
    const staffProfile = {
      _id: "staff-1",
      status: "active",
      storeId: "store-1",
      ...overrides?.staffProfile,
    };
    const credential = {
      _id: "credential-1",
      localVerifierVersion: 3,
      staffProfileId: "staff-1",
      status: "active",
      storeId: "store-1",
      ...overrides?.credential,
    };

    vi.mocked(transactionQueries.getTransaction).mockResolvedValue({
      _id: "txn-1",
      storeId: "store-1",
      terminalId: "terminal-1",
    } as never);
    vi.mocked(athenaUserAuth.requireAuthenticatedAthenaUserWithCtx).mockResolvedValue({
      _id: "user-1",
    } as never);

    return {
      db: {
        get: vi.fn(async (tableName: string, id: string) => {
          if (tableName === "store" && id === "store-1") {
            return { _id: "store-1", organizationId: "org-1" };
          }
          if (tableName === "staffProfile" && id === "staff-1") {
            return overrides?.staffProfile === null ? null : staffProfile;
          }
          if (tableName === "staffCredential" && id === "credential-1") {
            return credential;
          }
          return null;
        }),
        patch: vi.fn(),
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            unique: vi.fn(async () =>
              overrides?.proof === null ? null : staffProof,
            ),
          })),
        })),
      },
    };
  }

  it("requires a signed-in staff actor before voiding a completed transaction", async () => {
    await expect(
      getHandler(voidTransaction)({} as never, {
        reason: "Duplicate sale",
        transactionId: "txn-1" as Id<"posTransaction">,
      }),
    ).resolves.toMatchObject({
      kind: "user_error",
      error: {
        code: "authentication_failed",
      },
    });

    expect(completeTransactionCommands.voidTransaction).not.toHaveBeenCalled();
  });

  it("wraps command approval requirements on the shared command-result rail", async () => {
    vi.mocked(completeTransactionCommands.voidTransaction).mockResolvedValue({
      approval: {
        action: {
          key: "pos.transaction.void",
        },
        copy: {
          title: "Manager approval required",
          message: "Review completed sale void.",
        },
        reason: "Manager approval is required.",
        requiredRole: "manager",
        resolutionModes: [{ kind: "inline_manager_proof" }],
        subject: {
          id: "txn-1",
          type: "pos_transaction",
        },
      },
      kind: "approval_required",
      transactionId: "txn-1",
    } as never);

    await expect(
      getHandler(voidTransaction)(createAuthorizedVoidCtx() as never, {
        actorStaffProfileId: "staff-1" as Id<"staffProfile">,
        reason: "Duplicate sale",
        staffProofToken: "proof-token-1",
        transactionId: "txn-1" as Id<"posTransaction">,
      }),
    ).resolves.toMatchObject({
      kind: "approval_required",
      approval: {
        action: {
          key: "pos.transaction.void",
        },
      },
    });
    expect(
      athenaUserAuth.requireOrganizationMemberRoleWithCtx,
    ).toHaveBeenCalledWith(expect.any(Object), {
      allowedRoles: ["full_admin", "pos_only"],
      failureMessage: "You cannot void this transaction.",
      organizationId: "org-1",
      userId: "user-1",
    });
    expect(completeTransactionCommands.voidTransaction).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        actorStaffProfileId: "staff-1",
        actorUserId: "user-1",
      }),
    );
    expect(
      vi.mocked(completeTransactionCommands.voidTransaction).mock.calls[0]?.[1],
    ).not.toHaveProperty("staffProofToken");
  });

  it("allows completed sale voids without an operator reason", async () => {
    vi.mocked(completeTransactionCommands.voidTransaction).mockResolvedValue({
      approval: {
        action: {
          key: "pos.transaction.void",
        },
        copy: {
          title: "Manager approval required",
          message: "Review completed sale void.",
        },
        reason: "Manager approval is required.",
        requiredRole: "manager",
        resolutionModes: [{ kind: "inline_manager_proof" }],
        subject: {
          id: "txn-1",
          type: "pos_transaction",
        },
      },
      kind: "approval_required",
      transactionId: "txn-1",
    } as never);

    await expect(
      getHandler(voidTransaction)(createAuthorizedVoidCtx() as never, {
        actorStaffProfileId: "staff-1" as Id<"staffProfile">,
        staffProofToken: "proof-token-1",
        transactionId: "txn-1" as Id<"posTransaction">,
      }),
    ).resolves.toMatchObject({
      kind: "approval_required",
    });

    expect(completeTransactionCommands.voidTransaction).toHaveBeenCalledWith(
      expect.any(Object),
      expect.not.objectContaining({
        reason: expect.anything(),
      }),
    );
  });

  it.each([
    ["missing staff profile", { staffProfile: null }],
    ["inactive staff profile", { staffProfile: { status: "inactive" } }],
    ["cross-store staff profile", { staffProfile: { storeId: "store-other" } }],
    ["missing staff proof", { proof: null }],
    ["expired staff proof", { proof: { expiresAt: Date.now() - 1 } }],
    ["mismatched staff proof", { proof: { staffProfileId: "staff-other" } }],
    ["cross-terminal staff proof", { proof: { terminalId: "terminal-other" } }],
    ["inactive staff credential", { credential: { status: "revoked" } }],
    [
      "mismatched staff credential",
      { credential: { staffProfileId: "staff-other" } },
    ],
  ])("rejects %s before invoking the void command", async (_label, overrides) => {
    await expect(
      getHandler(voidTransaction)(
        createAuthorizedVoidCtx(overrides as never) as never,
        {
          actorStaffProfileId: "staff-1" as Id<"staffProfile">,
          reason: "Duplicate sale",
          staffProofToken: "proof-token-1",
          transactionId: "txn-1" as Id<"posTransaction">,
        },
      ),
    ).resolves.toMatchObject({
      kind: "user_error",
      error: {
        code: "authentication_failed",
      },
    });
    expect(completeTransactionCommands.voidTransaction).not.toHaveBeenCalled();
  });

  it("does not use staff proof or invoke void command when authentication fails", async () => {
    vi.mocked(
      athenaUserAuth.requireAuthenticatedAthenaUserWithCtx,
    ).mockRejectedValueOnce(new Error("Sign in again to continue."));
    const ctx = createAuthorizedVoidCtx();

    await expect(
      getHandler(voidTransaction)(ctx as never, {
        actorStaffProfileId: "staff-1" as Id<"staffProfile">,
        reason: "Duplicate sale",
        staffProofToken: "proof-token-1",
        transactionId: "txn-1" as Id<"posTransaction">,
      }),
    ).rejects.toThrow("Sign in again to continue.");

    expect(ctx.db.patch).not.toHaveBeenCalled();
    expect(completeTransactionCommands.voidTransaction).not.toHaveBeenCalled();
  });

  it("does not use staff proof or invoke void command when authorization fails", async () => {
    vi.mocked(
      athenaUserAuth.requireOrganizationMemberRoleWithCtx,
    ).mockRejectedValueOnce(new Error("You cannot void this transaction."));
    const ctx = createAuthorizedVoidCtx();

    await expect(
      getHandler(voidTransaction)(ctx as never, {
        actorStaffProfileId: "staff-1" as Id<"staffProfile">,
        reason: "Duplicate sale",
        staffProofToken: "proof-token-1",
        transactionId: "txn-1" as Id<"posTransaction">,
      }),
    ).rejects.toThrow("You cannot void this transaction.");

    expect(ctx.db.patch).not.toHaveBeenCalled();
    expect(completeTransactionCommands.voidTransaction).not.toHaveBeenCalled();
  });
});

describe("createTransactionFromSession public mutation", () => {
  function createAuthorizedSessionCompletionCtx(overrides?: {
    session?: Record<string, unknown> | null;
    store?: Record<string, unknown> | null;
  }) {
    vi.mocked(athenaUserAuth.requireAuthenticatedAthenaUserWithCtx).mockResolvedValue({
      _id: "user-1",
    } as never);
    vi.mocked(
      completeTransactionCommands.createTransactionFromSessionHandler,
    ).mockResolvedValue({
      kind: "success",
      transactionId: "txn-1",
      transactionItems: ["item-1"],
      transactionNumber: "SALE-1",
    } as never);

    const session = {
      _id: "session-1",
      storeId: "store-1",
      ...overrides?.session,
    };
    const store = {
      _id: "store-1",
      organizationId: "org-1",
      ...overrides?.store,
    };

    return {
      db: {
        get: vi.fn(async (tableName: string, id: string) => {
          if (tableName === "posSession" && id === "session-1") {
            return overrides?.session === null ? null : session;
          }
          if (tableName === "store" && id === "store-1") {
            return overrides?.store === null ? null : store;
          }
          return null;
        }),
      },
    };
  }

  it("requires authenticated store access before completing a POS session", async () => {
    const ctx = createAuthorizedSessionCompletionCtx();

    await expect(
      getHandler(createTransactionFromSession)(ctx as never, {
        payments: [{ amount: 1000, method: "cash" }],
        sessionId: "session-1" as Id<"posSession">,
        staffProfileId: "staff-1" as Id<"staffProfile">,
      }),
    ).resolves.toMatchObject({
      kind: "success",
      transactionId: "txn-1",
    });

    expect(athenaUserAuth.requireAuthenticatedAthenaUserWithCtx).toHaveBeenCalledWith(
      ctx,
    );
    expect(
      athenaUserAuth.requireOrganizationMemberRoleWithCtx,
    ).toHaveBeenCalledWith(ctx, {
      allowedRoles: ["full_admin", "pos_only"],
      failureMessage: "You cannot complete this POS sale.",
      organizationId: "org-1",
      userId: "user-1",
    });
    expect(
      completeTransactionCommands.createTransactionFromSessionHandler,
    ).toHaveBeenCalledWith(ctx, expect.objectContaining({ sessionId: "session-1" }));
  });

  it("does not complete a POS session when store authorization fails", async () => {
    vi.mocked(
      athenaUserAuth.requireOrganizationMemberRoleWithCtx,
    ).mockRejectedValueOnce(new Error("You cannot complete this POS sale."));

    await expect(
      getHandler(createTransactionFromSession)(
        createAuthorizedSessionCompletionCtx() as never,
        {
          payments: [{ amount: 1000, method: "cash" }],
          sessionId: "session-1" as Id<"posSession">,
          staffProfileId: "staff-1" as Id<"staffProfile">,
        },
      ),
    ).rejects.toThrow("You cannot complete this POS sale.");

    expect(
      completeTransactionCommands.createTransactionFromSessionHandler,
    ).not.toHaveBeenCalled();
  });
});

describe("adjustTransactionItems public mutation", () => {
  const payload = {
    originalTotal: 1000,
    correctedTotal: 600,
    settlementAmount: 400,
    settlementDirection: "refund" as const,
    settlementMethod: "cash",
    lines: [
      {
        originalTransactionItemId: "item-1",
        productId: "product-1",
        productSkuId: "sku-1",
        productName: "Closure Wig",
        productSku: "SKU-1",
        originalQuantity: 2,
        adjustedQuantity: 1,
        unitPrice: 400,
        inventoryDelta: 1,
      },
    ],
  };

  function createAuthorizedItemAdjustmentCtx(overrides?: {
    credential?: Record<string, unknown> | null;
    proof?: Record<string, unknown> | null;
    staffProfile?: Record<string, unknown> | null;
  }) {
    const staffProof = {
      _id: "proof-row-1",
      credentialId: "credential-1",
      credentialVersion: 3,
      expiresAt: Date.now() + 60_000,
      staffProfileId: "staff-1",
      status: "active",
      storeId: "store-1",
      ...overrides?.proof,
    };
    const staffProfile = {
      _id: "staff-1",
      status: "active",
      storeId: "store-1",
      ...overrides?.staffProfile,
    };
    const credential = {
      _id: "credential-1",
      localVerifierVersion: 3,
      staffProfileId: "staff-1",
      status: "active",
      storeId: "store-1",
      ...overrides?.credential,
    };

    const ctx = {
      db: {
        get: vi.fn(async (tableName: string, id: string) => {
          if (tableName === "store" && id === "store-1") {
            return { _id: "store-1", organizationId: "org-1" };
          }
          if (tableName === "staffProfile" && id === "staff-1") {
            return overrides?.staffProfile === null ? null : staffProfile;
          }
          if (tableName === "staffCredential" && id === "credential-1") {
            return credential;
          }
          return null;
        }),
        patch: vi.fn(),
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            unique: vi.fn(async () => staffProof),
          })),
        })),
      },
    };

    vi.mocked(transactionQueries.getTransaction).mockResolvedValue({
      _id: "txn-1",
      storeId: "store-1",
    } as never);
    vi.mocked(athenaUserAuth.requireAuthenticatedAthenaUserWithCtx).mockResolvedValue({
      _id: "user-1",
    } as never);

    return ctx;
  }

  it("wraps command approval requirements on the shared command-result rail", async () => {
    vi.mocked(itemAdjustmentCommands.adjustTransactionItems).mockResolvedValue({
      action: "approval_required",
      approval: {
        action: {
          key: "pos.transaction.adjust_items",
        },
        copy: {
          title: "Manager approval required",
          message: "Review item adjustment.",
        },
        reason: "Manager approval is required.",
        requiredRole: "manager",
        resolutionModes: [{ kind: "inline_manager_proof" }],
        subject: {
          id: "pos_transaction_item_adjustment:txn-1:fingerprint",
          type: "pos_transaction_item_adjustment",
        },
      },
      payloadFingerprint: "fingerprint",
      settlementAmount: 400,
      settlementDirection: "refund",
      transactionId: "txn-1",
    } as never);

    await expect(
      getHandler(adjustTransactionItems)(createAuthorizedItemAdjustmentCtx() as never, {
        actorStaffProfileId: "staff-1",
        payload,
        reason: "Customer was charged for two instead of one",
        staffProofToken: "proof-token-1",
        transactionId: "txn-1",
      }),
    ).resolves.toMatchObject({
      kind: "approval_required",
      approval: {
        action: {
          key: "pos.transaction.adjust_items",
        },
      },
    });
    expect(
      athenaUserAuth.requireOrganizationMemberRoleWithCtx,
    ).toHaveBeenCalledWith(expect.any(Object), {
      allowedRoles: ["full_admin", "pos_only"],
      failureMessage: "You cannot adjust transaction items.",
      organizationId: "org-1",
      userId: "user-1",
    });
    expect(itemAdjustmentCommands.adjustTransactionItems).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        actorStaffProfileId: "staff-1",
        actorUserId: "user-1",
      }),
    );
  });

  it("surfaces register-session expected cash failures as item adjustment user errors", async () => {
    vi.mocked(itemAdjustmentCommands.adjustTransactionItems).mockRejectedValue(
      new Error("Register session expected cash cannot be negative."),
    );

    await expect(
      getHandler(adjustTransactionItems)(createAuthorizedItemAdjustmentCtx() as never, {
        actorStaffProfileId: "staff-1",
        payload,
        reason: "Customer was charged for two instead of one",
        staffProofToken: "proof-token-1",
        transactionId: "txn-1",
      }),
    ).resolves.toMatchObject({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message: "Register session expected cash cannot be negative.",
      },
    });
  });

  it("requires a signed-in staff actor before adjusting items", async () => {
    await expect(
      getHandler(adjustTransactionItems)({} as never, {
        payload,
        reason: "Customer was charged for two instead of one",
        staffProofToken: "proof-token-1",
        transactionId: "txn-1",
      }),
    ).resolves.toMatchObject({
      kind: "user_error",
      error: {
        code: "authentication_failed",
      },
    });
    expect(itemAdjustmentCommands.adjustTransactionItems).not.toHaveBeenCalled();
  });

  it.each([
    ["missing staff profile", { staffProfile: null }],
    [
      "inactive staff profile",
      { staffProfile: { status: "inactive" } },
    ],
    [
      "cross-store staff profile",
      { staffProfile: { storeId: "store-other" } },
    ],
    ["missing staff proof", { proof: null }],
    [
      "expired staff proof",
      { proof: { expiresAt: Date.now() - 1 } },
    ],
    [
      "mismatched staff proof",
      { proof: { staffProfileId: "staff-other" } },
    ],
    [
      "inactive staff credential",
      { credential: { status: "revoked" } },
    ],
    [
      "mismatched staff credential",
      { credential: { staffProfileId: "staff-other" } },
    ],
  ])(
    "rejects %s before invoking the adjustment command",
    async (_label, overrides) => {
      const ctx = createAuthorizedItemAdjustmentCtx(overrides as never);
      if ((overrides as { proof?: unknown }).proof === null) {
        vi.mocked(ctx.db.query).mockReturnValueOnce({
          withIndex: vi.fn(() => ({
            unique: vi.fn(async () => null),
          })),
        } as never);
      }

      await expect(
        getHandler(adjustTransactionItems)(ctx as never, {
          actorStaffProfileId: "staff-1",
          payload,
          reason: "Customer was charged for two instead of one",
          staffProofToken: "proof-token-1",
          transactionId: "txn-1",
        }),
      ).resolves.toMatchObject({
        kind: "user_error",
        error: {
          code: "authentication_failed",
        },
      });
      expect(itemAdjustmentCommands.adjustTransactionItems).not.toHaveBeenCalled();
    },
  );
});

describe("getTransactionById public query authorization", () => {
  it("requires a same-organization POS role before returning receipt delivery metadata", async () => {
    vi.mocked(transactionQueries.getTransaction).mockResolvedValue({
      _id: "txn-1",
      storeId: "store-1",
    } as never);
    vi.mocked(transactionQueries.getTransactionById).mockResolvedValue({
      _id: "txn-1",
      receiptDeliveryHistory: [],
    } as never);
    vi.mocked(athenaUserAuth.requireAuthenticatedAthenaUserWithCtx).mockResolvedValue({
      _id: "user-1",
    } as never);

    const ctx = {
      db: {
        get: vi.fn().mockResolvedValue({
          _id: "store-1",
          organizationId: "org-1",
        }),
      },
    };

    const result = await getHandler(getTransactionById)(ctx, {
      transactionId: "txn-1",
    });

    expect(result).toEqual(
      expect.objectContaining({
        _id: "txn-1",
        receiptDeliveryHistory: [],
      }),
    );
    expect(
      athenaUserAuth.requireOrganizationMemberRoleWithCtx,
    ).toHaveBeenCalledWith(ctx, {
      allowedRoles: ["full_admin", "pos_only"],
      failureMessage: "You cannot view this transaction.",
      organizationId: "org-1",
      userId: "user-1",
    });
  });

  it("does not load rich transaction detail when the user is unauthenticated", async () => {
    vi.mocked(transactionQueries.getTransaction).mockResolvedValue({
      _id: "txn-1",
      storeId: "store-1",
    } as never);
    vi.mocked(athenaUserAuth.requireAuthenticatedAthenaUserWithCtx).mockRejectedValue(
      new Error("Sign in again to continue."),
    );

    const ctx = {
      db: {
        get: vi.fn().mockResolvedValue({
          _id: "store-1",
          organizationId: "org-1",
        }),
      },
    };

    await expect(
      getHandler(getTransactionById)(ctx, { transactionId: "txn-1" }),
    ).rejects.toThrow("Sign in again to continue.");
    expect(transactionQueries.getTransactionById).not.toHaveBeenCalled();
  });
});
