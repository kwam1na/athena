import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../_generated/dataModel";
import {
  appendWorkflowTraceEventWithCtx,
  createWorkflowTraceWithCtx,
  registerWorkflowTraceLookupWithCtx,
} from "../../workflowTraces/core";
import {
  completeTransaction,
  createTransactionFromSessionHandler,
  buildCompleteTransactionResult,
} from "./commands/completeTransaction";
import {
  createPosTransaction,
  createPosTransactionItem,
  getPosSessionById,
  getRegisterSessionById,
  getProductSkuById,
  getStoreById,
  listSessionItems,
  patchPosTransaction,
  patchPosSession,
  patchProductSku,
} from "../infrastructure/repositories/transactionRepository";
import { recordRetailSalePaymentAllocations } from "../infrastructure/integrations/paymentAllocationService";
import { updateCustomerStats } from "../infrastructure/repositories/customerRepository";

vi.mock("../../workflowTraces/core", () => ({
  appendWorkflowTraceEventWithCtx: vi.fn(),
  createWorkflowTraceWithCtx: vi.fn(),
  registerWorkflowTraceLookupWithCtx: vi.fn(),
}));

vi.mock("../infrastructure/repositories/transactionRepository", () => ({
  createPosTransaction: vi.fn(),
  createPosTransactionItem: vi.fn(),
  getPosSessionById: vi.fn(),
  getRegisterSessionById: vi.fn(),
  getPosTransactionById: vi.fn(),
  getProductSkuById: vi.fn(),
  getStoreById: vi.fn(),
  listSessionItems: vi.fn(),
  listTransactionItems: vi.fn(),
  patchPosSession: vi.fn(),
  patchPosTransaction: vi.fn(),
  patchProductSku: vi.fn(),
}));

vi.mock("../infrastructure/integrations/paymentAllocationService", () => ({
  recordRetailSalePaymentAllocations: vi.fn(),
  recordRetailVoidPaymentAllocations: vi.fn(),
}));

vi.mock("../infrastructure/repositories/customerRepository", () => ({
  updateCustomerStats: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();
});

function expectNoCompletionSideEffects() {
  expect(createPosTransaction).not.toHaveBeenCalled();
  expect(createPosTransactionItem).not.toHaveBeenCalled();
  expect(patchProductSku).not.toHaveBeenCalled();
  expect(patchPosSession).not.toHaveBeenCalled();
  expect(patchPosTransaction).not.toHaveBeenCalled();
  expect(recordRetailSalePaymentAllocations).not.toHaveBeenCalled();
  expect(updateCustomerStats).not.toHaveBeenCalled();
  expect(createWorkflowTraceWithCtx).not.toHaveBeenCalled();
  expect(registerWorkflowTraceLookupWithCtx).not.toHaveBeenCalled();
  expect(appendWorkflowTraceEventWithCtx).not.toHaveBeenCalled();
}

describe("buildCompleteTransactionResult", () => {
  it("returns ok with transaction data when completion succeeds", () => {
    const result = buildCompleteTransactionResult({
      transactionId: "txn-1" as Id<"posTransaction">,
      transactionNumber: "POS-TXN-001",
      paymentAllocated: true,
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      throw new Error("Expected successful completion result");
    }
    expect(result.data.transactionNumber).toBe("POS-TXN-001");
  });

  it("does not fail completion when no payment allocations are recorded", () => {
    const result = buildCompleteTransactionResult({
      transactionId: "txn-1" as Id<"posTransaction">,
      transactionNumber: "POS-TXN-001",
      paymentAllocated: false,
    });

    expect(result.status).toBe("ok");
  });

  it("returns validationFailed when transaction identifiers are missing", () => {
    const result = buildCompleteTransactionResult({
      transactionId: null,
      transactionNumber: null,
      paymentAllocated: true,
    });

    expect(result.status).toBe("validationFailed");
  });
});

describe("completeTransaction checkout side effects", () => {
  it("requires a terminal before recording a direct register sale", async () => {
    vi.mocked(getProductSkuById).mockResolvedValue({
      _id: "sku-1",
      images: [],
      inventoryCount: 10,
      productId: "product-1",
      quantityAvailable: 10,
      sku: "SKU-1",
    } as never);

    await expect(
      completeTransaction({ runMutation: vi.fn() } as never, {
        storeId: "store-1" as Id<"store">,
        items: [
          {
            skuId: "sku-1" as Id<"productSku">,
            quantity: 1,
            price: 10,
            name: "Sneaker",
            sku: "SKU-1",
          },
        ],
        payments: [{ method: "cash", amount: 10, timestamp: 1 }],
        subtotal: 10,
        tax: 0,
        total: 10,
        registerSessionId: "register-1" as Id<"registerSession">,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        kind: "user_error",
        error: expect.objectContaining({
          code: "precondition_failed",
          message: "Register session transactions must include a terminal.",
        }),
      }),
    );

    expectNoCompletionSideEffects();
  });

  it("records register sale and payment allocation for a direct register sale", async () => {
    const runMutation = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      runMutation,
    } as never;

    vi.mocked(getStoreById).mockResolvedValue({
      _id: "store-1",
      organizationId: "org-1",
    } as never);
    vi.mocked(getProductSkuById).mockResolvedValue({
      _id: "sku-1",
      images: [],
      inventoryCount: 10,
      productId: "product-1",
      quantityAvailable: 10,
      sku: "SKU-1",
    } as never);
    vi.mocked(createPosTransaction).mockResolvedValue("txn-1" as never);
    vi.mocked(recordRetailSalePaymentAllocations).mockResolvedValue(true);
    vi.mocked(createPosTransactionItem).mockResolvedValue(
      "txn-item-1" as never,
    );
    vi.mocked(patchProductSku).mockResolvedValue(undefined as never);

    await expect(
      completeTransaction(ctx, {
        storeId: "store-1" as Id<"store">,
        items: [
          {
            skuId: "sku-1" as Id<"productSku">,
            quantity: 1,
            price: 10,
            name: "Sneaker",
            sku: "SKU-1",
          },
        ],
        payments: [{ method: "cash", amount: 12, timestamp: 1 }],
        subtotal: 10,
        tax: 0,
        total: 10,
        registerNumber: "1",
        terminalId: "terminal-1" as Id<"posTerminal">,
        registerSessionId: "register-1" as Id<"registerSession">,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        kind: "ok",
        data: expect.objectContaining({
          transactionId: "txn-1",
          transactionItems: ["txn-item-1"],
        }),
      }),
    );

    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        adjustmentKind: "sale",
        changeGiven: 2,
        registerSessionId: "register-1",
        registerNumber: "1",
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    );
    expect(recordRetailSalePaymentAllocations).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        changeGiven: 2,
        organizationId: "org-1",
        posTransactionId: "txn-1",
        registerSessionId: "register-1",
        storeId: "store-1",
      }),
    );
  });

  it("does not create side effects when payments are empty", async () => {
    vi.mocked(getProductSkuById).mockResolvedValue({
      _id: "sku-1",
      images: [],
      inventoryCount: 10,
      productId: "product-1",
      quantityAvailable: 10,
      sku: "SKU-1",
    } as never);

    await expect(
      completeTransaction({} as never, {
        storeId: "store-1" as Id<"store">,
        items: [
          {
            skuId: "sku-1" as Id<"productSku">,
            quantity: 1,
            price: 10,
            name: "Sneaker",
            sku: "SKU-1",
          },
        ],
        payments: [],
        subtotal: 10,
        tax: 0,
        total: 10,
      }),
    ).resolves.toMatchObject({
      kind: "user_error",
      error: {
        code: "validation_failed",
        message: "At least one payment is required.",
      },
    });

    expectNoCompletionSideEffects();
  });

  it("does not create side effects when payment is insufficient", async () => {
    vi.mocked(getProductSkuById).mockResolvedValue({
      _id: "sku-1",
      images: [],
      inventoryCount: 10,
      productId: "product-1",
      quantityAvailable: 10,
      sku: "SKU-1",
    } as never);

    await expect(
      completeTransaction({} as never, {
        storeId: "store-1" as Id<"store">,
        items: [
          {
            skuId: "sku-1" as Id<"productSku">,
            quantity: 1,
            price: 10,
            name: "Sneaker",
            sku: "SKU-1",
          },
        ],
        payments: [{ method: "cash", amount: 9, timestamp: 1 }],
        subtotal: 10,
        tax: 0,
        total: 10,
      }),
    ).resolves.toMatchObject({
      kind: "user_error",
      error: {
        code: "validation_failed",
        message: "Insufficient payment. Total: 10.00, Paid: 9.00",
      },
    });

    expectNoCompletionSideEffects();
  });

  it("does not create side effects when a direct sale SKU is missing", async () => {
    vi.mocked(getProductSkuById).mockResolvedValue(null as never);

    await expect(
      completeTransaction({} as never, {
        storeId: "store-1" as Id<"store">,
        items: [
          {
            skuId: "sku-missing" as Id<"productSku">,
            quantity: 1,
            price: 10,
            name: "Sneaker",
            sku: "SKU-MISSING",
          },
        ],
        payments: [{ method: "cash", amount: 10, timestamp: 1 }],
        subtotal: 10,
        tax: 0,
        total: 10,
      }),
    ).resolves.toMatchObject({
      kind: "user_error",
      error: {
        code: "not_found",
        message: "Product SKU sku-missing not found.",
      },
    });

    expectNoCompletionSideEffects();
  });

  it("aggregates duplicate SKU quantities before availability checks", async () => {
    vi.mocked(getProductSkuById).mockResolvedValue({
      _id: "sku-1",
      images: [],
      inventoryCount: 3,
      productId: "product-1",
      quantityAvailable: 3,
      sku: "SKU-1",
    } as never);

    await expect(
      completeTransaction({} as never, {
        storeId: "store-1" as Id<"store">,
        items: [
          {
            skuId: "sku-1" as Id<"productSku">,
            quantity: 2,
            price: 10,
            name: "sneaker",
            sku: "SKU-1",
          },
          {
            skuId: "sku-1" as Id<"productSku">,
            quantity: 2,
            price: 10,
            name: "sneaker",
            sku: "SKU-1",
          },
        ],
        payments: [{ method: "cash", amount: 40, timestamp: 1 }],
        subtotal: 40,
        tax: 0,
        total: 40,
      }),
    ).resolves.toMatchObject({
      kind: "user_error",
      error: {
        code: "conflict",
        message:
          "Insufficient inventory for Sneaker (SKU-1). Available: 3, Total Requested: 4",
      },
    });

    expect(getProductSkuById).toHaveBeenCalledTimes(1);
    expectNoCompletionSideEffects();
  });
});

describe("completeTransaction trace ordering", () => {
  it("does not write a POS sale trace for direct-sale completion", async () => {
    vi.mocked(getStoreById).mockResolvedValue({
      _id: "store-1",
      organizationId: "org-1",
    } as never);
    vi.mocked(getProductSkuById).mockResolvedValue({
      _id: "sku-1",
      images: [],
      inventoryCount: 10,
      productId: "product-1",
      quantityAvailable: 10,
      sku: "SKU-1",
    } as never);
    vi.mocked(createPosTransaction).mockResolvedValue("txn-1" as never);
    vi.mocked(recordRetailSalePaymentAllocations).mockResolvedValue(true);
    vi.mocked(updateCustomerStats).mockRejectedValue(
      new Error("customer stats unavailable"),
    );

    const traceEvents: string[] = [];
    vi.mocked(createWorkflowTraceWithCtx).mockImplementation(async (_ctx, input) => {
      traceEvents.push(`trace:create:${input.status}`);
      return "trace-1" as never;
    });
    vi.mocked(registerWorkflowTraceLookupWithCtx).mockImplementation(async () => {
      traceEvents.push("trace:lookup");
      return "lookup-1" as never;
    });
    vi.mocked(appendWorkflowTraceEventWithCtx).mockImplementation(async (_ctx, input) => {
      traceEvents.push(`trace:event:${input.step}`);
      return "event-1" as never;
    });

    await expect(
      completeTransaction({} as never, {
        storeId: "store-1" as Id<"store">,
        items: [
          {
            skuId: "sku-1" as Id<"productSku">,
            quantity: 1,
            price: 10,
            name: "Sneaker",
            sku: "SKU-1",
          },
        ],
        payments: [{ method: "cash", amount: 10, timestamp: 1 }],
        subtotal: 10,
        tax: 0,
        total: 10,
      }),
    ).resolves.toMatchObject({ kind: "ok" });

    expect(traceEvents).toEqual([]);
    expect(patchPosTransaction).not.toHaveBeenCalledWith(
      expect.anything(),
      "txn-1",
      expect.objectContaining({
        workflowTraceId: expect.any(String),
      }),
    );
  });

  it("does not write a POS sale trace for session-based checkout", async () => {
    const runMutation = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      runMutation,
    } as never;

    vi.mocked(getStoreById).mockResolvedValue({
      _id: "store-1",
      organizationId: "org-1",
    } as never);
    vi.mocked(getPosSessionById).mockResolvedValue({
      _id: "session-1",
      storeId: "store-1",
      customerId: undefined,
      customerProfileId: "profile-1",
      staffProfileId: "staff-1",
      registerNumber: "1",
      registerSessionId: "register-1",
      subtotal: 10,
      tax: 0,
      total: 10,
      terminalId: "terminal-1",
      customerInfo: undefined,
    } as never);
    vi.mocked(getRegisterSessionById).mockResolvedValue({
      _id: "register-1",
      storeId: "store-1",
      status: "open",
      terminalId: "terminal-1",
      registerNumber: "1",
    } as never);
    vi.mocked(listSessionItems).mockResolvedValue([
      {
        _id: "session-item-1",
        sessionId: "session-1",
        storeId: "store-1",
        productId: "product-1",
        productSkuId: "sku-1",
        productSku: "SKU-1",
        productName: "Sneaker",
        price: 10,
        quantity: 1,
        image: undefined,
      },
    ] as never);
    vi.mocked(getProductSkuById).mockResolvedValue({
      _id: "sku-1",
      images: [],
      inventoryCount: 10,
      productId: "product-1",
      quantityAvailable: 10,
      sku: "SKU-1",
    } as never);
    vi.mocked(createPosTransaction).mockResolvedValue("txn-1" as never);
    vi.mocked(recordRetailSalePaymentAllocations).mockResolvedValue(true);
    vi.mocked(createPosTransactionItem).mockResolvedValue(
      "txn-item-1" as never,
    );
    vi.mocked(patchProductSku).mockResolvedValue(undefined as never);
    vi.mocked(patchPosSession).mockRejectedValue(
      new Error("session patch unavailable"),
    );

    const traceEvents: string[] = [];
    vi.mocked(createWorkflowTraceWithCtx).mockImplementation(async (_ctx, input) => {
      traceEvents.push(`trace:create:${input.status}`);
      return "trace-1" as never;
    });
    vi.mocked(registerWorkflowTraceLookupWithCtx).mockImplementation(async () => {
      traceEvents.push("trace:lookup");
      return "lookup-1" as never;
    });
    vi.mocked(appendWorkflowTraceEventWithCtx).mockImplementation(async (_ctx, input) => {
      traceEvents.push(`trace:event:${input.step}`);
      return "event-1" as never;
    });

    await expect(
      createTransactionFromSessionHandler(ctx, {
        sessionId: "session-1" as Id<"posSession">,
        staffProfileId: "staff-1" as Id<"staffProfile">,
        payments: [{ method: "cash", amount: 10, timestamp: 1 }],
      }),
    ).rejects.toThrow("session patch unavailable");

    expect(traceEvents).toEqual([]);
    expect(patchPosTransaction).not.toHaveBeenCalledWith(
      expect.anything(),
      "txn-1",
      expect.objectContaining({
        workflowTraceId: expect.any(String),
      }),
    );
  });

  it("uses the stored session drawer binding during session-based checkout", async () => {
    const runMutation = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      runMutation,
    } as never;

    vi.mocked(getStoreById).mockResolvedValue({
      _id: "store-1",
      organizationId: "org-1",
    } as never);
    vi.mocked(getPosSessionById).mockResolvedValue({
      _id: "session-1",
      storeId: "store-1",
      customerId: undefined,
      customerProfileId: "profile-1",
      staffProfileId: "staff-1",
      registerNumber: "1",
      registerSessionId: "register-1",
      subtotal: 10,
      tax: 0,
      total: 10,
      terminalId: "terminal-1",
      customerInfo: undefined,
    } as never);
    vi.mocked(getRegisterSessionById).mockResolvedValue({
      _id: "register-1",
      storeId: "store-1",
      status: "open",
      terminalId: "terminal-1",
      registerNumber: "1",
    } as never);
    vi.mocked(listSessionItems).mockResolvedValue([
      {
        _id: "session-item-1",
        sessionId: "session-1",
        storeId: "store-1",
        productId: "product-1",
        productSkuId: "sku-1",
        productSku: "SKU-1",
        productName: "Sneaker",
        price: 10,
        quantity: 1,
        image: undefined,
      },
    ] as never);
    vi.mocked(getProductSkuById).mockResolvedValue({
      _id: "sku-1",
      images: [],
      inventoryCount: 10,
      productId: "product-1",
      quantityAvailable: 10,
      sku: "SKU-1",
    } as never);
    vi.mocked(createPosTransaction).mockResolvedValue("txn-1" as never);
    vi.mocked(recordRetailSalePaymentAllocations).mockResolvedValue(true);
    vi.mocked(createPosTransactionItem).mockResolvedValue(
      "txn-item-1" as never,
    );
    vi.mocked(patchProductSku).mockResolvedValue(undefined as never);
    vi.mocked(patchPosSession).mockResolvedValue(undefined as never);
    vi.mocked(createWorkflowTraceWithCtx).mockResolvedValue("trace-1" as never);
    vi.mocked(registerWorkflowTraceLookupWithCtx).mockResolvedValue(
      "lookup-1" as never,
    );
    vi.mocked(appendWorkflowTraceEventWithCtx).mockResolvedValue(
      "event-1" as never,
    );
    vi.mocked(patchPosTransaction).mockResolvedValue(undefined as never);

    await expect(
      createTransactionFromSessionHandler(ctx, {
        sessionId: "session-1" as Id<"posSession">,
        staffProfileId: "staff-1" as Id<"staffProfile">,
        payments: [{ method: "cash", amount: 10, timestamp: 1 }],
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        kind: "ok",
        data: expect.objectContaining({
          transactionId: "txn-1",
        }),
      }),
    );

    expect(createPosTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        registerSessionId: "register-1",
        customerProfileId: "profile-1",
      }),
    );
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        registerSessionId: "register-1",
      }),
    );
    expect(recordRetailSalePaymentAllocations).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        registerSessionId: "register-1",
      }),
    );
  });

  it("fails before transaction side effects when the checkout cashier does not own the session", async () => {
    vi.mocked(getPosSessionById).mockResolvedValue({
      _id: "session-1",
      storeId: "store-1",
      customerId: undefined,
      staffProfileId: "staff-1",
      registerNumber: "1",
      registerSessionId: "register-1",
      subtotal: 10,
      tax: 0,
      total: 10,
      terminalId: "terminal-1",
      customerInfo: undefined,
    } as never);

    await expect(
      createTransactionFromSessionHandler({} as never, {
        sessionId: "session-1" as Id<"posSession">,
        staffProfileId: "staff-2" as Id<"staffProfile">,
        payments: [{ method: "cash", amount: 10, timestamp: 1 }],
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        kind: "user_error",
        error: expect.objectContaining({
          code: "precondition_failed",
          message: "This session is not associated with your cashier.",
        }),
      }),
    );

    expect(listSessionItems).not.toHaveBeenCalled();
    expectNoCompletionSideEffects();
  });

  it("fails when a session sale is not bound to an open drawer", async () => {
    vi.mocked(getPosSessionById).mockResolvedValue({
      _id: "session-1",
      storeId: "store-1",
      customerId: undefined,
      staffProfileId: "staff-1",
      registerNumber: "1",
      subtotal: 10,
      tax: 0,
      total: 10,
      terminalId: "terminal-1",
      customerInfo: undefined,
    } as never);
    vi.mocked(listSessionItems).mockResolvedValue([
      {
        _id: "session-item-1",
        sessionId: "session-1",
        storeId: "store-1",
        productId: "product-1",
        productSkuId: "sku-1",
        productSku: "SKU-1",
        productName: "Sneaker",
        price: 10,
        quantity: 1,
        image: undefined,
      },
    ] as never);

    await expect(
      createTransactionFromSessionHandler({} as never, {
        sessionId: "session-1" as Id<"posSession">,
        staffProfileId: "staff-1" as Id<"staffProfile">,
        payments: [{ method: "cash", amount: 10, timestamp: 1 }],
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        kind: "user_error",
        error: expect.objectContaining({
          code: "precondition_failed",
          message: "Open the cash drawer before completing this sale.",
        }),
      }),
    );
  });

  it("fails safely when a session sale is bound to a closed drawer", async () => {
    vi.mocked(getPosSessionById).mockResolvedValue({
      _id: "session-1",
      storeId: "store-1",
      customerId: undefined,
      staffProfileId: "staff-1",
      registerNumber: "1",
      registerSessionId: "register-1",
      subtotal: 10,
      tax: 0,
      total: 10,
      terminalId: "terminal-1",
      customerInfo: undefined,
    } as never);
    vi.mocked(getRegisterSessionById).mockResolvedValue({
      _id: "register-1",
      storeId: "store-1",
      status: "closed",
      terminalId: "terminal-1",
      registerNumber: "1",
    } as never);
    vi.mocked(listSessionItems).mockResolvedValue([
      {
        _id: "session-item-1",
        sessionId: "session-1",
        storeId: "store-1",
        productId: "product-1",
        productSkuId: "sku-1",
        productSku: "SKU-1",
        productName: "Sneaker",
        price: 10,
        quantity: 1,
        image: undefined,
      },
    ] as never);

    await expect(
      createTransactionFromSessionHandler({} as never, {
        sessionId: "session-1" as Id<"posSession">,
        staffProfileId: "staff-1" as Id<"staffProfile">,
        payments: [{ method: "cash", amount: 10, timestamp: 1 }],
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        kind: "user_error",
        error: expect.objectContaining({
          code: "precondition_failed",
          message: "Open the cash drawer before completing this sale.",
        }),
      }),
    );

    expect(createPosTransaction).not.toHaveBeenCalled();
  });

  it("fails safely when a session sale is bound to a closing drawer", async () => {
    const runMutation = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      runMutation,
    } as never;

    vi.mocked(getPosSessionById).mockResolvedValue({
      _id: "session-1",
      storeId: "store-1",
      customerId: undefined,
      staffProfileId: "staff-1",
      registerNumber: "1",
      registerSessionId: "register-1",
      subtotal: 10,
      tax: 0,
      total: 10,
      terminalId: "terminal-1",
      customerInfo: undefined,
    } as never);
    vi.mocked(getRegisterSessionById).mockResolvedValue({
      _id: "register-1",
      storeId: "store-1",
      status: "closing",
      terminalId: "terminal-1",
      registerNumber: "1",
    } as never);
    vi.mocked(listSessionItems).mockResolvedValue([
      {
        _id: "session-item-1",
        sessionId: "session-1",
        storeId: "store-1",
        productId: "product-1",
        productSkuId: "sku-1",
        productSku: "SKU-1",
        productName: "Sneaker",
        price: 10,
        quantity: 1,
        image: undefined,
      },
    ] as never);

    await expect(
      createTransactionFromSessionHandler(ctx, {
        sessionId: "session-1" as Id<"posSession">,
        staffProfileId: "staff-1" as Id<"staffProfile">,
        payments: [{ method: "cash", amount: 10, timestamp: 1 }],
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        kind: "user_error",
        error: expect.objectContaining({
          code: "precondition_failed",
          message: "Open the cash drawer before completing this sale.",
        }),
      }),
    );

    expect(runMutation).not.toHaveBeenCalled();
    expectNoCompletionSideEffects();
  });

  it("fails safely when a session sale drawer belongs to another store", async () => {
    const runMutation = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      runMutation,
    } as never;

    vi.mocked(getPosSessionById).mockResolvedValue({
      _id: "session-1",
      storeId: "store-1",
      customerId: undefined,
      staffProfileId: "staff-1",
      registerNumber: "1",
      registerSessionId: "register-1",
      subtotal: 10,
      tax: 0,
      total: 10,
      terminalId: "terminal-1",
      customerInfo: undefined,
    } as never);
    vi.mocked(getRegisterSessionById).mockResolvedValue({
      _id: "register-1",
      storeId: "store-2",
      status: "open",
      terminalId: "terminal-1",
      registerNumber: "1",
    } as never);
    vi.mocked(listSessionItems).mockResolvedValue([
      {
        _id: "session-item-1",
        sessionId: "session-1",
        storeId: "store-1",
        productId: "product-1",
        productSkuId: "sku-1",
        productSku: "SKU-1",
        productName: "Sneaker",
        price: 10,
        quantity: 1,
        image: undefined,
      },
    ] as never);

    await expect(
      createTransactionFromSessionHandler(ctx, {
        sessionId: "session-1" as Id<"posSession">,
        staffProfileId: "staff-1" as Id<"staffProfile">,
        payments: [{ method: "cash", amount: 10, timestamp: 1 }],
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        kind: "user_error",
        error: expect.objectContaining({
          code: "precondition_failed",
          message: "Open the cash drawer before completing this sale.",
        }),
      }),
    );

    expect(runMutation).not.toHaveBeenCalled();
    expectNoCompletionSideEffects();
  });

  it("fails safely when a provided drawer conflicts with the session drawer", async () => {
    const runMutation = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      runMutation,
    } as never;

    vi.mocked(getPosSessionById).mockResolvedValue({
      _id: "session-1",
      storeId: "store-1",
      customerId: undefined,
      staffProfileId: "staff-1",
      registerNumber: "1",
      registerSessionId: "register-1",
      subtotal: 10,
      tax: 0,
      total: 10,
      terminalId: "terminal-1",
      customerInfo: undefined,
    } as never);
    vi.mocked(listSessionItems).mockResolvedValue([
      {
        _id: "session-item-1",
        sessionId: "session-1",
        storeId: "store-1",
        productId: "product-1",
        productSkuId: "sku-1",
        productSku: "SKU-1",
        productName: "Sneaker",
        price: 10,
        quantity: 1,
        image: undefined,
      },
    ] as never);

    await expect(
      createTransactionFromSessionHandler(ctx, {
        sessionId: "session-1" as Id<"posSession">,
        staffProfileId: "staff-1" as Id<"staffProfile">,
        payments: [{ method: "cash", amount: 10, timestamp: 1 }],
        registerSessionId: "register-2" as Id<"registerSession">,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        kind: "user_error",
        error: expect.objectContaining({
          code: "precondition_failed",
          message: "Open the cash drawer before completing this sale.",
        }),
      }),
    );

    expect(getRegisterSessionById).not.toHaveBeenCalled();
    expect(runMutation).not.toHaveBeenCalled();
    expectNoCompletionSideEffects();
  });

  it("fails safely when a session sale is bound to a mismatched drawer", async () => {
    vi.mocked(getPosSessionById).mockResolvedValue({
      _id: "session-1",
      storeId: "store-1",
      customerId: undefined,
      staffProfileId: "staff-1",
      registerNumber: "1",
      registerSessionId: "register-1",
      subtotal: 10,
      tax: 0,
      total: 10,
      terminalId: "terminal-1",
      customerInfo: undefined,
    } as never);
    vi.mocked(getRegisterSessionById).mockResolvedValue({
      _id: "register-1",
      storeId: "store-1",
      status: "open",
      terminalId: "terminal-9",
      registerNumber: "9",
    } as never);
    vi.mocked(listSessionItems).mockResolvedValue([
      {
        _id: "session-item-1",
        sessionId: "session-1",
        storeId: "store-1",
        productId: "product-1",
        productSkuId: "sku-1",
        productSku: "SKU-1",
        productName: "Sneaker",
        price: 10,
        quantity: 1,
        image: undefined,
      },
    ] as never);

    await expect(
      createTransactionFromSessionHandler({} as never, {
        sessionId: "session-1" as Id<"posSession">,
        staffProfileId: "staff-1" as Id<"staffProfile">,
        payments: [{ method: "cash", amount: 10, timestamp: 1 }],
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        kind: "user_error",
        error: expect.objectContaining({
          code: "precondition_failed",
          message: "Open the cash drawer before completing this sale.",
        }),
      }),
    );

    expect(createPosTransaction).not.toHaveBeenCalled();
  });

  it("does not persist workflowTraceId during direct sale completion", async () => {
    vi.mocked(getStoreById).mockResolvedValue({
      _id: "store-1",
      organizationId: "org-1",
    } as never);
    vi.mocked(getProductSkuById).mockResolvedValue({
      _id: "sku-1",
      images: [],
      inventoryCount: 10,
      productId: "product-1",
      quantityAvailable: 10,
      sku: "SKU-1",
    } as never);
    vi.mocked(createPosTransaction).mockResolvedValue("txn-1" as never);
    vi.mocked(recordRetailSalePaymentAllocations).mockResolvedValue(true);
    vi.mocked(createPosTransactionItem).mockResolvedValue(
      "txn-item-1" as never,
    );
    vi.mocked(patchProductSku).mockResolvedValue(undefined as never);
    vi.mocked(updateCustomerStats).mockResolvedValue(undefined as never);
    vi.mocked(createWorkflowTraceWithCtx).mockResolvedValue("trace-1" as never);
    vi.mocked(registerWorkflowTraceLookupWithCtx).mockResolvedValue(
      "lookup-1" as never,
    );
    vi.mocked(appendWorkflowTraceEventWithCtx).mockResolvedValue(
      "event-1" as never,
    );
    vi.mocked(patchPosTransaction).mockRejectedValue(
      new Error("trace link patch unavailable"),
    );

    await expect(
      completeTransaction({} as never, {
        storeId: "store-1" as Id<"store">,
        items: [
          {
            skuId: "sku-1" as Id<"productSku">,
            quantity: 1,
            price: 10,
            name: "Sneaker",
            sku: "SKU-1",
          },
        ],
        payments: [{ method: "cash", amount: 10, timestamp: 1 }],
        subtotal: 10,
        tax: 0,
        total: 10,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        kind: "ok",
        data: expect.objectContaining({
          transactionId: "txn-1",
        }),
      }),
    );
    expect(patchPosTransaction).not.toHaveBeenCalled();
  });
});
