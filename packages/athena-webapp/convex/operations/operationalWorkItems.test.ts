import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../_generated/dataModel";
import { getQueueSnapshot } from "./operationalWorkItems";
import * as athenaUserAuth from "../lib/athenaUserAuth";

vi.mock("../lib/athenaUserAuth", () => ({
  requireAuthenticatedAthenaUserWithCtx: vi.fn(),
  requireOrganizationMemberRoleWithCtx: vi.fn(),
}));

function getHandler(definition: unknown) {
  return (definition as { _handler: Function })._handler;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(athenaUserAuth.requireAuthenticatedAthenaUserWithCtx).mockResolvedValue({
    _id: "user-1",
  } as never);
});

describe("getQueueSnapshot", () => {
  it("normalizes item adjustment approval payloads for the operations queue", async () => {
    const approvalRequest = {
      _id: "approval-1" as Id<"approvalRequest">,
      createdAt: 10,
      metadata: {
        correctedTotal: 15000,
        deltaTotal: -5000,
        originalTotal: 20000,
        payload: {
          lines: [
            {
              adjustedQuantity: 1,
              inventoryDelta: 1,
              originalQuantity: 2,
              productName: "Closure wig",
              productSku: "CW-18",
              productSkuId: "sku-1" as Id<"productSku">,
            },
          ],
        },
        settlementAmount: 5000,
        settlementDirection: "refund",
        settlementMethod: "cash",
        transactionId: "txn-1" as Id<"posTransaction">,
        transactionNumber: "434898",
      },
      posTransactionId: "txn-1" as Id<"posTransaction">,
      requestType: "pos_item_adjustment",
      status: "pending",
      storeId: "store-1" as Id<"store">,
      subjectId: "pos_transaction_item_adjustment:txn-1:fingerprint",
      subjectType: "pos_transaction_item_adjustment",
    };
    const ctx = {
      db: {
        get: vi.fn(async (tableName: string, id: string) => {
          if (tableName === "store" && id === "store-1") {
            return { _id: "store-1", organizationId: "org-1" };
          }
          if (tableName === "posTransaction" && id === "txn-1") {
            return {
              _id: "txn-1",
              completedAt: 1,
              paymentMethod: "cash",
              total: 20000,
              totalPaid: 20000,
              transactionNumber: "434898",
            };
          }
          return null;
        }),
        query: vi.fn((tableName: string) => ({
          withIndex: vi.fn(() => ({
            take: vi.fn(async () => {
              if (tableName === "approvalRequest") {
                return [approvalRequest];
              }
              return [];
            }),
          })),
        })),
      },
    };

    const result = await getHandler(getQueueSnapshot)(ctx, {
      storeId: "store-1" as Id<"store">,
    });

    expect(
      athenaUserAuth.requireOrganizationMemberRoleWithCtx,
    ).toHaveBeenCalledWith(ctx, {
      allowedRoles: ["full_admin"],
      failureMessage: "Only full admins can view approval queue.",
      organizationId: "org-1",
      userId: "user-1",
    });
    expect(result.approvalRequests).toEqual([
      expect.objectContaining({
        _id: "approval-1",
        metadata: expect.objectContaining({
          adjustedTotal: 15000,
          lineItems: [
            expect.objectContaining({
              adjustedQuantity: 1,
              originalQuantity: 2,
              productName: "Closure wig",
              quantityDelta: -1,
              sku: "CW-18",
            }),
          ],
          totalDelta: -5000,
        }),
        transactionSummary: expect.objectContaining({
          transactionId: "txn-1",
          transactionNumber: "434898",
        }),
      }),
    ]);
  });

  it("surfaces register sync conflicts as pending approval work", async () => {
    const ctx = {
      db: {
        get: vi.fn(async (tableName: string, id: string) => {
          if (tableName === "store" && id === "store-1") {
            return { _id: "store-1", organizationId: "org-1" };
          }
          if (tableName === "registerSession" && id === "session-1") {
            return {
              _id: "session-1",
              countedCash: null,
              expectedCash: 50000,
              registerNumber: "2",
              status: "active",
              storeId: "store-1",
              terminalId: "terminal-1",
            };
          }
          if (tableName === "posTerminal" && id === "terminal-1") {
            return { _id: "terminal-1", displayName: "Wigshop" };
          }
          return null;
        }),
        query: vi.fn((tableName: string) => ({
          withIndex: vi.fn(() => ({
            take: vi.fn(async () => {
              if (tableName === "posLocalSyncConflict") {
                return [
                  {
                    _id: "sync-conflict-1",
                    conflictType: "permission",
                    createdAt: 20,
                    localEventId: "event-sale-completed-1",
                    localRegisterSessionId: "local-session-1",
                    sequence: 2,
                    status: "needs_review",
                    storeId: "store-1",
                    summary:
                      "Register was not open before this sale synced.",
                    terminalId: "terminal-1",
                  },
                ];
              }
              return [];
            }),
            unique: vi.fn(async () => {
              if (tableName === "posLocalSyncMapping") {
                return {
                  cloudId: "session-1",
                  cloudTable: "registerSession",
                };
              }
              return null;
            }),
          })),
        })),
      },
    };

    const result = await getHandler(getQueueSnapshot)(ctx, {
      storeId: "store-1" as Id<"store">,
    });

    expect(result.approvalRequests).toEqual([
      expect.objectContaining({
        _id: "register-sync-review:session-1",
        metadata: expect.objectContaining({
          conflictCount: 1,
          reviewItems: [
            expect.objectContaining({
              id: "sync-conflict-1",
              sequence: 2,
              type: "permission",
            }),
          ],
        }),
        registerSessionSummary: expect.objectContaining({
          registerNumber: "2",
          registerSessionId: "session-1",
          terminalName: "Wigshop",
        }),
        requestType: "register_sync_review",
        subjectType: "register_session_sync_review",
        workItemTitle: "Synced register activity review",
      }),
    ]);
  });
});
