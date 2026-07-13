import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./actor", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./actor")>();
  return {
    ...actual,
    requireSharedDemoCapabilityIfApplicable: vi.fn(),
    requireSharedDemoStoreCapabilityIfApplicable: vi.fn(),
  };
});
vi.mock("./restore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./restore")>();
  return { ...actual, requireReadySharedDemoWriteWithCtx: vi.fn() };
});

import {
  requireSharedDemoCapabilityIfApplicable,
  requireSharedDemoStoreCapabilityIfApplicable,
} from "./actor";
import { requireReadySharedDemoWriteWithCtx } from "./restore";
import { create as createInvite } from "../inventory/inviteCode";
import {
  patchConfigV2Command,
  remove as removeStore,
} from "../inventory/stores";
import { createStaffCredential } from "../operations/staffCredentials";
import { requestExport } from "../reporting/export";
import { processReturnExchange } from "../storeFront/onlineOrder";
import { update as updateOrder } from "../storeFront/onlineOrder";
import { createTransaction, refundPayment } from "../storeFront/payment";
import { completeTransaction } from "../pos/public/transactions";
import { submitStockAdjustmentBatch } from "../stockOps/adjustments";
import { recordRegisterSessionDeposit } from "../cashControls/deposits";
import { postStaffMessage } from "../operations/staffMessages";
import { startStoreDay } from "../operations/dailyOpening";

const invoke = (fn: unknown, ctx: unknown, args: unknown) =>
  (fn as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> })._handler(
    ctx,
    args,
  );

describe("actual public shared-demo enforcement boundaries", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    [createStaffCredential, "identity.manage", {}],
    [createInvite, "permissions.manage", {}],
    [requestExport, "exports.generate", { storeId: "store" }],
    [processReturnExchange, "payments.refund", {}],
    [removeStore, "administration.destructive", { id: "store" }],
    [patchConfigV2Command, "integrations.manage", { id: "store", patch: {} }],
  ] as const)("denies a representative actual function before its write", async (fn, capability, args) => {
    vi.mocked(requireSharedDemoCapabilityIfApplicable).mockRejectedValueOnce(
      new Error("This action is unavailable in the shared demo."),
    );
    const ctx = { db: { delete: vi.fn(), insert: vi.fn(), patch: vi.fn() } };

    await expect(invoke(fn, ctx, args)).rejects.toThrow(
      "This action is unavailable in the shared demo.",
    );
    expect(requireSharedDemoCapabilityIfApplicable).toHaveBeenCalledWith(
      ctx,
      capability,
    );
    expect(ctx.db.delete).not.toHaveBeenCalled();
    expect(ctx.db.insert).not.toHaveBeenCalled();
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it.each([
    [createTransaction, "billing.manage"],
    [refundPayment, "payments.refund"],
  ] as const)("denies an actual payment action before provider or mutation work", async (fn, capability) => {
    const denial = new Error("This action is unavailable in the shared demo.");
    const ctx = {
      runMutation: vi.fn(),
      runQuery: vi.fn().mockRejectedValue(denial),
    };
    await expect(invoke(fn, ctx, {})).rejects.toThrow(denial.message);
    expect(ctx.runQuery).toHaveBeenCalledWith(expect.anything(), { capability });
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it("preserves the existing normal store-removal behavior", async () => {
    vi.mocked(requireSharedDemoCapabilityIfApplicable).mockResolvedValueOnce(null);
    const ctx = { db: { delete: vi.fn() } };
    await expect(invoke(removeStore, ctx, { id: "store" })).resolves.toEqual({
      message: "OK",
    });
    expect(ctx.db.delete).toHaveBeenCalledWith("store", "store");
  });

  it.each([
    [completeTransaction, "pos.sale.complete", { storeId: "store" }],
    [submitStockAdjustmentBatch, "inventory.adjust", { storeId: "store" }],
    [recordRegisterSessionDeposit, "cash.control.write", { storeId: "store" }],
    [postStaffMessage, "staff.communication.write", { body: "Store update", storeId: "store" }],
    [startStoreDay, "daily_operations.write", { storeId: "store" }],
  ] as const)("routes each store-scoped workflow through the central clamp", async (fn, capability, args) => {
    const sentinel = new Error("boundary reached");
    vi.mocked(requireSharedDemoStoreCapabilityIfApplicable).mockRejectedValueOnce(sentinel);
    const ctx = { db: {} };
    await expect(invoke(fn, ctx, args)).rejects.toThrow(sentinel.message);
    expect(requireSharedDemoStoreCapabilityIfApplicable).toHaveBeenCalledWith(
      ctx,
      capability,
      "store",
    );
  });

  it("routes fulfillment through its loaded-order store clamp", async () => {
    const sentinel = new Error("boundary reached");
    vi.mocked(requireSharedDemoCapabilityIfApplicable).mockRejectedValueOnce(sentinel);
    const ctx = { db: {} };
    await expect(invoke(updateOrder, ctx, {})).rejects.toThrow(sentinel.message);
    expect(requireSharedDemoCapabilityIfApplicable).toHaveBeenCalledWith(ctx, "orders.fulfill");
  });

  it.each([
    [completeTransaction, { storeId: "store" }, "store"],
    [submitStockAdjustmentBatch, { storeId: "store" }, "store"],
    [recordRegisterSessionDeposit, { storeId: "store" }, "store"],
    [startStoreDay, { storeId: "store" }, "store"],
  ] as const)("fences a demo workflow before its business write", async (fn, args, storeId) => {
    vi.mocked(requireSharedDemoStoreCapabilityIfApplicable).mockResolvedValueOnce({
      kind: "shared_demo",
      storeId: "demo-store",
    } as never);
    const sentinel = new Error("restore fence reached");
    vi.mocked(requireReadySharedDemoWriteWithCtx).mockRejectedValueOnce(sentinel);
    const ctx = { db: { get: vi.fn(), insert: vi.fn(), patch: vi.fn() } };

    await expect(invoke(fn, ctx, args)).rejects.toThrow(sentinel.message);
    expect(requireReadySharedDemoWriteWithCtx).toHaveBeenCalledWith(ctx, {
      storeId,
    });
    expect(ctx.db.get).not.toHaveBeenCalled();
    expect(ctx.db.insert).not.toHaveBeenCalled();
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it("fences fulfillment against the principal store before loading the order", async () => {
    vi.mocked(requireSharedDemoCapabilityIfApplicable).mockResolvedValueOnce({
      kind: "shared_demo",
      storeId: "demo-store",
    } as never);
    const sentinel = new Error("restore fence reached");
    vi.mocked(requireReadySharedDemoWriteWithCtx).mockRejectedValueOnce(sentinel);
    const ctx = { db: { get: vi.fn(), insert: vi.fn(), patch: vi.fn() } };
    await expect(invoke(updateOrder, ctx, { update: { status: "delivered" } })).rejects.toThrow(sentinel.message);
    expect(requireReadySharedDemoWriteWithCtx).toHaveBeenCalledWith(ctx, {
      storeId: "demo-store",
    });
    expect(ctx.db.get).not.toHaveBeenCalled();
  });
});
