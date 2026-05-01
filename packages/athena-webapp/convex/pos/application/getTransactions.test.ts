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
  get?: ReturnType<typeof vi.fn>;
  correctionHistory?: unknown[];
}) {
  return {
    get: overrides?.get ?? vi.fn().mockResolvedValue(null),
    query: vi.fn(() => ({
      withIndex: vi.fn(() => ({
        collect: vi.fn().mockResolvedValue(overrides?.correctionHistory ?? []),
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
});
