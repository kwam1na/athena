import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../_generated/dataModel";
import { buildPosSaleTraceSeed } from "../../workflowTraces/adapters/posSale";
import {
  appendWorkflowTraceEventWithCtx,
  createWorkflowTraceWithCtx,
  registerWorkflowTraceLookupWithCtx,
} from "../../workflowTraces/core";
import {
  completeTransaction,
  createTransactionFromSessionHandler,
  buildCompleteTransactionResult,
  recordPosSaleTraceBestEffort,
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

describe("recordPosSaleTraceBestEffort", () => {
  it("uses the seed startedAt for bootstrap ordering", async () => {
    const traceSeed = buildPosSaleTraceSeed({
      storeId: "store-1" as Id<"store">,
      organizationId: "org-1" as Id<"organization">,
      startedAt: 111,
      transactionNumber: "POS-TXN-001",
      posTransactionId: "txn-1" as Id<"posTransaction">,
      registerSessionId: "register-1" as Id<"registerSession">,
      staffProfileId: "staff-1" as Id<"staffProfile">,
      terminalId: "terminal-1" as Id<"posTerminal">,
      customerId: "customer-1" as Id<"posCustomer">,
    });

    vi.mocked(createWorkflowTraceWithCtx).mockResolvedValue("trace-1" as never);
    vi.mocked(registerWorkflowTraceLookupWithCtx).mockResolvedValue(
      "lookup-1" as never,
    );
    vi.mocked(appendWorkflowTraceEventWithCtx).mockResolvedValue(
      "event-1" as never,
    );

    await recordPosSaleTraceBestEffort({} as never, {
      stage: "bootstrap",
      traceSeed,
      transactionId: "txn-1" as Id<"posTransaction">,
    });

    expect(createWorkflowTraceWithCtx).toHaveBeenCalledTimes(1);
    expect(createWorkflowTraceWithCtx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        startedAt: 111,
        status: "started",
      }),
    );
    expect(appendWorkflowTraceEventWithCtx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        occurredAt: 111,
        step: "sale_completion_started",
      }),
    );
  });

  it("writes a finalized trace record after the sale has actually finished", async () => {
    const traceSeed = buildPosSaleTraceSeed({
      storeId: "store-1" as Id<"store">,
      organizationId: "org-1" as Id<"organization">,
      startedAt: 111,
      transactionNumber: "POS-TXN-001",
      posTransactionId: "txn-1" as Id<"posTransaction">,
      registerSessionId: "register-1" as Id<"registerSession">,
      staffProfileId: "staff-1" as Id<"staffProfile">,
      terminalId: "terminal-1" as Id<"posTerminal">,
      customerId: "customer-1" as Id<"posCustomer">,
    });

    vi.mocked(createWorkflowTraceWithCtx).mockResolvedValue("trace-1" as never);
    vi.mocked(registerWorkflowTraceLookupWithCtx).mockResolvedValue(
      "lookup-1" as never,
    );
    vi.mocked(appendWorkflowTraceEventWithCtx).mockResolvedValue(
      "event-1" as never,
    );

    const result = await recordPosSaleTraceBestEffort({} as never, {
      stage: "finalized",
      traceSeed,
      transactionId: "txn-1" as Id<"posTransaction">,
      completedAt: 222,
    });

    expect(result).toEqual({
      traceCreated: true,
      traceId: traceSeed.trace.traceId,
    });
    expect(createWorkflowTraceWithCtx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        startedAt: 111,
        status: "succeeded",
        completedAt: 222,
      }),
    );
    expect(appendWorkflowTraceEventWithCtx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        occurredAt: 222,
        step: "sale_completion_completed",
        status: "succeeded",
      }),
    );
  });

  it("reports traceCreated false when the trace row write fails", async () => {
    const traceSeed = buildPosSaleTraceSeed({
      storeId: "store-1" as Id<"store">,
      transactionNumber: "POS-TXN-001",
      posTransactionId: "txn-1" as Id<"posTransaction">,
    });

    vi.mocked(createWorkflowTraceWithCtx).mockRejectedValue(
      new Error("trace unavailable"),
    );
    vi.mocked(registerWorkflowTraceLookupWithCtx).mockResolvedValue(
      "lookup-1" as never,
    );
    vi.mocked(appendWorkflowTraceEventWithCtx).mockResolvedValue(
      "event-1" as never,
    );

    const result = await recordPosSaleTraceBestEffort({} as never, {
      stage: "bootstrap",
      traceSeed,
      transactionId: "txn-1" as Id<"posTransaction">,
    });

    expect(result).toEqual({
      traceCreated: false,
      traceId: traceSeed.trace.traceId,
    });
  });
});

describe("completeTransaction trace ordering", () => {
  it("does not write a successful direct-sale trace before customer stats and item work complete", async () => {
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
        customerId: "customer-1" as Id<"posCustomer">,
      }),
    ).rejects.toThrow("customer stats unavailable");

    expect(traceEvents).toEqual([
      "trace:create:started",
      "trace:lookup",
      "trace:event:sale_completion_started",
    ]);
    expect(traceEvents).not.toContain("trace:create:succeeded");
    expect(patchPosTransaction).toHaveBeenCalledWith(
      expect.anything(),
      "txn-1",
      expect.objectContaining({
        workflowTraceId: expect.stringMatching(/^pos_sale:/),
      }),
    );
  });

  it("does not write a successful session-sale trace before the session is fully patched", async () => {
    const ctx = {
      runMutation: vi.fn().mockResolvedValue(undefined),
    } as never;

    vi.mocked(getStoreById).mockResolvedValue({
      _id: "store-1",
      organizationId: "org-1",
    } as never);
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
        payments: [{ method: "cash", amount: 10, timestamp: 1 }],
      }),
    ).rejects.toThrow("session patch unavailable");

    expect(traceEvents).toEqual([
      "trace:create:started",
      "trace:lookup",
      "trace:event:sale_completion_started",
    ]);
    expect(traceEvents).not.toContain("trace:create:succeeded");
    expect(patchPosTransaction).toHaveBeenCalledWith(
      expect.anything(),
      "txn-1",
      expect.objectContaining({
        workflowTraceId: expect.stringMatching(/^pos_sale:/),
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

  it("does not fail direct sale completion when workflowTraceId persistence fails", async () => {
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
  });
});
