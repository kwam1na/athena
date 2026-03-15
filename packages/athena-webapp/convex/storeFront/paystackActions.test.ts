// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const { listTransactions, verifyTransaction } = vi.hoisted(() => ({
  listTransactions: vi.fn(),
  verifyTransaction: vi.fn(),
}));

function wrapDefinition<T extends { handler: (...args: any[]) => any }>(
  definition: T
) {
  return Object.assign(
    (ctx: unknown, args: unknown) => definition.handler(ctx, args),
    definition
  );
}
function h(fn: any): (...args: any[]) => any {
  return fn.handler;
}


async function loadModule() {
  vi.resetModules();

  vi.doMock("../_generated/server", () => ({
    action: wrapDefinition,
  }));

  vi.doMock("../_generated/api", () => ({
    internal: {},
  }));

  vi.doMock("../paystack", () => ({
    listTransactions,
    verifyTransaction,
  }));

  return import("./paystackActions");
}

describe("paystackActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches all transactions with pass-through filters", async () => {
    const { getAllTransactions } = await loadModule();

    listTransactions.mockResolvedValue({
      data: [{ id: "txn_1" }],
    });

    const result = await h(getAllTransactions)({} as never, {
      perPage: 25,
      page: 2,
      status: "success",
      from: "2026-03-01",
      to: "2026-03-15",
      customerEmail: "ada@example.com",
      createdAfter: 123,
      sameDay: 456,
    });

    expect(listTransactions).toHaveBeenCalledWith({
      perPage: 25,
      page: 2,
      status: "success",
      from: "2026-03-01",
      to: "2026-03-15",
      customerEmail: "ada@example.com",
      createdAfter: 123,
      sameDay: 456,
    });
    expect(result).toEqual({
      success: true,
      data: [{ id: "txn_1" }],
      message: "Transactions fetched successfully",
    });
  });

  it("supports invoking the wrapped action function directly", async () => {
    const { getAllTransactions } = await loadModule();

    listTransactions.mockResolvedValue({
      data: [],
    });

    const result = await getAllTransactions({} as never, {});

    expect(result).toEqual({
      success: true,
      data: [],
      message: "Transactions fetched successfully",
    });
  });

  it("returns an error response when fetching transactions fails", async () => {
    const { getAllTransactions } = await loadModule();
    listTransactions.mockRejectedValue(new Error("Paystack unavailable"));

    const result = await h(getAllTransactions)({} as never, {});

    expect(result).toEqual({
      success: false,
      message: "Paystack unavailable",
    });
  });

  it("returns fallback message when fetching transactions throws non-Error", async () => {
    const { getAllTransactions } = await loadModule();
    listTransactions.mockRejectedValue("network down");

    const result = await h(getAllTransactions)({} as never, {});

    expect(result).toEqual({
      success: false,
      message: "Failed to fetch transactions",
    });
  });

  it("verifies a transaction reference", async () => {
    const { checkTransactionStatus } = await loadModule();
    verifyTransaction.mockResolvedValue({
      data: { reference: "ref_123", status: "success" },
    });

    const result = await h(checkTransactionStatus)({} as never, {
      reference: "ref_123",
    });

    expect(verifyTransaction).toHaveBeenCalledWith("ref_123");
    expect(result).toEqual({
      success: true,
      data: { reference: "ref_123", status: "success" },
      message: "Transaction verification successful",
    });
  });

  it("returns an error response when verification fails", async () => {
    const { checkTransactionStatus } = await loadModule();
    verifyTransaction.mockRejectedValue(new Error("Invalid reference"));

    const result = await h(checkTransactionStatus)({} as never, {
      reference: "bad_ref",
    });

    expect(result).toEqual({
      success: false,
      message: "Invalid reference",
    });
  });

  it("returns fallback message when verification throws non-Error", async () => {
    const { checkTransactionStatus } = await loadModule();
    verifyTransaction.mockRejectedValue({ status: 500 });

    const result = await h(checkTransactionStatus)({} as never, {
      reference: "bad_ref",
    });

    expect(result).toEqual({
      success: false,
      message: "Failed to verify transaction",
    });
  });

  it("fetches transactions for an order using same-day successful payments", async () => {
    const { findOrderTransactions } = await loadModule();
    listTransactions.mockResolvedValue({
      data: [{ id: "txn_2" }],
    });

    const result = await h(findOrderTransactions)({} as never, {
      customerEmail: "ada@example.com",
      orderCreatedAt: 1741996800000,
      timeBuffer: 60000,
    });

    expect(listTransactions).toHaveBeenCalledWith({
      customerEmail: "ada@example.com",
      sameDay: 1741996800000,
      status: "success",
    });
    expect(result).toEqual({
      success: true,
      data: [{ id: "txn_2" }],
      message: "Order transactions fetched successfully",
    });
  });

  it("returns an error response when order transaction lookup fails", async () => {
    const { findOrderTransactions } = await loadModule();
    listTransactions.mockRejectedValue("unknown failure");

    const result = await h(findOrderTransactions)({} as never, {
      customerEmail: "ada@example.com",
      orderCreatedAt: 1741996800000,
    });

    expect(result).toEqual({
      success: false,
      message: "Failed to fetch order transactions",
    });
  });

  it("returns Error.message when order lookup throws an Error", async () => {
    const { findOrderTransactions } = await loadModule();
    listTransactions.mockRejectedValue(new Error("lookup timeout"));

    const result = await h(findOrderTransactions)({} as never, {
      customerEmail: "ada@example.com",
      orderCreatedAt: 1741996800000,
    });

    expect(result).toEqual({
      success: false,
      message: "lookup timeout",
    });
  });
});
