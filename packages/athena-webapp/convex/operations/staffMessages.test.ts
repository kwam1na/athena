import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/athenaUserAuth", () => ({
  requireAuthenticatedAthenaUserWithCtx: vi.fn(),
  requireOrganizationMemberRoleWithCtx: vi.fn(),
}));
vi.mock("../sharedDemo/actor", () => ({
  requireSharedDemoStoreCapabilityIfApplicable: vi.fn(),
}));
vi.mock("../sharedDemo/restore", () => ({
  requireReadySharedDemoWriteWithCtx: vi.fn(),
}));

import {
  requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx,
} from "../lib/athenaUserAuth";
import { requireSharedDemoStoreCapabilityIfApplicable } from "../sharedDemo/actor";
import { requireReadySharedDemoWriteWithCtx } from "../sharedDemo/restore";
import {
  listStaffMessages,
  postStaffMessage,
  STAFF_MESSAGE_MAX_LENGTH,
} from "./staffMessages";

const invoke = (fn: unknown, ctx: unknown, args: unknown) =>
  (fn as any)._handler(ctx, args);

function context(recent: unknown[] = []) {
  const take = vi.fn().mockResolvedValue(recent);
  const insert = vi.fn().mockResolvedValue("message-1");
  const get = vi.fn(async (tableOrId: string, id?: string) =>
    tableOrId === "store" && id === "store-1"
      ? { _id: "store-1", organizationId: "org-1" }
      : { _id: id ?? tableOrId },
  );
  return {
    db: {
      get,
      insert,
      query: vi.fn(() => ({
        withIndex: vi.fn((_index, apply) => {
          const q: any = { eq: vi.fn(), gte: vi.fn() };
          q.eq.mockReturnValue(q);
          q.gte.mockReturnValue(q);
          apply(q);
          return { order: vi.fn(() => ({ take })), take };
        }),
      })),
    },
  };
}

describe("staff messages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuthenticatedAthenaUserWithCtx).mockResolvedValue({ _id: "user-1" } as never);
    vi.mocked(requireOrganizationMemberRoleWithCtx).mockResolvedValue({} as never);
    vi.mocked(requireSharedDemoStoreCapabilityIfApplicable).mockResolvedValue(null);
  });

  it("allows a normal member to post a bounded internal message", async () => {
    const ctx = context();
    await invoke(postStaffMessage, ctx, { body: "  Stock count is complete.  ", storeId: "store-1" });
    expect(ctx.db.insert).toHaveBeenCalledWith("staffMessage", expect.objectContaining({
      organizationId: "org-1", storeId: "store-1", authorUserId: "user-1", body: "Stock count is complete.",
    }));
  });

  it("requires the current restore epoch for demo writes", async () => {
    vi.mocked(requireSharedDemoStoreCapabilityIfApplicable).mockResolvedValue({ kind: "shared_demo" } as never);
    const ctx = context();
    await expect(invoke(postStaffMessage, ctx, { body: "Opening complete", storeId: "store-1" })).rejects.toThrow("Refresh the demo");
    await invoke(postStaffMessage, ctx, { body: "Opening complete", expectedDemoRestoreEpoch: 7, storeId: "store-1" });
    expect(requireReadySharedDemoWriteWithCtx).toHaveBeenCalledWith(ctx, { expectedEpoch: 7, storeId: "store-1" });
  });

  it("rejects cross-store membership before reading or writing messages", async () => {
    vi.mocked(requireOrganizationMemberRoleWithCtx).mockRejectedValue(new Error("You do not have access to staff messages."));
    const ctx = context();
    await expect(invoke(listStaffMessages, ctx, { storeId: "store-1" })).rejects.toThrow("You do not have access");
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it.each(["", " ", "x".repeat(STAFF_MESSAGE_MAX_LENGTH + 1)])("rejects invalid bounded input", async (body) => {
    await expect(invoke(postStaffMessage, context(), { body, storeId: "store-1" })).rejects.toThrow("between 1 and 500");
  });

  it("rate limits an author within the same store", async () => {
    await expect(invoke(postStaffMessage, context([1, 2, 3, 4, 5]), { body: "Another update", storeId: "store-1" })).rejects.toThrow("Wait a moment");
  });
});
