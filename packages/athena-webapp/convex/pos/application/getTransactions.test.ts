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
  listCompletedTransactions,
  listTransactionItems,
} from "../infrastructure/repositories/transactionRepository";

vi.mock("../infrastructure/repositories/transactionRepository", () => ({
  getCashierById: vi.fn(),
  getCustomerById: vi.fn(),
  getPosSessionById: vi.fn(),
  getPosTransactionById: vi.fn(),
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

  it("returns the related session trace id when the completed sale came from a traced POS session", async () => {
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
        saleTraceId: "pos_sale:pos-123456",
        sessionTraceId: "pos_session:ses-001",
      }),
    ]);
  });
});

describe("getTransactionById", () => {
  it("returns hasTrace true when the transaction already carries a persisted workflow trace id", async () => {
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
        hasTrace: true,
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
        saleTraceId: "pos_sale:pos-222222",
        sessionTraceId: "pos_session:ses-001",
      }),
    );
  });
});
