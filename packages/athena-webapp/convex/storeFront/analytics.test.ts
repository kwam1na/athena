import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import * as reportsAccess from "../reports/access";

vi.mock("../reports/access", () => ({
  requireReportsStoreAccess: vi.fn(),
}));

// `getWorkspaceSummary` now runs through the admission rail (U7), so the
// normal-user identity port has to resolve before the handler body runs. The
// assertions below are unchanged: they characterize the SAME handler outcomes.
const authMocks = vi.hoisted(() => ({
  requireAuthenticatedAthenaUserWithCtx: vi.fn(),
}));

vi.mock("../lib/athenaUserAuth", async () => {
  const actual =
    await vi.importActual<typeof import("../lib/athenaUserAuth")>(
      "../lib/athenaUserAuth",
    );
  return {
    ...actual,
    requireAuthenticatedAthenaUserWithCtx:
      authMocks.requireAuthenticatedAthenaUserWithCtx,
  };
});

import { getWorkspaceSummary } from "./analytics";

function handler<TArgs, TResult>(definition: unknown) {
  return (definition as { _handler: (ctx: unknown, args: TArgs) => TResult })
    ._handler;
}

function emptyContext() {
  const queryChain = {
    filter: vi.fn(),
    order: vi.fn(),
    take: vi.fn(async () => []),
    withIndex: vi.fn(),
  };
  queryChain.filter.mockReturnValue(queryChain);
  queryChain.order.mockReturnValue(queryChain);
  queryChain.withIndex.mockReturnValue(queryChain);
  return {
    auth: { getUserIdentity: vi.fn(async () => null) },
    db: {
      get: vi.fn(async () => null),
      normalizeId: vi.fn((_table: string, id: string) => id),
      query: vi.fn(() => queryChain),
    },
  };
}

describe("storefront Analytics workspace authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMocks.requireAuthenticatedAthenaUserWithCtx.mockResolvedValue({
      _id: "athena-user-1",
      email: "admin@example.com",
    } as never);
  });

  it("denies before reading analytics when backend store access fails", async () => {
    vi.mocked(reportsAccess.requireReportsStoreAccess).mockRejectedValue(
      new Error("Reports access unavailable."),
    );
    const ctx = emptyContext();

    await expect(
      handler<
        { storeId: Id<"store">; currentTimeMs: number },
        Promise<unknown>
      >(getWorkspaceSummary)(ctx, {
        storeId: "store-1" as Id<"store">,
        currentTimeMs: 100,
      }),
    ).rejects.toThrow("Reports access unavailable.");
    expect(ctx.db.query).not.toHaveBeenCalled();
  });

  it("preserves the summary response for an authorized full admin", async () => {
    vi.mocked(reportsAccess.requireReportsStoreAccess).mockResolvedValue({
      athenaUser: { _id: "user-1" },
      membership: { role: "full_admin" },
      store: { _id: "store-1", organizationId: "org-1" },
    } as never);
    const ctx = emptyContext();

    await expect(
      handler<
        { storeId: Id<"store">; currentTimeMs: number },
        Promise<unknown>
      >(getWorkspaceSummary)(ctx, {
        storeId: "store-1" as Id<"store">,
        currentTimeMs: 100,
      }),
    ).resolves.toMatchObject({
      overview: {
        activeCheckoutSessions: 0,
        knownShoppers: 0,
        productViews: 0,
        visitorsToday: 0,
      },
      recentEvents: [],
      topProducts: [],
      topUsers: [],
    });
    expect(reportsAccess.requireReportsStoreAccess).toHaveBeenCalledWith(
      ctx,
      "store-1",
    );
  });
});
