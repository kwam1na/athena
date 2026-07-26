import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSharedDemoActorWithCtx: vi.fn(),
  hashPosTerminalSyncSecret: vi.fn(),
  ingestLocalEventsWithCtx: vi.fn(),
  ingestRegisterSessionActivityWithCtx: vi.fn(),
  requireAuthenticatedAthenaUserWithCtx: vi.fn(),
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
  requireAuthenticatedAthenaUserWithCtx:
    mocks.requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx:
    mocks.requireOrganizationMemberRoleWithCtx,
}));
vi.mock("../application/sync/terminalSyncSecret", () => ({
  hashPosTerminalSyncSecret: mocks.hashPosTerminalSyncSecret,
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
const originalStage = process.env.STAGE;

describe("shared demo POS sync enforcement", () => {
  afterEach(() => {
    process.env.STAGE = originalStage;
  });

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
    mocks.requireAuthenticatedAthenaUserWithCtx.mockResolvedValue({
      _id: "user-1",
    });
    mocks.hashPosTerminalSyncSecret.mockResolvedValue("hashed-secret");
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

  it("persists an admitted shared-demo closeout without scheduling live notifications", async () => {
    process.env.STAGE = "prod";
    mocks.ingestLocalEventsWithCtx.mockResolvedValue({
      kind: "ok",
      data: {
        accepted: [],
        held: [],
        mappings: [
          {
            cloudId: "register-session-1",
            cloudTable: "registerSession",
            localEventId: "event-closeout-1",
            localIdKind: "closeout",
          },
        ],
        conflicts: [],
        syncCursor: {
          localRegisterSessionId: "local-register-1",
          acceptedThroughSequence: 1,
        },
      },
    });
    const ctx = {
      db: {
        get: vi.fn(async (table: string, id: string) => {
          if (table === "store" && id === "store-1") {
            return { organizationId: "org-1" };
          }
          if (table === "posTerminal" && id === "terminal-1") {
            return {
              status: "active",
              storeId: "store-1",
              syncSecretHash: "hashed-secret",
            };
          }
          return null;
        }),
        query: vi.fn(),
      },
      scheduler: { runAfter: vi.fn() },
    };

    const result = await invoke(ctx, {
      ...baseArgs,
      events: [
        {
          eventType: "register_closed",
          localEventId: "event-closeout-1",
          localRegisterSessionId: "local-register-1",
          occurredAt: 123,
          payload: { countedCash: 100 },
          sequence: 1,
          staffProfileId: "staff-1",
        },
      ],
    });

    expect(result, JSON.stringify(result)).toMatchObject({ kind: "ok" });
    expect(mocks.ingestLocalEventsWithCtx).toHaveBeenCalledOnce();
    expect(ctx.db.query).not.toHaveBeenCalled();
    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
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
