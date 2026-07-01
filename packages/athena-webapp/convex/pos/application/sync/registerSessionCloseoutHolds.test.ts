import { describe, expect, it, vi } from "vitest";
import type { Doc, Id } from "../../../_generated/dataModel";
import type { QueryCtx } from "../../../_generated/server";

import { buildPendingCompletedSaleVoidApprovalSummary } from "./registerSessionCloseoutHolds";

describe("buildPendingCompletedSaleVoidApprovalSummary", () => {
  it("summarizes only the cash component of pending sale void approvals", async () => {
    const registerSessionId = "register-session-1" as Id<"registerSession">;
    const storeId = "store-1" as Id<"store">;
    const cashTransactionId = "transaction-cash" as Id<"posTransaction">;
    const cardTransactionId = "transaction-card" as Id<"posTransaction">;
    const transactions = new Map<Id<"posTransaction">, Doc<"posTransaction">>([
      [
        cashTransactionId,
        {
          _id: cashTransactionId,
          _creationTime: 1,
          changeGiven: 2000,
          completedAt: 1,
          payments: [
            { amount: 10000, method: "cash", timestamp: 1 },
            { amount: 5000, method: "card", timestamp: 1 },
          ],
          registerSessionId,
          status: "completed",
          storeId,
          subtotal: 15000,
          tax: 0,
          total: 15000,
          totalPaid: 15000,
          transactionNumber: "TXN-CASH",
        } as Doc<"posTransaction">,
      ],
      [
        cardTransactionId,
        {
          _id: cardTransactionId,
          _creationTime: 2,
          completedAt: 2,
          payments: [{ amount: 12000, method: "card", timestamp: 2 }],
          registerSessionId,
          status: "completed",
          storeId,
          subtotal: 12000,
          tax: 0,
          total: 12000,
          totalPaid: 12000,
          transactionNumber: "TXN-CARD",
        } as Doc<"posTransaction">,
      ],
    ]);
    const ctx = {
      db: {
        get: vi.fn(async (_table: "posTransaction", id: Id<"posTransaction">) =>
          transactions.get(id) ?? null,
        ),
      },
    } as unknown as Pick<QueryCtx, "db">;

    const summary = await buildPendingCompletedSaleVoidApprovalSummary(ctx, {
      approvalRequests: [
        {
          _id: "approval-cash" as Id<"approvalRequest">,
          _creationTime: 1,
          createdAt: 1,
          metadata: { transactionNumber: "TXN-CASH" },
          posTransactionId: cashTransactionId,
          requestType: "pos_transaction_void",
          status: "pending",
          storeId,
          subjectId: cashTransactionId,
          subjectType: "pos_transaction",
        } as Doc<"approvalRequest">,
        {
          _id: "approval-card" as Id<"approvalRequest">,
          _creationTime: 2,
          createdAt: 2,
          metadata: { transactionNumber: "TXN-CARD" },
          posTransactionId: cardTransactionId,
          requestType: "pos_transaction_void",
          status: "pending",
          storeId,
          subjectId: cardTransactionId,
          subjectType: "pos_transaction",
        } as Doc<"approvalRequest">,
      ],
      registerSessionId,
      storeId,
    });

    expect(summary).toMatchObject({
      cashAffectingCount: 1,
      cashAmount: 8000,
      cashAdjustmentCount: 0,
      cashAdjustmentDelta: 0,
      count: 2,
      items: [
        {
          approvalRequestId: "approval-cash",
          cashAmount: 8000,
          transactionNumber: "TXN-CASH",
        },
        {
          approvalRequestId: "approval-card",
          cashAmount: 0,
          transactionNumber: "TXN-CARD",
        },
      ],
    });
  });

  it("includes pending cash item adjustments in the projected cash delta", async () => {
    const registerSessionId = "register-session-1" as Id<"registerSession">;
    const storeId = "store-1" as Id<"store">;
    const cashTransactionId = "transaction-cash" as Id<"posTransaction">;
    const transactions = new Map<Id<"posTransaction">, Doc<"posTransaction">>([
      [
        cashTransactionId,
        {
          _id: cashTransactionId,
          _creationTime: 1,
          changeGiven: 0,
          completedAt: 1,
          payments: [{ amount: 10000, method: "cash", timestamp: 1 }],
          registerSessionId,
          status: "completed",
          storeId,
          subtotal: 10000,
          tax: 0,
          total: 10000,
          totalPaid: 10000,
          transactionNumber: "TXN-CASH",
        } as Doc<"posTransaction">,
      ],
    ]);
    const ctx = {
      db: {
        get: vi.fn(async (_table: "posTransaction", id: Id<"posTransaction">) =>
          transactions.get(id) ?? null,
        ),
      },
    } as unknown as Pick<QueryCtx, "db">;

    const summary = await buildPendingCompletedSaleVoidApprovalSummary(ctx, {
      approvalRequests: [
        {
          _id: "approval-void" as Id<"approvalRequest">,
          _creationTime: 1,
          createdAt: 1,
          metadata: { transactionNumber: "TXN-CASH" },
          posTransactionId: cashTransactionId,
          requestType: "pos_transaction_void",
          status: "pending",
          storeId,
          subjectId: cashTransactionId,
          subjectType: "pos_transaction",
        } as Doc<"approvalRequest">,
      ],
      itemAdjustmentApprovalRequests: [
        {
          _id: "approval-cash-refund" as Id<"approvalRequest">,
          _creationTime: 2,
          createdAt: 2,
          metadata: {
            settlementAmount: 2000,
            settlementDirection: "refund",
            settlementMethod: "cash",
          },
          posTransactionId: cashTransactionId,
          registerSessionId,
          requestType: "pos_item_adjustment",
          status: "pending",
          storeId,
          subjectId: "adjustment-1",
          subjectType: "pos_transaction_item_adjustment",
        } as Doc<"approvalRequest">,
        {
          _id: "approval-card-refund" as Id<"approvalRequest">,
          _creationTime: 3,
          createdAt: 3,
          metadata: {
            settlementAmount: 5000,
            settlementDirection: "refund",
            settlementMethod: "card",
          },
          posTransactionId: cashTransactionId,
          registerSessionId,
          requestType: "pos_item_adjustment",
          status: "pending",
          storeId,
          subjectId: "adjustment-2",
          subjectType: "pos_transaction_item_adjustment",
        } as Doc<"approvalRequest">,
      ],
      registerSessionId,
      storeId,
    });

    expect(summary).toMatchObject({
      cashAffectingCount: 1,
      cashAdjustmentCount: 1,
      cashAdjustmentDelta: -2000,
      cashAmount: 10000,
    });
  });
});
