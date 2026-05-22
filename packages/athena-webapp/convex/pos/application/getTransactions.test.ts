import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../_generated/dataModel";
import {
  getCompletedTransactions,
  getTransactionById,
} from "./queries/getTransactions";
import {
  getCashierById,
  getPosSessionById,
  getPosTransactionById,
  getRegisterSessionById,
  listCompletedTransactions,
  listTransactionItems,
} from "../infrastructure/repositories/transactionRepository";

vi.mock("../infrastructure/repositories/transactionRepository", () => ({
  getCashierById: vi.fn(),
  getPosSessionById: vi.fn(),
  getPosTransactionById: vi.fn(),
  getRegisterSessionById: vi.fn(),
  listCompletedTransactions: vi.fn(),
  listCompletedTransactionsForDay: vi.fn(),
  listTransactionItems: vi.fn(),
  listTransactionsByStore: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getRegisterSessionById).mockResolvedValue(null as never);
});

function mockCorrectionHistoryDb(overrides?: {
  approvalRequests?: unknown[];
  get?: ReturnType<typeof vi.fn>;
  correctionHistory?: unknown[];
}) {
  return {
    get: overrides?.get ?? vi.fn().mockResolvedValue(null),
    query: vi.fn((tableName: string) => ({
      withIndex: vi.fn(() => ({
        collect: vi
          .fn()
          .mockResolvedValue(
            tableName === "approvalRequest"
              ? (overrides?.approvalRequests ?? [])
              : (overrides?.correctionHistory ?? []),
          ),
      })),
    })),
  };
}

describe("getCompletedTransactions", () => {
  it("returns hasTrace false for historical transactions without a persisted workflow trace id", async () => {
    vi.mocked(listCompletedTransactions).mockResolvedValue([
      {
        _id: "txn-1" as Id<"posTransaction">,
        storeId: "store-1" as Id<"store">,
        transactionNumber: "",
        total: 1000,
        paymentMethod: "cash",
        completedAt: 100,
        cashierId: undefined,
      },
    ] as never);
    vi.mocked(getCashierById).mockResolvedValue(null as never);
    vi.mocked(getPosSessionById).mockResolvedValue(null as never);
    vi.mocked(listTransactionItems).mockResolvedValue([] as never);

    const result = await getCompletedTransactions({} as never, {
      storeId: "store-1" as Id<"store">,
    });

    expect(result).toEqual([
      expect.objectContaining({
        transactionNumber: "",
        hasTrace: false,
      }),
    ]);
  });

  it("returns only the related session trace id when the completed sale came from a traced POS session", async () => {
    vi.mocked(listCompletedTransactions).mockResolvedValue([
      {
        _id: "txn-2" as Id<"posTransaction">,
        sessionId: "session-1" as Id<"posSession">,
        storeId: "store-1" as Id<"store">,
        transactionNumber: "POS-123456",
        total: 1000,
        paymentMethod: "cash",
        completedAt: 100,
        cashierId: undefined,
        workflowTraceId: "pos_sale:pos-123456",
      },
    ] as never);
    vi.mocked(getCashierById).mockResolvedValue(null as never);
    vi.mocked(getPosSessionById).mockResolvedValue({
      _id: "session-1" as Id<"posSession">,
      workflowTraceId: "pos_session:ses-001",
    } as never);
    vi.mocked(listTransactionItems).mockResolvedValue([] as never);

    const result = await getCompletedTransactions({} as never, {
      storeId: "store-1" as Id<"store">,
    });

    expect(result).toEqual([
      expect.objectContaining({
        hasTrace: true,
        sessionTraceId: "pos_session:ses-001",
      }),
    ]);
  });

  it("surfaces the canonical customer profile id from the completed transaction", async () => {
    vi.mocked(listCompletedTransactions).mockResolvedValue([
      {
        _id: "txn-3" as Id<"posTransaction">,
        storeId: "store-1" as Id<"store">,
        transactionNumber: "POS-333333",
        total: 1000,
        paymentMethod: "cash",
        completedAt: 100,
        customerProfileId: "profile-1" as Id<"customerProfile">,
      },
    ] as never);
    vi.mocked(getCashierById).mockResolvedValue(null as never);
    vi.mocked(getPosSessionById).mockResolvedValue(null as never);
    vi.mocked(listTransactionItems).mockResolvedValue([] as never);

    const result = await getCompletedTransactions(
      {
        db: {
          get: vi.fn().mockResolvedValue({
            _id: "profile-1" as Id<"customerProfile">,
            fullName: "Ama Serwa",
          }),
        },
      } as never,
      {
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result).toEqual([
      expect.objectContaining({
        customerProfileId: "profile-1",
        customerName: "Ama Serwa",
      }),
    ]);
  });

  it("surfaces every payment method used by completed transactions", async () => {
    vi.mocked(listCompletedTransactions).mockResolvedValue([
      {
        _id: "txn-4" as Id<"posTransaction">,
        storeId: "store-1" as Id<"store">,
        transactionNumber: "POS-444444",
        total: 1000,
        paymentMethod: "card",
        payments: [
          { amount: 500, method: "card", timestamp: 1 },
          { amount: 500, method: "cash", timestamp: 2 },
        ],
        completedAt: 100,
      },
    ] as never);
    vi.mocked(getCashierById).mockResolvedValue(null as never);
    vi.mocked(getPosSessionById).mockResolvedValue(null as never);
    vi.mocked(listTransactionItems).mockResolvedValue([] as never);

    const result = await getCompletedTransactions({} as never, {
      storeId: "store-1" as Id<"store">,
    });

    expect(result).toEqual([
      expect.objectContaining({
        paymentMethod: "card",
        paymentMethods: ["card", "cash"],
        hasMultiplePaymentMethods: true,
      }),
    ]);
  });

  it("keeps voided completed sales visible in the completed history read model", async () => {
    vi.mocked(listCompletedTransactions).mockResolvedValue([
      {
        _id: "txn-void" as Id<"posTransaction">,
        storeId: "store-1" as Id<"store">,
        transactionNumber: "POS-VOID",
        total: 1000,
        paymentMethod: "cash",
        payments: [{ amount: 1000, method: "cash", timestamp: 1 }],
        status: "void",
        completedAt: 100,
        voidedAt: 200,
        voidReason: "Duplicate sale",
        voidApprovalRequestId: "approval-request-1" as Id<"approvalRequest">,
        voidApprovalProofId: "approval-proof-1" as Id<"approvalProof">,
      },
    ] as never);
    vi.mocked(getCashierById).mockResolvedValue(null as never);
    vi.mocked(getPosSessionById).mockResolvedValue(null as never);
    vi.mocked(listTransactionItems).mockResolvedValue([] as never);

    const result = await getCompletedTransactions({} as never, {
      storeId: "store-1" as Id<"store">,
    });

    expect(result).toEqual([
      expect.objectContaining({
        status: "void",
        voidedAt: 200,
        voidReason: "Duplicate sale",
        voidApprovalRequestId: "approval-request-1",
        voidApprovalProofId: "approval-proof-1",
      }),
    ]);
  });

  it("passes the completed-from lower bound into the completed transaction repository", async () => {
    vi.mocked(listCompletedTransactions).mockResolvedValue([] as never);

    await getCompletedTransactions({} as never, {
      completedFrom: Date.UTC(2026, 4, 8),
      storeId: "store-1" as Id<"store">,
    });

    expect(listCompletedTransactions).toHaveBeenCalledWith(expect.anything(), {
      completedFrom: Date.UTC(2026, 4, 8),
      storeId: "store-1",
    });
  });
});

describe("getTransactionById", () => {
  it("ignores legacy transaction workflow trace ids when no session trace is available", async () => {
    vi.mocked(getPosTransactionById).mockResolvedValue({
      _id: "txn-1" as Id<"posTransaction">,
      storeId: "store-1" as Id<"store">,
      transactionNumber: "POS-123456",
      workflowTraceId: "pos_sale:pos-123456",
      subtotal: 1000,
      tax: 0,
      total: 1000,
      paymentMethod: "cash",
      payments: [],
      totalPaid: 1000,
      status: "completed",
      completedAt: 100,
      customerId: undefined,
      customerInfo: undefined,
      notes: undefined,
    } as never);
    vi.mocked(getCashierById).mockResolvedValue(null as never);
    vi.mocked(getPosSessionById).mockResolvedValue(null as never);
    vi.mocked(listTransactionItems).mockResolvedValue([] as never);

    const result = await getTransactionById(
      { db: mockCorrectionHistoryDb() } as never,
      {
        transactionId: "txn-1" as Id<"posTransaction">,
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        transactionNumber: "POS-123456",
        hasTrace: false,
        sessionTraceId: null,
      }),
    );
  });

  it("returns hasTrace false when the transaction does not carry a persisted workflow trace id", async () => {
    vi.mocked(getPosTransactionById).mockResolvedValue({
      _id: "txn-2" as Id<"posTransaction">,
      storeId: "store-1" as Id<"store">,
      transactionNumber: "POS-654321",
      subtotal: 1000,
      tax: 0,
      total: 1000,
      paymentMethod: "cash",
      payments: [],
      totalPaid: 1000,
      status: "completed",
      completedAt: 100,
      customerId: undefined,
      customerInfo: undefined,
      notes: undefined,
    } as never);
    vi.mocked(getCashierById).mockResolvedValue(null as never);
    vi.mocked(getPosSessionById).mockResolvedValue(null as never);
    vi.mocked(listTransactionItems).mockResolvedValue([] as never);

    const result = await getTransactionById(
      { db: mockCorrectionHistoryDb() } as never,
      {
        transactionId: "txn-2" as Id<"posTransaction">,
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        transactionNumber: "POS-654321",
        hasTrace: false,
      }),
    );
  });

  it("returns the related session trace id when the transaction session carries one", async () => {
    vi.mocked(getPosTransactionById).mockResolvedValue({
      _id: "txn-3" as Id<"posTransaction">,
      sessionId: "session-1" as Id<"posSession">,
      storeId: "store-1" as Id<"store">,
      transactionNumber: "POS-222222",
      workflowTraceId: "pos_sale:pos-222222",
      subtotal: 1000,
      tax: 0,
      total: 1000,
      paymentMethod: "cash",
      payments: [],
      totalPaid: 1000,
      status: "completed",
      completedAt: 100,
      customerId: undefined,
      customerInfo: undefined,
      notes: undefined,
    } as never);
    vi.mocked(getCashierById).mockResolvedValue(null as never);
    vi.mocked(getPosSessionById).mockResolvedValue({
      _id: "session-1" as Id<"posSession">,
      workflowTraceId: "pos_session:ses-001",
    } as never);
    vi.mocked(listTransactionItems).mockResolvedValue([] as never);

    const result = await getTransactionById(
      { db: mockCorrectionHistoryDb() } as never,
      {
        transactionId: "txn-3" as Id<"posTransaction">,
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        hasTrace: true,
        sessionTraceId: "pos_session:ses-001",
      }),
    );
  });

  it("returns profile-backed attribution from the completed transaction detail", async () => {
    vi.mocked(getPosTransactionById).mockResolvedValue({
      _id: "txn-4" as Id<"posTransaction">,
      sessionId: "session-1" as Id<"posSession">,
      storeId: "store-1" as Id<"store">,
      transactionNumber: "POS-444444",
      subtotal: 1000,
      tax: 0,
      total: 1000,
      paymentMethod: "cash",
      payments: [],
      totalPaid: 1000,
      status: "completed",
      completedAt: 100,
      customerProfileId: "profile-1" as Id<"customerProfile">,
      customerInfo: undefined,
      notes: undefined,
    } as never);
    vi.mocked(getCashierById).mockResolvedValue(null as never);
    vi.mocked(getPosSessionById).mockResolvedValue({
      _id: "session-1" as Id<"posSession">,
      workflowTraceId: "pos_session:ses-001",
    } as never);
    vi.mocked(listTransactionItems).mockResolvedValue([] as never);

    const result = await getTransactionById(
      {
        db: mockCorrectionHistoryDb({
          get: vi.fn().mockResolvedValue({
            _id: "profile-1" as Id<"customerProfile">,
            fullName: "Ama Serwa",
            email: "ama@example.com",
          }),
        }),
      } as never,
      {
        transactionId: "txn-4" as Id<"posTransaction">,
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        customer: expect.objectContaining({
          customerProfileId: "profile-1",
          name: "Ama Serwa",
          email: "ama@example.com",
        }),
      }),
    );
  });

  it("returns operational-event correction history for transaction detail", async () => {
    vi.mocked(getPosTransactionById).mockResolvedValue({
      _id: "txn-5" as Id<"posTransaction">,
      storeId: "store-1" as Id<"store">,
      transactionNumber: "POS-555555",
      subtotal: 1000,
      tax: 0,
      total: 1000,
      paymentMethod: "card",
      payments: [{ method: "card", amount: 1000, timestamp: 1 }],
      totalPaid: 1000,
      status: "completed",
      completedAt: 100,
    } as never);
    vi.mocked(getCashierById).mockResolvedValue(null as never);
    vi.mocked(getPosSessionById).mockResolvedValue(null as never);
    vi.mocked(listTransactionItems).mockResolvedValue([] as never);

    const collect = vi.fn().mockResolvedValue([
      {
        _id: "event-1",
        eventType: "pos_transaction_payment_method_corrected",
        message: "Corrected payment method.",
        reason: "Till entry correction",
        metadata: { paymentMethod: "card" },
        createdAt: 200,
        actorStaffProfileId: "staff-1",
      },
    ]);
    const ctx = {
      db: {
        get: vi.fn((table, id) => {
          if (table === "staffProfile" && id === "staff-1") {
            return Promise.resolve({
              _id: "staff-1",
              fullName: "Ama Mensah",
            });
          }

          return Promise.resolve(null);
        }),
        query: vi.fn(() => ({
          withIndex: vi.fn((_indexName, callback) => {
            callback({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(),
                })),
              })),
            });
            return { collect };
          }),
        })),
      },
    } as never;

    const result = await getTransactionById(ctx, {
      transactionId: "txn-5" as Id<"posTransaction">,
    });

    expect(result).toEqual(
      expect.objectContaining({
        correctionHistory: [
          expect.objectContaining({
            _id: "event-1",
            eventType: "pos_transaction_payment_method_corrected",
            actorStaffName: "Ama M.",
            metadata: { paymentMethod: "card" },
          }),
        ],
      }),
    );
  });

  it("returns the associated register session status for transaction detail", async () => {
    vi.mocked(getPosTransactionById).mockResolvedValue({
      _id: "txn-6" as Id<"posTransaction">,
      registerSessionId: "register-session-1" as Id<"registerSession">,
      storeId: "store-1" as Id<"store">,
      transactionNumber: "POS-666666",
      subtotal: 1000,
      tax: 0,
      total: 1000,
      paymentMethod: "cash",
      payments: [{ method: "cash", amount: 1000, timestamp: 1 }],
      totalPaid: 1000,
      status: "completed",
      completedAt: 100,
    } as never);
    vi.mocked(getCashierById).mockResolvedValue(null as never);
    vi.mocked(getPosSessionById).mockResolvedValue(null as never);
    vi.mocked(getRegisterSessionById).mockResolvedValue({
      _id: "register-session-1" as Id<"registerSession">,
      registerNumber: "2",
      status: "closing",
    } as never);
    vi.mocked(listTransactionItems).mockResolvedValue([] as never);

    const result = await getTransactionById(
      { db: mockCorrectionHistoryDb() } as never,
      {
        transactionId: "txn-6" as Id<"posTransaction">,
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        registerNumber: "2",
        registerSessionId: "register-session-1",
        registerSessionStatus: "closing",
      }),
    );
  });

  it("returns void metadata and void audit history for transaction detail", async () => {
    vi.mocked(getPosTransactionById).mockResolvedValue({
      _id: "txn-void" as Id<"posTransaction">,
      storeId: "store-1" as Id<"store">,
      transactionNumber: "POS-VOID",
      subtotal: 1000,
      tax: 0,
      total: 1000,
      paymentMethod: "cash",
      payments: [{ method: "cash", amount: 1000, timestamp: 1 }],
      totalPaid: 1000,
      status: "void",
      completedAt: 100,
      notes: "Legacy void note",
      voidedAt: 200,
      voidReason: "Duplicate sale",
      voidedByStaffProfileId: "staff-1" as Id<"staffProfile">,
      voidApprovalRequestId: "approval-request-1" as Id<"approvalRequest">,
      voidApprovalProofId: "approval-proof-1" as Id<"approvalProof">,
      voidApprovedByStaffProfileId: "manager-1" as Id<"staffProfile">,
      voidOperationalEventId: "event-void" as Id<"operationalEvent">,
    } as never);
    vi.mocked(getCashierById).mockResolvedValue(null as never);
    vi.mocked(getPosSessionById).mockResolvedValue(null as never);
    vi.mocked(listTransactionItems).mockResolvedValue([] as never);

    const result = await getTransactionById(
      {
        db: mockCorrectionHistoryDb({
          correctionHistory: [
            {
              _id: "event-void",
              actorStaffProfileId: "staff-1",
              createdAt: 200,
              eventType: "pos_transaction_voided",
              message: "Voided Transaction #POS-VOID.",
              metadata: {
                inventoryMovementIds: ["movement-1"],
                paymentAllocationIds: ["allocation-1"],
              },
              reason: "Duplicate sale",
            },
          ],
          get: vi.fn(async (tableName: string, id: string) => {
            if (tableName === "staffProfile" && id === "staff-1") {
              return {
                _id: "staff-1",
                firstName: "Ama",
                lastName: "Mensah",
              };
            }
            return null;
          }),
        }),
      } as never,
      {
        transactionId: "txn-void" as Id<"posTransaction">,
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        status: "void",
        voidedAt: 200,
        voidReason: "Duplicate sale",
        voidedByStaffProfileId: "staff-1",
        voidApprovalRequestId: "approval-request-1",
        voidApprovalProofId: "approval-proof-1",
        voidApprovedByStaffProfileId: "manager-1",
        voidOperationalEventId: "event-void",
        correctionHistory: [
          expect.objectContaining({
            _id: "event-void",
            actorStaffName: "Ama M.",
            eventType: "pos_transaction_voided",
            reason: "Duplicate sale",
          }),
        ],
      }),
    );
  });

  it("returns explicit no-adjustment fields for legacy transaction detail", async () => {
    vi.mocked(getPosTransactionById).mockResolvedValue({
      _id: "txn-7" as Id<"posTransaction">,
      storeId: "store-1" as Id<"store">,
      transactionNumber: "POS-777777",
      subtotal: 1000,
      tax: 0,
      total: 1000,
      paymentMethod: "cash",
      payments: [{ method: "cash", amount: 1000, timestamp: 1 }],
      totalPaid: 1000,
      status: "completed",
      completedAt: 100,
    } as never);
    vi.mocked(getCashierById).mockResolvedValue(null as never);
    vi.mocked(getPosSessionById).mockResolvedValue(null as never);
    vi.mocked(listTransactionItems).mockResolvedValue([] as never);

    const result = await getTransactionById(
      { db: mockCorrectionHistoryDb() } as never,
      {
        transactionId: "txn-7" as Id<"posTransaction">,
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        originalTotal: 1000,
        effectiveNetTotal: 1000,
        totalAppliedAdjustmentDelta: 0,
        adjustmentSummary: {
          appliedCount: 0,
          effectiveNetTotal: 1000,
          hasAdjustments: false,
          originalTotal: 1000,
          pendingCount: 0,
          totalAppliedAdjustmentDelta: 0,
        },
        adjustments: [],
      }),
    );
  });

  it("returns pending and applied adjustment summaries without changing original totals", async () => {
    vi.mocked(getPosTransactionById).mockResolvedValue({
      _id: "txn-8" as Id<"posTransaction">,
      storeId: "store-1" as Id<"store">,
      transactionNumber: "POS-888888",
      subtotal: 2000,
      tax: 0,
      total: 2000,
      paymentMethod: "cash",
      payments: [{ method: "cash", amount: 2000, timestamp: 1 }],
      totalPaid: 2000,
      status: "completed",
      completedAt: 100,
    } as never);
    vi.mocked(getCashierById).mockResolvedValue(null as never);
    vi.mocked(getPosSessionById).mockResolvedValue(null as never);
    vi.mocked(listTransactionItems).mockResolvedValue([] as never);

    const result = await getTransactionById(
      {
        db: mockCorrectionHistoryDb({
          approvalRequests: [
            {
              _id: "approval-1",
              requestType: "pos_item_adjustment",
              status: "pending",
              reason: "Customer received one unit.",
              createdAt: 300,
              metadata: {
                originalTotal: 1500,
                adjustedTotal: 1000,
                settlementAmount: 500,
                settlementDirection: "refund",
                settlementMethod: "cash",
                totalDelta: -500,
                transactionId: "txn-8",
                lineItems: [
                  {
                    productName: "Closure wig",
                    sku: "CW-18",
                    originalQuantity: 2,
                    adjustedQuantity: 1,
                    quantityDelta: -1,
                  },
                ],
              },
            },
          ],
          correctionHistory: [
            {
              _id: "event-1",
              eventType: "pos_transaction_item_adjustment_applied",
              message: "Item adjustment applied.",
              reason: "Wrong quantity recorded.",
              metadata: {
                originalTotal: 2000,
                adjustedTotal: 1500,
                settlementAmount: 500,
                settlementDirection: "refund",
                totalDelta: -500,
                lineItems: [
                  {
                    productName: "Closure wig",
                    productSku: "CW-18",
                    originalQuantity: 2,
                    adjustedQuantity: 1,
                    quantityDelta: -1,
                  },
                ],
              },
              createdAt: 200,
            },
          ],
        }),
      } as never,
      {
        transactionId: "txn-8" as Id<"posTransaction">,
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        total: 2000,
        originalTotal: 2000,
        effectiveNetTotal: 1500,
        totalAppliedAdjustmentDelta: -500,
        adjustmentSummary: expect.objectContaining({
          appliedCount: 1,
          pendingCount: 1,
          hasAdjustments: true,
        }),
        adjustments: [
          expect.objectContaining({
            _id: "approval-1",
            status: "pending_approval",
            settlementDirection: "refund",
            settlementMethod: "cash",
            lineItems: [
              expect.objectContaining({
                productName: "Closure wig",
                productSku: "CW-18",
                originalQuantity: 2,
                adjustedQuantity: 1,
              }),
            ],
          }),
          expect.objectContaining({
            _id: "event-1",
            status: "applied",
            settlementAmount: 500,
          }),
        ],
      }),
    );
  });
});
