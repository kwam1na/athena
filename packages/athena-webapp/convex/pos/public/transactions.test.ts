import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  adjustTransactionItems,
  correctTransactionPaymentMethod,
  getCompletedTransactions,
  getTransactionById,
} from "./transactions";
import * as athenaUserAuth from "../../lib/athenaUserAuth";
import * as itemAdjustmentCommands from "../application/commands/adjustTransactionItems";
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
      },
    });
  });

  it("exposes session trace ids for transaction details", () => {
    const validator = parseValidator(exportReturns(getTransactionById));

    expect(validator.type).toBe("union");
    expect(Array.isArray(validator.value)).toBe(true);
    expect((validator.value as SerializedValidator[])[1]).toMatchObject({
      type: "object",
      value: {
        sessionTraceId: expect.any(Object),
      },
    });
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
