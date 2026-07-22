import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSharedDemoActorWithCtx: vi.fn(),
  ingestLocalEventsWithCtx: vi.fn(),
  ingestRegisterSessionActivityWithCtx: vi.fn(),
  requireOrganizationMemberRoleWithCtx: vi.fn(),
  requireReadySharedDemoWriteWithCtx: vi.fn(),
  requireSharedDemoStoreCapabilityIfApplicable: vi.fn(),
}));

vi.mock("../../sharedDemo/actor", () => ({
  getSharedDemoActorWithCtx: mocks.getSharedDemoActorWithCtx,
  requireSharedDemoStoreCapabilityIfApplicable:
    mocks.requireSharedDemoStoreCapabilityIfApplicable,
}));
vi.mock("../../sharedDemo/restore", () => ({
  requireReadySharedDemoWriteWithCtx: mocks.requireReadySharedDemoWriteWithCtx,
}));
vi.mock("../application/sync/ingestLocalEvents", () => ({
  ingestLocalEventsWithCtx: mocks.ingestLocalEventsWithCtx,
}));
vi.mock("../application/sync/posRegisterSessionActivity", () => ({
  ingestRegisterSessionActivityWithCtx:
    mocks.ingestRegisterSessionActivityWithCtx,
}));
vi.mock("../../lib/athenaUserAuth", () => ({
  requireAuthenticatedAthenaUserWithCtx: vi.fn(),
  requireOrganizationMemberRoleWithCtx:
    mocks.requireOrganizationMemberRoleWithCtx,
}));

import {
  ingestLocalEvents,
  ingestRegisterSessionActivity,
  sharedDemoCapabilityForSyncEvent,
} from "./sync";

const invoke = (ctx: unknown, args: unknown) =>
  (
    ingestLocalEvents as unknown as {
      _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
    }
  )._handler(ctx, args);

const invokeActivity = (ctx: unknown, args: unknown) =>
  (
    ingestRegisterSessionActivity as unknown as {
      _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
    }
  )._handler(ctx, args);

const baseArgs = {
  events: [],
  expectedDemoEpoch: 4,
  storeId: "store-1",
  syncSecretHash: "secret",
  terminalId: "terminal-1",
};

describe("shared demo POS sync enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSharedDemoActorWithCtx.mockResolvedValue({
      athenaUserId: "user-1",
      kind: "shared_demo",
      storeId: "store-1",
    });
    mocks.requireSharedDemoStoreCapabilityIfApplicable.mockResolvedValue({
      kind: "shared_demo",
      storeId: "store-1",
    });
  });

  it.each([
    ["register_opened", "cash.control.write"],
    ["store_day_started", "daily_operations.write"],
    ["pending_checkout_item_defined", "pos.sale.complete"],
    ["sale_completed", "pos.sale.complete"],
    ["register_closed", "cash.control.write"],
    ["register_reopened", "cash.control.write"],
    ["sale_cleared", "pos.sale.complete"],
    ["expense_recorded", "expense.manage"],
  ] as const)("classifies %s independently", (eventType, capability) => {
    expect(sharedDemoCapabilityForSyncEvent(eventType)).toBe(capability);
  });

  it("rejects a denied event capability before ingestion", async () => {
    mocks.requireSharedDemoStoreCapabilityIfApplicable.mockRejectedValue(
      new Error("This action is unavailable in the demo."),
    );
    const ctx = {
      db: { get: vi.fn().mockResolvedValue({ organizationId: "org-1" }) },
    };

    const result = await invoke(ctx, {
      ...baseArgs,
      events: [{ eventType: "expense_recorded" }],
    });

    expect(result).toMatchObject({
      error: { code: "authorization_failed" },
      kind: "user_error",
    });
    expect(mocks.ingestLocalEventsWithCtx).not.toHaveBeenCalled();
  });

  it("requires the observed restore epoch before projection", async () => {
    const stale = new Error("The demo is being restored. Try again shortly.");
    mocks.requireReadySharedDemoWriteWithCtx.mockRejectedValue(stale);
    const ctx = {
      db: { get: vi.fn().mockResolvedValue({ organizationId: "org-1" }) },
    };

    await expect(
      invoke(ctx, {
        ...baseArgs,
        events: [{ eventType: "sale_completed" }],
      }),
    ).rejects.toThrow("This action isn't allowed in the demo.");
    expect(mocks.requireReadySharedDemoWriteWithCtx).toHaveBeenCalledWith(expect.objectContaining({
      db: ctx.db,
    }), {
      expectedEpoch: 4,
      storeId: "store-1",
    });
    expect(mocks.ingestLocalEventsWithCtx).not.toHaveBeenCalled();
  });

  it("requires the observed restore epoch before register activity ingestion", async () => {
    mocks.requireReadySharedDemoWriteWithCtx.mockRejectedValue(
      new Error("The demo is being restored. Try again shortly."),
    );
    const ctx = {
      db: {
        get: vi
          .fn()
          .mockResolvedValueOnce({ organizationId: "org-1" })
          .mockResolvedValueOnce({ _id: "user-1" }),
      },
    };

    await expect(
      invokeActivity(ctx, {
        activities: [],
        expectedDemoEpoch: 4,
        localRegisterSessionId: "register-1",
        reportedThroughSequence: 0,
        storeId: "store-1",
        syncSecretHash: "secret",
        terminalId: "terminal-1",
      }),
    ).rejects.toThrow("This action isn't allowed in the demo.");
    expect(mocks.requireReadySharedDemoWriteWithCtx).toHaveBeenCalledWith(expect.objectContaining({
      db: ctx.db,
    }), {
      expectedEpoch: 4,
      storeId: "store-1",
    });
    expect(mocks.ingestRegisterSessionActivityWithCtx).not.toHaveBeenCalled();
  });
});
