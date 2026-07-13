import { describe, expect, it, vi } from "vitest";

import { assertConformsToExportedReturns } from "../lib/returnValidatorContract";
import {
  consumeAdmissionBudgetWithCtx,
  consumeSharedDemoTicketWithCtx,
  issueSharedDemoTicket,
} from "./admission";

describe("shared demo admission return contract", () => {
  it("accepts the short-lived opaque ticket result", () => {
    assertConformsToExportedReturns(issueSharedDemoTicket, {
      ticket: "opaque-ticket",
      expiresAt: 20_000,
    });
  });
});

function contextWith(ticket: Record<string, unknown> | null) {
  const patch = vi.fn();
  const unique = vi.fn().mockResolvedValue(ticket);
  return {
    ctx: {
      db: {
        get: vi.fn(),
        insert: vi.fn(),
        patch,
        replace: vi.fn(),
        query: vi.fn((table) => ({
          withIndex: vi.fn((_name, apply) => {
            apply({ eq: vi.fn().mockReturnThis() });
            return { unique: table === "sharedDemoAdmissionRateBucket" ? vi.fn().mockResolvedValue(null) : unique };
          }),
        })),
      },
    } as never,
    patch,
  };
}

describe("shared demo ticket consumption", () => {
  it("atomically consumes an active ticket and activates the demo principal", async () => {
    const { ctx, patch } = contextWith({
      _id: "ticket-1",
      authUserId: "user-1",
      consumedAt: undefined,
      expiresAt: 20_000,
      principalId: "principal-1",
    });

    await expect(
      consumeSharedDemoTicketWithCtx(ctx, { now: 10_000, ticketHash: "hash" }),
    ).resolves.toEqual({ authUserId: "user-1" });
    expect(patch).toHaveBeenNthCalledWith(1, "sharedDemoAdmissionTicket", "ticket-1", {
      consumedAt: 10_000,
    });
    expect(patch).toHaveBeenNthCalledWith(2, "sharedDemoPrincipal", "principal-1", {
      admissionExpiresAt: 3_610_000,
      updatedAt: 10_000,
    });
  });

  it.each([
    ["missing", null],
    ["consumed", { consumedAt: 9_000, expiresAt: 20_000 }],
    ["expired", { consumedAt: undefined, expiresAt: 9_999 }],
  ])("rejects a %s ticket without changing state", async (_label, ticket) => {
    const { ctx, patch } = contextWith(ticket);
    await expect(
      consumeSharedDemoTicketWithCtx(ctx, { now: 10_000, ticketHash: "hash" }),
    ).rejects.toThrow("Demo sign-in link is no longer valid");
    expect(patch).not.toHaveBeenCalled();
  });
});

describe("shared demo admission budget", () => {
  it("rejects a request after the transactional window limit", async () => {
    const patch = vi.fn();
    const ctx = {
      db: {
        patch,
        query: vi.fn(() => ({ withIndex: vi.fn(() => ({ unique: vi.fn().mockResolvedValue({ _id: "bucket", count: 2, windowStartedAt: 9_000 }) })) })),
      },
    } as never;
    await expect(consumeAdmissionBudgetWithCtx(ctx, { kind: "mint", limit: 2, now: 10_000 })).rejects.toThrow("shared demo is busy");
    expect(patch).not.toHaveBeenCalled();
  });
});
