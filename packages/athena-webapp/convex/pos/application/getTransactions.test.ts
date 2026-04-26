import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../_generated/dataModel";
import {
  getCompletedTransactions,
  getTransactionById,
} from "./queries/getTransactions";
import {
  getCashierById,
  getCustomerById,
  getPosSessionById,
  getPosTransactionById,
  getRegisterSessionById,
  listCompletedTransactions,
  listTransactionItems,
} from "../infrastructure/repositories/transactionRepository";

vi.mock("../infrastructure/repositories/transactionRepository", () => ({
  getCashierById: vi.fn(),
  getCustomerById: vi.fn(),
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
});

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
        customerId: undefined,
      },
    ] as never);
    vi.mocked(getCashierById).mockResolvedValue(null as never);
    vi.mocked(getCustomerById).mockResolvedValue(null as never);
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
        customerId: undefined,
        workflowTraceId: "pos_sale:pos-123456",
      },
    ] as never);
    vi.mocked(getCashierById).mockResolvedValue(null as never);
    vi.mocked(getCustomerById).mockResolvedValue(null as never);
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
    vi.mocked(getCustomerById).mockResolvedValue(null as never);
    vi.mocked(getPosSessionById).mockResolvedValue(null as never);
    vi.mocked(listTransactionItems).mockResolvedValue([] as never);

    const result = await getTransactionById({} as never, {
      transactionId: "txn-1" as Id<"posTransaction">,
    });

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
    vi.mocked(getCustomerById).mockResolvedValue(null as never);
    vi.mocked(getPosSessionById).mockResolvedValue(null as never);
    vi.mocked(listTransactionItems).mockResolvedValue([] as never);

    const result = await getTransactionById({} as never, {
      transactionId: "txn-2" as Id<"posTransaction">,
    });

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
    vi.mocked(getCustomerById).mockResolvedValue(null as never);
    vi.mocked(getPosSessionById).mockResolvedValue({
      _id: "session-1" as Id<"posSession">,
      workflowTraceId: "pos_session:ses-001",
    } as never);
    vi.mocked(listTransactionItems).mockResolvedValue([] as never);

    const result = await getTransactionById({} as never, {
      transactionId: "txn-3" as Id<"posTransaction">,
    });

    expect(result).toEqual(
      expect.objectContaining({
        hasTrace: true,
        sessionTraceId: "pos_session:ses-001",
      }),
    );
  });

  it("falls back to the register session register number for transaction details", async () => {
    vi.mocked(getPosTransactionById).mockResolvedValue({
      _id: "txn-4" as Id<"posTransaction">,
      sessionId: "session-1" as Id<"posSession">,
      registerSessionId: "register-1" as Id<"registerSession">,
      storeId: "store-1" as Id<"store">,
      transactionNumber: "POS-333333",
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
    vi.mocked(getCustomerById).mockResolvedValue(null as never);
    vi.mocked(getPosSessionById).mockResolvedValue({
      _id: "session-1" as Id<"posSession">,
      workflowTraceId: "pos_session:ses-001",
      registerNumber: undefined,
      registerSessionId: "register-1" as Id<"registerSession">,
    } as never);
    vi.mocked(getRegisterSessionById).mockResolvedValue({
      _id: "register-1" as Id<"registerSession">,
      registerNumber: "7",
    } as never);
    vi.mocked(listTransactionItems).mockResolvedValue([] as never);

    const result = await getTransactionById({} as never, {
      transactionId: "txn-4" as Id<"posTransaction">,
    });

    expect(result).toEqual(
      expect.objectContaining({
        registerSessionId: "register-1",
        registerNumber: "7",
      }),
    );
  });
});
