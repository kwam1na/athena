import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import * as reportingAccess from "../reporting/access";
import { getWorkspaceSummary } from "./analytics";

vi.mock("../reporting/access", () => ({
  requireReportingStoreAccess: vi.fn(),
}));

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
    db: {
      get: vi.fn(async () => null),
      query: vi.fn(() => queryChain),
    },
  };
}

describe("storefront Analytics workspace authorization", () => {
  beforeEach(() => vi.clearAllMocks());

  it("denies before reading analytics when backend store access fails", async () => {
    vi.mocked(reportingAccess.requireReportingStoreAccess).mockRejectedValue(
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
    vi.mocked(reportingAccess.requireReportingStoreAccess).mockResolvedValue({
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
    expect(reportingAccess.requireReportingStoreAccess).toHaveBeenCalledWith(
      ctx,
      "store-1",
    );
  });
});
