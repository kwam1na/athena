import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../_generated/dataModel";
import {
  getCompletedTransactions,
  getTodaySummary,
  getTransactionById,
} from "./queries/getTransactions";
import {
  getCashierById,
  getPosSessionById,
  getPosTransactionById,
  getRegisterSessionById,
  listCompletedTransactions,
  listCompletedTransactionsForRange,
  listCompletedTransactionsSince,
  listCompletedTransactionsForDay,
  listTransactionItems,
} from "../infrastructure/repositories/transactionRepository";

vi.mock("../infrastructure/repositories/transactionRepository", () => ({
  getCashierById: vi.fn(),
  getPosSessionById: vi.fn(),
  getPosTransactionById: vi.fn(),
  getRegisterSessionById: vi.fn(),
  listCompletedTransactions: vi.fn(),
  listCompletedTransactionsForRange: vi.fn(),
  listCompletedTransactionsSince: vi.fn(),
  listCompletedTransactionsForDay: vi.fn(),
  listTransactionItems: vi.fn(),
  listTransactionsByStore: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getRegisterSessionById).mockResolvedValue(null as never);
  vi.mocked(listCompletedTransactionsForRange).mockResolvedValue([] as never);
  vi.mocked(listCompletedTransactionsSince).mockResolvedValue([] as never);
});

function mockCorrectionHistoryDb(overrides?: {
  approvalRequests?: unknown[];
  get?: ReturnType<typeof vi.fn>;
  correctionHistory?: unknown[];
  paymentAllocations?: unknown[];
  serviceLines?: unknown[];
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
              : tableName === "posTransactionServiceLine"
                ? (overrides?.serviceLines ?? [])
                : tableName === "paymentAllocation"
                  ? (overrides?.paymentAllocations ?? [])
              : (overrides?.correctionHistory ?? []),
          ),
        take: vi
          .fn()
          .mockResolvedValue(
            tableName === "approvalRequest"
              ? (overrides?.approvalRequests ?? [])
              : [],
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

    const result = await getCompletedTransactions({ db: mockCorrectionHistoryDb() } as never, {
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

    const result = await getCompletedTransactions({ db: mockCorrectionHistoryDb() } as never, {
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
        db: mockCorrectionHistoryDb({
          get: vi.fn().mockResolvedValue({
            _id: "profile-1" as Id<"customerProfile">,
            fullName: "Ama Serwa",
          }),
        }),
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

    const result = await getCompletedTransactions({ db: mockCorrectionHistoryDb() } as never, {
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

    const result = await getCompletedTransactions({ db: mockCorrectionHistoryDb() } as never, {
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

describe("getTodaySummary", () => {
  it("summarizes the latest open operating day instead of the server calendar day", async () => {
    vi.setSystemTime(new Date("2026-06-20T00:49:30.000Z"));
    vi.mocked(listCompletedTransactionsForDay).mockResolvedValue([
      {
        _id: "txn-1" as Id<"posTransaction">,
        storeId: "store-1" as Id<"store">,
        total: 20_500,
      },
      {
        _id: "txn-2" as Id<"posTransaction">,
        storeId: "store-1" as Id<"store">,
        total: 6_500,
      },
    ] as never);
    vi.mocked(listTransactionItems)
      .mockResolvedValueOnce([{ quantity: 3 }, { quantity: 1 }] as never)
      .mockResolvedValueOnce([{ quantity: 2 }] as never);
    const query = vi.fn((tableName: string) => ({
      withIndex: vi.fn(() => ({
        collect: vi.fn().mockResolvedValue([]),
        take: vi.fn().mockResolvedValue([]),
        order: vi.fn(() => ({
          take: vi.fn().mockResolvedValue(
            tableName === "dailyOpening"
              ? [
                  {
                    _id: "opening-2026-06-19",
                    operatingDate: "2026-06-19",
                    status: "started",
                    storeId: "store-1",
                  },
                ]
              : [],
          ),
        })),
      })),
    }));

    const result = await getTodaySummary(
      {
        db: { query },
      } as never,
      {
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(listCompletedTransactionsForDay).toHaveBeenCalledWith(
      expect.anything(),
      {
        endOfDay: Date.parse("2026-06-19T23:59:59.999Z"),
        startOfDay: Date.parse("2026-06-19T00:00:00.000Z"),
        storeId: "store-1",
      },
    );
    expect(result).toEqual({
      averageTransaction: 13_500,
      date: "2026-06-19",
      operatorSnapshot: expect.objectContaining({
        historyDays: 14,
        paymentMix: [],
        topItems: [],
        trend: expect.any(Array),
        usableHistoryDays: 0,
      }),
      totalItemsSold: 6,
      totalSales: 27_000,
      totalTransactions: 2,
    });
  });

  it("falls back to the server calendar day when the latest opening is already closed", async () => {
    vi.setSystemTime(new Date("2026-06-20T00:49:30.000Z"));
    vi.mocked(listCompletedTransactionsForDay).mockResolvedValue([] as never);
    const query = vi.fn((tableName: string) => ({
      withIndex: vi.fn(() => ({
        collect: vi.fn().mockResolvedValue(
          tableName === "dailyClose"
            ? [
                {
                  _id: "close-2026-06-19",
                  lifecycleStatus: "active",
                  operatingDate: "2026-06-19",
                  status: "completed",
                  storeId: "store-1",
                },
              ]
            : [],
        ),
        take: vi.fn().mockResolvedValue(
          tableName === "dailyClose"
            ? [
                {
                  _id: "close-2026-06-19",
                  lifecycleStatus: "active",
                  operatingDate: "2026-06-19",
                  status: "completed",
                  storeId: "store-1",
                },
              ]
            : [],
        ),
        order: vi.fn(() => ({
          take: vi.fn().mockResolvedValue(
            tableName === "dailyOpening"
              ? [
                  {
                    _id: "opening-2026-06-19",
                    operatingDate: "2026-06-19",
                    status: "started",
                    storeId: "store-1",
                  },
                ]
              : [],
          ),
        })),
      })),
    }));

    const result = await getTodaySummary(
      {
        db: { query },
      } as never,
      {
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(listCompletedTransactionsForDay).toHaveBeenCalledWith(
      expect.anything(),
      {
        endOfDay: Date.parse("2026-06-20T23:59:59.999Z"),
        startOfDay: Date.parse("2026-06-20T00:00:00.000Z"),
        storeId: "store-1",
      },
    );
    expect(result).toEqual({
      averageTransaction: 0,
      date: "2026-06-20",
      operatorSnapshot: expect.objectContaining({
        historyDays: 14,
        paymentMix: [],
        topItems: [],
        trend: expect.any(Array),
        usableHistoryDays: 0,
      }),
      totalItemsSold: 0,
      totalSales: 0,
      totalTransactions: 0,
    });
  });

  it("summarizes this week against the same span from last week", async () => {
    vi.setSystemTime(new Date("2026-06-20T15:30:00.000Z"));
    vi.mocked(listCompletedTransactionsForRange).mockResolvedValue([] as never);
    vi.mocked(listCompletedTransactionsSince).mockResolvedValue([] as never);
    const query = vi.fn(() => ({
      withIndex: vi.fn(() => ({
        collect: vi.fn().mockResolvedValue([]),
        take: vi.fn().mockResolvedValue([]),
        order: vi.fn(() => ({
          take: vi.fn().mockResolvedValue([]),
        })),
      })),
    }));

    const result = await getTodaySummary(
      {
        db: { query },
      } as never,
      {
        pulseWindow: "this_week",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(listCompletedTransactionsForRange).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      {
        completedFrom: Date.parse("2026-06-15T00:00:00.000Z"),
        completedTo: Date.parse("2026-06-20T23:59:59.999Z"),
        storeId: "store-1",
      },
    );
    expect(listCompletedTransactionsForRange).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      {
        completedFrom: Date.parse("2026-06-08T00:00:00.000Z"),
        completedTo: Date.parse("2026-06-13T23:59:59.999Z"),
        storeId: "store-1",
      },
    );
    expect(listCompletedTransactionsSince).toHaveBeenCalledWith(
      expect.anything(),
      {
        completedFrom: Date.parse("2026-06-08T00:00:00.000Z"),
        limit: 400,
        storeId: "store-1",
      },
    );
    expect(result.date).toBe("2026-06-20");
    expect(result.operatorSnapshot.historyDays).toBe(6);
    expect(result.operatorSnapshot.trend.map((day) => day.date)).toEqual([
      "2026-06-15",
      "2026-06-16",
      "2026-06-17",
      "2026-06-18",
      "2026-06-19",
      "2026-06-20",
    ]);
  });

  it("summarizes today with exact totals against yesterday", async () => {
    vi.setSystemTime(new Date("2026-06-20T15:30:00.000Z"));
    vi.mocked(listCompletedTransactionsForRange)
      .mockResolvedValueOnce([
        {
          _id: "txn-today" as Id<"posTransaction">,
          completedAt: Date.UTC(2026, 5, 20, 15),
          storeId: "store-1" as Id<"store">,
          total: 18_000,
        },
      ] as never)
      .mockResolvedValueOnce([
        {
          _id: "txn-yesterday" as Id<"posTransaction">,
          completedAt: Date.UTC(2026, 5, 19, 15),
          storeId: "store-1" as Id<"store">,
          total: 12_000,
        },
      ] as never);
    vi.mocked(listCompletedTransactionsSince).mockResolvedValue([] as never);
    vi.mocked(listTransactionItems)
      .mockResolvedValueOnce([{ quantity: 3 }] as never)
      .mockResolvedValueOnce([{ quantity: 2 }] as never);
    const query = vi.fn(() => ({
      withIndex: vi.fn(() => ({
        collect: vi.fn().mockResolvedValue([]),
        take: vi.fn().mockResolvedValue([]),
        order: vi.fn(() => ({
          take: vi.fn().mockResolvedValue([]),
        })),
      })),
    }));

    const result = await getTodaySummary(
      {
        db: { query },
      } as never,
      {
        pulseWindow: "today",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(listCompletedTransactionsForRange).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      {
        completedFrom: Date.parse("2026-06-20T00:00:00.000Z"),
        completedTo: Date.parse("2026-06-20T23:59:59.999Z"),
        storeId: "store-1",
      },
    );
    expect(listCompletedTransactionsForRange).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      {
        completedFrom: Date.parse("2026-06-19T00:00:00.000Z"),
        completedTo: Date.parse("2026-06-19T23:59:59.999Z"),
        storeId: "store-1",
      },
    );
    expect(result.totalSales).toBe(18_000);
    expect(result.totalTransactions).toBe(1);
    expect(result.totalItemsSold).toBe(3);
    expect(result.operatorSnapshot.comparison).toEqual(
      expect.objectContaining({
        currentItemsSold: 3,
        currentSales: 18_000,
        currentTransactions: 1,
        yesterdayItemsSold: 2,
        yesterdaySales: 12_000,
        yesterdayTransactions: 1,
      }),
    );
    expect(result.operatorSnapshot.trend).toEqual([
      expect.objectContaining({
        date: "2026-06-19",
        totalItemsSold: 2,
        totalSales: 12_000,
        transactionCount: 1,
      }),
      expect.objectContaining({
        date: "2026-06-20",
        totalItemsSold: 3,
        totalSales: 18_000,
        transactionCount: 1,
      }),
    ]);
  });

  it("summarizes last week against the full week before", async () => {
    vi.setSystemTime(new Date("2026-06-20T15:30:00.000Z"));
    vi.mocked(listCompletedTransactionsForRange).mockResolvedValue([] as never);
    vi.mocked(listCompletedTransactionsSince).mockResolvedValue([] as never);
    const query = vi.fn(() => ({
      withIndex: vi.fn(() => ({
        collect: vi.fn().mockResolvedValue([]),
        take: vi.fn().mockResolvedValue([]),
        order: vi.fn(() => ({
          take: vi.fn().mockResolvedValue([]),
        })),
      })),
    }));

    const result = await getTodaySummary(
      {
        db: { query },
      } as never,
      {
        pulseWindow: "last_week",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(listCompletedTransactionsForRange).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      {
        completedFrom: Date.parse("2026-06-08T00:00:00.000Z"),
        completedTo: Date.parse("2026-06-14T23:59:59.999Z"),
        storeId: "store-1",
      },
    );
    expect(listCompletedTransactionsForRange).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      {
        completedFrom: Date.parse("2026-06-01T00:00:00.000Z"),
        completedTo: Date.parse("2026-06-07T23:59:59.999Z"),
        storeId: "store-1",
      },
    );
    expect(result.operatorSnapshot.historyDays).toBe(7);
    expect(result.operatorSnapshot.trend.map((day) => day.date)).toEqual([
      "2026-06-08",
      "2026-06-09",
      "2026-06-10",
      "2026-06-11",
      "2026-06-12",
      "2026-06-13",
      "2026-06-14",
    ]);
  });

  it("summarizes this month against the same number of days from last month", async () => {
    vi.setSystemTime(new Date("2026-06-20T15:30:00.000Z"));
    vi.mocked(listCompletedTransactionsForRange).mockResolvedValue([] as never);
    vi.mocked(listCompletedTransactionsSince).mockResolvedValue([] as never);
    const query = vi.fn(() => ({
      withIndex: vi.fn(() => ({
        collect: vi.fn().mockResolvedValue([]),
        take: vi.fn().mockResolvedValue([]),
        order: vi.fn(() => ({
          take: vi.fn().mockResolvedValue([]),
        })),
      })),
    }));

    const result = await getTodaySummary(
      {
        db: { query },
      } as never,
      {
        pulseWindow: "this_month",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(listCompletedTransactionsForRange).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      {
        completedFrom: Date.parse("2026-06-01T00:00:00.000Z"),
        completedTo: Date.parse("2026-06-20T23:59:59.999Z"),
        storeId: "store-1",
      },
    );
    expect(listCompletedTransactionsForRange).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      {
        completedFrom: Date.parse("2026-05-01T00:00:00.000Z"),
        completedTo: Date.parse("2026-05-20T23:59:59.999Z"),
        storeId: "store-1",
      },
    );
    expect(result.operatorSnapshot.historyDays).toBe(20);
    expect(result.operatorSnapshot.trend).toHaveLength(20);
  });

  it("summarizes last month against the month before", async () => {
    vi.setSystemTime(new Date("2026-06-20T15:30:00.000Z"));
    vi.mocked(listCompletedTransactionsForRange).mockResolvedValue([] as never);
    vi.mocked(listCompletedTransactionsSince).mockResolvedValue([] as never);
    const query = vi.fn(() => ({
      withIndex: vi.fn(() => ({
        collect: vi.fn().mockResolvedValue([]),
        take: vi.fn().mockResolvedValue([]),
        order: vi.fn(() => ({
          take: vi.fn().mockResolvedValue([]),
        })),
      })),
    }));

    const result = await getTodaySummary(
      {
        db: { query },
      } as never,
      {
        pulseWindow: "last_month",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(listCompletedTransactionsForRange).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      {
        completedFrom: Date.parse("2026-05-01T00:00:00.000Z"),
        completedTo: Date.parse("2026-05-31T23:59:59.999Z"),
        storeId: "store-1",
      },
    );
    expect(listCompletedTransactionsForRange).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      {
        completedFrom: Date.parse("2026-04-01T00:00:00.000Z"),
        completedTo: Date.parse("2026-04-30T23:59:59.999Z"),
        storeId: "store-1",
      },
    );
    expect(result.operatorSnapshot.historyDays).toBe(31);
    expect(result.operatorSnapshot.trend.at(0)?.date).toBe("2026-05-01");
    expect(result.operatorSnapshot.trend.at(-1)?.date).toBe("2026-05-31");
  });

  it("summarizes all synced history without a comparison period", async () => {
    vi.setSystemTime(new Date("2026-06-20T15:30:00.000Z"));
    vi.mocked(listCompletedTransactionsForRange).mockResolvedValue([
      {
        _id: "txn-current" as Id<"posTransaction">,
        completedAt: Date.UTC(2026, 5, 20, 15),
        payments: [{ amount: 18_000, method: "cash", timestamp: 1 }],
        storeId: "store-1" as Id<"store">,
        total: 18_000,
      },
      {
        _id: "txn-older" as Id<"posTransaction">,
        completedAt: Date.UTC(2026, 4, 5, 12),
        payments: [{ amount: 12_000, method: "mobile_money", timestamp: 1 }],
        storeId: "store-1" as Id<"store">,
        total: 12_000,
      },
    ] as never);
    vi.mocked(listCompletedTransactionsSince).mockResolvedValue([
      {
        _id: "txn-current" as Id<"posTransaction">,
        completedAt: Date.UTC(2026, 5, 20, 15),
        payments: [{ amount: 18_000, method: "cash", timestamp: 1 }],
        storeId: "store-1" as Id<"store">,
        total: 18_000,
      },
      {
        _id: "txn-older" as Id<"posTransaction">,
        completedAt: Date.UTC(2026, 4, 5, 12),
        payments: [{ amount: 12_000, method: "mobile_money", timestamp: 1 }],
        storeId: "store-1" as Id<"store">,
        total: 12_000,
      },
    ] as never);
    vi.mocked(listTransactionItems).mockResolvedValue([
      {
        productId: "product-1",
        productName: "Braiding hair",
        productSku: "BRAID-1",
        productSkuId: "sku-1",
        quantity: 1,
        totalPrice: 12_000,
      },
    ] as never);
    const query = vi.fn(() => ({
      withIndex: vi.fn(() => ({
        collect: vi.fn().mockResolvedValue([]),
        take: vi.fn().mockResolvedValue([]),
        order: vi.fn(() => ({
          take: vi.fn().mockResolvedValue([]),
        })),
      })),
    }));

    const result = await getTodaySummary(
      {
        db: { query },
      } as never,
      {
        pulseWindow: "all_time",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(listCompletedTransactionsSince).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      {
        completedFrom: 0,
        limit: 400,
        storeId: "store-1",
      },
    );
    expect(result.totalSales).toBe(30_000);
    expect(result.operatorSnapshot.comparison.yesterdaySales).toBe(0);
    expect(result.operatorSnapshot.comparison.salesDeltaPercent).toBe(0);
    expect(result.operatorSnapshot.trend.map((day) => day.date)).toEqual([
      "2026-05-05",
      "2026-06-20",
    ]);
  });

  it("returns a bounded operator snapshot for recent POS history", async () => {
    vi.setSystemTime(new Date("2026-06-20T15:30:00.000Z"));
    vi.mocked(listCompletedTransactionsForDay).mockResolvedValue([
      {
        _id: "txn-today" as Id<"posTransaction">,
        storeId: "store-1" as Id<"store">,
        total: 18_000,
      },
    ] as never);
    vi.mocked(listCompletedTransactionsSince).mockResolvedValue([
      {
        _id: "txn-today" as Id<"posTransaction">,
        completedAt: Date.UTC(2026, 5, 20, 15),
        paymentMethod: "cash",
        payments: [{ amount: 18_000, method: "cash", timestamp: 1 }],
        storeId: "store-1" as Id<"store">,
        total: 18_000,
      },
      {
        _id: "txn-prior" as Id<"posTransaction">,
        completedAt: Date.UTC(2026, 5, 19, 18),
        payments: [{ amount: 12_000, method: "mobile_money", timestamp: 1 }],
        storeId: "store-1" as Id<"store">,
        total: 12_000,
      },
    ] as never);
    vi.mocked(listTransactionItems)
      .mockResolvedValueOnce([{ quantity: 2 }] as never)
      .mockResolvedValueOnce([
        {
          productId: "product-1",
          productName: "Braiding hair",
          productSku: "BRAID-1",
          productSkuId: "sku-1",
          quantity: 2,
          totalPrice: 18_000,
        },
      ] as never)
      .mockResolvedValueOnce([
        {
          productId: "product-1",
          productName: "Braiding hair",
          productSku: "BRAID-1",
          productSkuId: "sku-1",
          quantity: 1,
          totalPrice: 12_000,
        },
      ] as never);
    const query = vi.fn(() => ({
      withIndex: vi.fn(() => ({
        collect: vi.fn().mockResolvedValue([]),
        take: vi.fn().mockResolvedValue([]),
        order: vi.fn(() => ({
          take: vi.fn().mockResolvedValue([]),
        })),
      })),
    }));

    const result = await getTodaySummary(
      {
        db: { query },
      } as never,
      {
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(listCompletedTransactionsSince).toHaveBeenCalledWith(
      expect.anything(),
      {
        completedFrom: Date.parse("2026-06-07T00:00:00.000Z"),
        limit: 400,
        storeId: "store-1",
      },
    );
    expect(result.operatorSnapshot).toEqual(
      expect.objectContaining({
        busiestHour: {
          hour: 15,
          label: "3 PM",
          totalSales: 18_000,
          transactionCount: 1,
        },
        comparison: {
          averageTransactionDeltaPercent: 50,
          currentAverageTransaction: 18_000,
          currentItemsSold: 2,
          currentSales: 18_000,
          currentTransactions: 1,
          itemsSoldDeltaPercent: 100,
          salesDeltaPercent: 50,
          transactionDeltaPercent: 0,
          yesterdayAverageTransaction: 12_000,
          yesterdayItemsSold: 1,
          yesterdaySales: 12_000,
          yesterdayTransactions: 1,
        },
        paymentMix: [
          {
            count: 1,
            label: "Cash",
            method: "cash",
            share: 60,
            total: 18_000,
          },
          {
            count: 1,
            label: "Mobile money",
            method: "mobile_money",
            share: 40,
            total: 12_000,
          },
        ],
        topItems: [
          {
            name: "Braiding hair",
            productSku: "BRAID-1",
            quantity: 3,
            totalSales: 30_000,
          },
        ],
        usableHistoryDays: 1,
      }),
    );
    expect(result.operatorSnapshot.trend.at(-1)).toEqual(
      expect.objectContaining({
        date: "2026-06-20",
        totalSales: 18_000,
        transactionCount: 1,
      }),
    );
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

  it("surfaces a pending void approval request for completed transactions", async () => {
    vi.mocked(getPosTransactionById).mockResolvedValue({
      _id: "txn-pending-void" as Id<"posTransaction">,
      storeId: "store-1" as Id<"store">,
      transactionNumber: "POS-851031",
      subtotal: 6000,
      tax: 0,
      total: 6000,
      paymentMethod: "cash",
      payments: [],
      totalPaid: 6000,
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
      {
        db: mockCorrectionHistoryDb({
          approvalRequests: [
            {
              _id: "approval-request-1",
              createdAt: 200,
              posTransactionId: "txn-pending-void",
              requestType: "pos_transaction_void",
              requestedByStaffProfileId: "staff-1",
              status: "pending",
              storeId: "store-1",
              subjectId: "txn-pending-void",
              subjectType: "pos_transaction",
            },
          ],
        }),
      } as never,
      {
        transactionId: "txn-pending-void" as Id<"posTransaction">,
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        pendingVoidApprovalRequest: {
          _id: "approval-request-1",
          createdAt: 200,
          requestedByStaffProfileId: "staff-1",
        },
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
            return { collect, take: vi.fn().mockResolvedValue([]) };
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

  it("surfaces POS-linked service payment lines on mixed transaction detail", async () => {
    vi.mocked(getPosTransactionById).mockResolvedValue({
      _id: "txn-mixed" as Id<"posTransaction">,
      registerSessionId: "register-session-1" as Id<"registerSession">,
      storeId: "store-1" as Id<"store">,
      transactionNumber: "POS-MIXED",
      subtotal: 22000,
      tax: 0,
      total: 22000,
      paymentMethod: "cash",
      payments: [{ method: "cash", amount: 22000, timestamp: 1 }],
      totalPaid: 22000,
      status: "completed",
      completedAt: 100,
    } as never);
    vi.mocked(getCashierById).mockResolvedValue(null as never);
    vi.mocked(getPosSessionById).mockResolvedValue(null as never);
    vi.mocked(getRegisterSessionById).mockResolvedValue({
      _id: "register-session-1" as Id<"registerSession">,
      registerNumber: "2",
      status: "open",
    } as never);
    vi.mocked(listTransactionItems).mockResolvedValue([
      {
        _id: "item-1",
        productName: "Edge brush",
        productSku: "BRUSH",
        quantity: 1,
        totalPrice: 7000,
      },
    ] as never);

    const result = await getTransactionById(
      {
        db: mockCorrectionHistoryDb({
          get: vi.fn(async (tableName: string, id: string) => {
            if (tableName === "serviceCase" && id === "case-1") {
              return {
                _id: "case-1",
                operationalWorkItemId: "work-1",
                paymentStatus: "partially_paid",
                serviceCatalogId: "catalog-1",
                serviceMode: "repair",
                status: "intake",
              };
            }
            if (tableName === "serviceCatalog" && id === "catalog-1") {
              return { _id: "catalog-1", name: "Closure repair" };
            }
            if (tableName === "operationalWorkItem" && id === "work-1") {
              return { _id: "work-1", title: "Repair for Ama" };
            }
            return null;
          }),
          serviceLines: [
            {
              _id: "service-line-1",
              transactionId: "txn-mixed",
              serviceCaseId: "case-1",
              serviceCatalogId: "catalog-1",
              serviceName: "Closure repair",
              serviceMode: "repair",
              quantity: 1,
              unitPrice: 15000,
              totalPrice: 15000,
            },
          ],
        }),
      } as never,
      {
        transactionId: "txn-mixed" as Id<"posTransaction">,
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        serviceLineCount: 1,
        servicePaymentTotal: 15000,
        serviceLines: [
          expect.objectContaining({
            name: "Closure repair",
            serviceCaseId: "case-1",
            serviceCaseTitle: "Repair for Ama",
            servicePaymentStatus: "partially_paid",
            totalPrice: 15000,
          }),
        ],
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
