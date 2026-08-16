import { beforeEach, describe, expect, it, vi } from "vitest";

// Loaded first on purpose. `convex/inventory/storeSchedule.ts` calls
// `admitPublicQuery` at module scope and sits inside an import cycle with the
// composition root; entering that cycle from this suite (which fakes
// `sharedDemo/actor`, so the real module never warms the chain) would evaluate
// it before the root's exports exist. Importing it first breaks the cycle at a
// safe point and can be dropped once that module no longer closes the loop.
import "../inventory/storeSchedule";
import type { Id } from "../_generated/dataModel";
import * as sharedDemoActor from "../sharedDemo/actor";
import {
  getReceiptByShareToken,
  getReceiptByShareTokenInternal,
  sendPosReceiptLink,
  toPublicReceiptTransaction,
} from "./public";
import { resolveReceiptShareToken } from "./repository";
import { getTransactionById } from "../pos/application/queries/getTransactions";

vi.mock("./repository", () => ({
  resolveReceiptShareToken: vi.fn(),
}));

vi.mock("../pos/application/queries/getTransactions", () => ({
  getTransactionById: vi.fn(),
}));

vi.mock("../sharedDemo/actor", () => ({
  SharedDemoActorError: class SharedDemoActorError extends Error {},
  getSharedDemoActorWithCtx: vi.fn(async () => null),
  isSharedDemoActorError: () => false,
  requireReadySharedDemoStoreCapabilityIfApplicable: vi.fn(),
  requireSharedDemoActorWithCtx: vi.fn(),
  requireSharedDemoCapabilityIfApplicable: vi.fn(),
  requireSharedDemoStoreCapabilityIfApplicable: vi.fn(),
}));

function getHandler(fn: unknown) {
  return (fn as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> })
    ._handler;
}

const RECEIPT_TRANSACTION = {
  transactionNumber: "POS-9",
  subtotal: 100,
  tax: 0,
  total: 100,
  registerNumber: "R1",
  paymentMethod: "cash",
  payments: [],
  totalPaid: 100,
  changeGiven: 0,
  status: "completed",
  completedAt: 1,
  cashier: { _id: "staff_1", name: "Ada" },
  notes: "operator note",
  items: [],
};

beforeEach(() => {
  vi.mocked(sharedDemoActor.getSharedDemoActorWithCtx).mockResolvedValue(null);
  vi.mocked(resolveReceiptShareToken).mockReset();
  vi.mocked(getTransactionById).mockReset();
});

describe("customer messaging receipt share admission", () => {
  it("still resolves a share link for an anonymous holder of the token", async () => {
    vi.mocked(resolveReceiptShareToken).mockResolvedValue({
      transactionId: "txn_1",
    } as never);
    vi.mocked(getTransactionById).mockResolvedValue(
      RECEIPT_TRANSACTION as never,
    );

    const receipt = await getHandler(getReceiptByShareToken)(
      { auth: { getUserIdentity: async () => null }, db: {} },
      { token: "share-token" },
    );

    expect(receipt).toEqual(
      expect.objectContaining({ transactionNumber: "POS-9" }),
    );
    expect(receipt).not.toHaveProperty("notes");
  });

  it("returns null for an unknown token without reading a transaction", async () => {
    vi.mocked(resolveReceiptShareToken).mockResolvedValue(null as never);

    await expect(
      getHandler(getReceiptByShareToken)(
        { auth: { getUserIdentity: async () => null }, db: {} },
        { token: "unknown" },
      ),
    ).resolves.toBeNull();
    expect(getTransactionById).not.toHaveBeenCalled();
  });

  it("gives the internal sibling identical behaviour to the public query", async () => {
    vi.mocked(resolveReceiptShareToken).mockResolvedValue({
      transactionId: "txn_1",
    } as never);
    vi.mocked(getTransactionById).mockResolvedValue(
      RECEIPT_TRANSACTION as never,
    );
    const ctx = { auth: { getUserIdentity: async () => null }, db: {} };

    await expect(
      getHandler(getReceiptByShareTokenInternal)(ctx, { token: "share-token" }),
    ).resolves.toEqual(
      await getHandler(getReceiptByShareToken)(ctx, { token: "share-token" }),
    );
  });

  it("denies a shared-demo visitor the receipt share read", async () => {
    vi.mocked(sharedDemoActor.getSharedDemoActorWithCtx).mockResolvedValue({
      athenaUserId: "demo-owner" as Id<"athenaUser">,
      authUserId: "auth-demo" as Id<"users">,
      kind: "shared_demo",
      organizationId: "org-1" as Id<"organization">,
      storeId: "store-1" as Id<"store">,
    });

    await expect(
      getHandler(getReceiptByShareToken)(
        { auth: { getUserIdentity: vi.fn() }, db: {} },
        { token: "share-token" },
      ),
    ).rejects.toThrow("This action isn't allowed in the demo.");
    expect(resolveReceiptShareToken).not.toHaveBeenCalled();
  });
});

describe("customer messaging receipt send admission", () => {
  it("admits the send through the rail before any messaging context is read", async () => {
    const runMutation = vi.fn(async () => ({
      actor: { kind: "normal_user", athenaUserId: "user-1" },
      constraints: {},
      decision: { adapter: "normal_user", outcome: "admitted" },
      operationId: "customerMessaging/public.sendPosReceiptLink",
      provenance: { kind: "normal_user" },
    }));
    const runQuery = vi.fn(async () => null);

    const result = await getHandler(sendPosReceiptLink)(
      { runMutation, runQuery },
      { transactionId: "txn_1" },
    );

    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        operationId: "customerMessaging/public.sendPosReceiptLink",
        operationArgs: { transactionId: "txn_1" },
      }),
    );
    expect(runQuery).toHaveBeenCalled();
    expect(result).toMatchObject({
      kind: "user_error",
      error: { code: "not_found" },
    });
  });

  it("stops a denied send before it can reach the messaging context", async () => {
    const runQuery = vi.fn();
    const runMutation = vi.fn(async () => {
      throw new Error("This action isn't allowed in the demo.");
    });

    await expect(
      getHandler(sendPosReceiptLink)(
        { runMutation, runQuery },
        { transactionId: "txn_1" },
      ),
    ).rejects.toThrow("This action isn't allowed in the demo.");
    expect(runQuery).not.toHaveBeenCalled();
  });
});

describe("customer messaging public receipt payload", () => {
  it("omits operator-only transaction fields from customer receipt responses", () => {
    const receipt = toPublicReceiptTransaction({
      _id: "txn_1",
      transactionNumber: "POS-1",
      subtotal: 100,
      tax: 10,
      total: 110,
      hasTrace: true,
      sessionTraceId: "trace_1",
      registerNumber: "R1",
      registerSessionId: "register_session_1",
      paymentMethod: "cash",
      payments: [{ method: "cash", amount: 110, timestamp: 1 }],
      totalPaid: 110,
      changeGiven: 0,
      status: "completed",
      completedAt: 1,
      notes: "operator note",
      cashier: {
        _id: "staff_1",
        firstName: "Ada",
        lastName: "Lovelace",
        name: "Ada Lovelace",
        email: "ada@example.com",
        phone: "+233555123456",
      },
      customer: {
        _id: "customer_1",
        name: "Customer",
        phone: "+233555000000",
      },
      customerInfo: {
        name: "Customer",
        phone: "+233555000000",
      },
      receiptDeliveryHistory: [
        {
          recipientDisplay: "+********0000",
          status: "sent",
        },
      ],
      correctionHistory: [{ eventType: "correction" }],
      items: [
        {
          _id: "item_1",
          productId: "product_1",
          productSkuId: "sku_1",
          productName: "Product",
          productSku: "SKU-1",
          quantity: 1,
          unitPrice: 110,
          totalPrice: 110,
        },
      ],
    } as any);

    expect(receipt).toEqual(
      expect.objectContaining({
        transactionNumber: "POS-1",
        total: 110,
      }),
    );
    expect(receipt).not.toHaveProperty("_id");
    expect(receipt).not.toHaveProperty("customer");
    expect(receipt).not.toHaveProperty("customerInfo");
    expect(receipt).not.toHaveProperty("notes");
    expect(receipt).not.toHaveProperty("receiptDeliveryHistory");
    expect(receipt).not.toHaveProperty("correctionHistory");
    expect(receipt.items[0]).not.toHaveProperty("_id");
    expect(receipt.items[0]).not.toHaveProperty("productId");
    expect(receipt.items[0]).not.toHaveProperty("productSkuId");
    expect(receipt.cashier).toBeNull();
  });
});
