import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSharedDemoActorWithCtx: vi.fn(),
  ingestLocalEventsWithCtx: vi.fn(),
  ingestRegisterSessionActivityWithCtx: vi.fn(),
  requireAuthenticatedAthenaUserWithCtx: vi.fn(),
  requireOrganizationMemberRoleWithCtx: vi.fn(),
  requireReadySharedDemoWriteWithCtx: vi.fn(),
  requireSharedDemoCapability: vi.fn(),
  requireSharedDemoStoreCapabilityIfApplicable: vi.fn(),
}));

// Only the capability gate is replaced; the rest of the demo policy (the
// denial error the adapter raises, the gateway classification) stays real, so
// this exercises the actual denial path rather than a stubbed one.
vi.mock("../../sharedDemo/policy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../sharedDemo/policy")>()),
  requireSharedDemoCapability: mocks.requireSharedDemoCapability,
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
    mocks.requireSharedDemoCapability.mockReturnValue(undefined);
    mocks.requireAuthenticatedAthenaUserWithCtx.mockResolvedValue({
      _id: "user-1",
    });
    mocks.requireOrganizationMemberRoleWithCtx.mockResolvedValue(undefined);
  });

  it("denies a mixed batch whole when one event capability is ungranted", async () => {
    // All-of semantics: a batch that mixes a granted and an ungranted
    // capability requires both, so the WHOLE call is denied before any write
    // rather than partially applied — and the denial reaches the client in the
    // module's `CommandResult` shape, not as a thrown mutation.
    mocks.requireSharedDemoCapability.mockImplementation(
      (capability: string) => {
        if (capability === "expense.manage") {
          throw new Error("shared_demo_action_denied");
        }
      },
    );
    const ctx = {
      db: { get: vi.fn().mockResolvedValue({ organizationId: "org-1" }) },
    };

    const result = await invoke(ctx, {
      ...baseArgs,
      events: [
        { eventType: "sale_completed" },
        { eventType: "expense_recorded" },
      ],
    });

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "authorization_failed",
        message: "You do not have access to sync this POS terminal.",
      },
    });
    expect(mocks.ingestLocalEventsWithCtx).not.toHaveBeenCalled();
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

    // The rail denies before the handler runs, and the sync boundary
    // normalizes that denial to the module's `CommandResult` shape rather
    // than throwing: the terminal scheduler retries a throw forever.
    await expect(
      invoke(ctx, {
        ...baseArgs,
        events: [{ eventType: "sale_completed" }],
      }),
    ).resolves.toMatchObject({
      error: { code: "authorization_failed" },
      kind: "user_error",
    });
    expect(mocks.requireReadySharedDemoWriteWithCtx).toHaveBeenCalledWith(
      expect.objectContaining({
        db: ctx.db,
      }),
      {
        expectedEpoch: 4,
        storeId: "store-1",
      },
    );
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
    expect(mocks.requireReadySharedDemoWriteWithCtx).toHaveBeenCalledWith(
      expect.objectContaining({
        db: ctx.db,
      }),
      {
        expectedEpoch: 4,
        storeId: "store-1",
      },
    );
    expect(mocks.ingestRegisterSessionActivityWithCtx).not.toHaveBeenCalled();
  });
});
