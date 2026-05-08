import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  correctTransactionPaymentMethod,
  getCompletedTransactions,
  getTransactionById,
} from "./transactions";
import * as athenaUserAuth from "../../lib/athenaUserAuth";
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
