// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

function wrapDefinition<T extends { handler: (...args: any[]) => any }>(
  definition: T
) {
  return Object.assign(
    (ctx: unknown, args: unknown) => definition.handler(ctx, args),
    definition
  );
}

async function loadModule() {
  vi.resetModules();

  vi.doMock("../_generated/server", () => ({
    query: wrapDefinition,
  }));

  return import("./userOffers");
}

describe("userOffers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T00:00:00.000Z"));
  });

  it("returns eligible when the user is returning, engaged, and has not redeemed", async () => {
    const { getEligibility } = await loadModule();

    const oldTimestamp = Date.now() - 2 * 24 * 60 * 60 * 1000;
    const activities = [
      { _creationTime: oldTimestamp, action: "viewed_product" },
      { _creationTime: oldTimestamp, action: "added_to_cart" },
    ];

    const db = {
      query: vi.fn((table: string) => {
        if (table === "analytics") {
          return {
            withIndex: vi.fn((_, indexCb: (q: any) => any) => {
              const q = {
                eq: vi.fn(),
              };
              indexCb(q);
              return {
              take: vi.fn(async () => activities),
              };
            }),
          };
        }

        if (table === "redeemedPromoCode") {
          return {
            filter: vi.fn((filterCb: (q: any) => any) => {
              const q = {
                and: vi.fn(),
                eq: vi.fn(),
                field: vi.fn((field: string) => field),
              };
              filterCb(q);
              return {
              first: vi.fn(async () => null),
              };
            }),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
      get: vi.fn(async (id: string) => {
        if (id === "store_1") {
          return {
            _id: "store_1",
            config: {
              homepageDiscountCodeModalPromoCode: "promo_1",
            },
          };
        }

        if (id === "promo_1") {
          return {
            _id: "promo_1",
            active: true,
          };
        }

        return null;
      }),
    };

    const result = await getEligibility.handler({ db } as never, {
      storeFrontUserId: "guest_1",
      storeId: "store_1",
    });

    expect(result).toEqual({
      isReturningUser: true,
      isEngaged: true,
      isEligibleForWelcome25: true,
    });
  });

  it("returns not eligible when promo was already redeemed", async () => {
    const { getEligibility } = await loadModule();

    const oldTimestamp = Date.now() - 2 * 24 * 60 * 60 * 1000;
    const activities = [
      { _creationTime: oldTimestamp, action: "viewed_product" },
      { _creationTime: oldTimestamp, action: "added_to_cart" },
    ];

    const db = {
      query: vi.fn((table: string) => {
        if (table === "analytics") {
          return {
            withIndex: vi.fn((_, indexCb: (q: any) => any) => {
              const q = {
                eq: vi.fn(),
              };
              indexCb(q);
              return {
              take: vi.fn(async () => activities),
              };
            }),
          };
        }

        if (table === "redeemedPromoCode") {
          return {
            filter: vi.fn((filterCb: (q: any) => any) => {
              const q = {
                and: vi.fn(),
                eq: vi.fn(),
                field: vi.fn((field: string) => field),
              };
              filterCb(q);
              return {
              first: vi.fn(async () => ({ _id: "redeemed_1" })),
              };
            }),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
      get: vi.fn(async (id: string) => {
        if (id === "store_1") {
          return {
            _id: "store_1",
            config: {
              homepageDiscountCodeModalPromoCode: "promo_1",
            },
          };
        }

        if (id === "promo_1") {
          return {
            _id: "promo_1",
            active: true,
          };
        }

        return null;
      }),
    };

    const result = await getEligibility.handler({ db } as never, {
      storeFrontUserId: "guest_1",
      storeId: "store_1",
    });

    expect(result).toEqual({
      isReturningUser: true,
      isEngaged: true,
      isEligibleForWelcome25: false,
    });
  });

  it("returns not returning and not engaged when activity is recent and narrow", async () => {
    const { getEligibility } = await loadModule();

    const recentTimestamp = Date.now() - 30 * 60 * 1000;
    const activities = [{ _creationTime: recentTimestamp, action: "page_view" }];

    const db = {
      query: vi.fn((table: string) => {
        if (table === "analytics") {
          return {
            withIndex: vi.fn((_, indexCb: (q: any) => any) => {
              const q = {
                eq: vi.fn(),
              };
              indexCb(q);
              return {
              take: vi.fn(async () => activities),
              };
            }),
          };
        }

        if (table === "redeemedPromoCode") {
          return {
            filter: vi.fn(() => ({
              first: vi.fn(async () => null),
            })),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
      get: vi.fn(async (id: string) => {
        if (id === "store_1") {
          return { _id: "store_1", config: {} };
        }

        return null;
      }),
    };

    const result = await getEligibility.handler({ db } as never, {
      storeFrontUserId: "guest_1",
      storeId: "store_1",
    });

    expect(result).toEqual({
      isReturningUser: false,
      isEngaged: false,
      isEligibleForWelcome25: false,
    });
  });

  it("returns not eligible when welcome promo exists but is inactive", async () => {
    const { getEligibility } = await loadModule();

    const oldTimestamp = Date.now() - 2 * 24 * 60 * 60 * 1000;
    const activities = [{ _creationTime: oldTimestamp, action: "viewed_product" }];

    const db = {
      query: vi.fn((table: string) => {
        if (table === "analytics") {
          return {
            withIndex: vi.fn((_, indexCb: (q: any) => any) => {
              const q = {
                eq: vi.fn(),
              };
              indexCb(q);
              return {
                take: vi.fn(async () => activities),
              };
            }),
          };
        }

        if (table === "redeemedPromoCode") {
          return {
            filter: vi.fn((filterCb: (q: any) => any) => {
              const q = {
                and: vi.fn(),
                eq: vi.fn(),
                field: vi.fn((field: string) => field),
              };
              filterCb(q);
              return {
                first: vi.fn(async () => null),
              };
            }),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
      get: vi.fn(async (id: string) => {
        if (id === "store_1") {
          return {
            _id: "store_1",
            config: {
              homepageDiscountCodeModalPromoCode: "promo_1",
            },
          };
        }

        if (id === "promo_1") {
          return {
            _id: "promo_1",
            active: false,
          };
        }

        return null;
      }),
    };

    const result = await getEligibility.handler({ db } as never, {
      storeFrontUserId: "guest_1",
      storeId: "store_1",
    });

    expect(result).toEqual({
      isReturningUser: true,
      isEngaged: false,
      isEligibleForWelcome25: false,
    });
  });
});
