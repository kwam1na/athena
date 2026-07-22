import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
}));

import { getAuthUserId } from "@convex-dev/auth/server";

import { getAll as getProducts } from "../inventory/products";
import { getSessionItems } from "../inventory/posSessionItems";
import {
  getInventoryUnitSummary,
  listInventorySnapshot,
  listInventorySnapshotPage,
} from "../stockOps/adjustments";
import {
  getForOperations as getOrder,
  getOrderMetrics,
  newOrder,
} from "../storeFront/onlineOrder";
import {
  getEodAutoCompletePolicy,
  getOpeningAutoStartPolicy,
  getRegisterCloseoutApprovalPolicy,
} from "../operations/dailyOperationsAutomation";
import {
  findByStoreFrontUser,
  getCustomerById,
  getCustomerTransactions,
} from "../pos/public/customers";

const invoke = (fn: unknown, ctx: unknown, args: unknown) =>
  (fn as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> })
    ._handler(ctx, args);

describe("shared demo read store boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ATHENA_SHARED_DEMO_ENABLED", "true");
    vi.stubEnv("STAGE", "qa");
    vi.mocked(getAuthUserId).mockResolvedValue("auth-user" as never);
  });

  it.each([
    [getProducts, { storeId: "other-store" }],
    [listInventorySnapshot, { storeId: "other-store" }],
    [getInventoryUnitSummary, { storeId: "other-store" }],
    [
      listInventorySnapshotPage,
      {
        paginationOpts: { cursor: null, numItems: 25 },
        storeId: "other-store",
      },
    ],
    [newOrder, { storeId: "other-store" }],
    [getOrderMetrics, { storeId: "other-store", timeRange: "day" }],
    [getOpeningAutoStartPolicy, { storeId: "other-store" }],
    [getEodAutoCompletePolicy, { storeId: "other-store" }],
    [getRegisterCloseoutApprovalPolicy, { storeId: "other-store" }],
  ] as const)(
    "rejects a store-scoped read before its domain query runs",
    async (fn, args) => {
      const ctx = demoReadCtx();

      await expect(invoke(fn, ctx, args)).rejects.toThrow(
        "This action isn't allowed in the demo.",
      );
      expect(ctx.db.get).not.toHaveBeenCalled();
      expect(ctx.domainQueryTables).toEqual([]);
    },
  );

  it.each([
    [
      getSessionItems,
      { sessionId: "session-1" },
      "posSession",
      { _id: "session-1", storeId: "other-store" },
    ],
    [
      getCustomerById,
      { customerId: "customer-1" },
      "posCustomer",
      { _id: "customer-1", storeId: "other-store" },
    ],
    [
      getCustomerTransactions,
      { customerId: "customer-1" },
      "posCustomer",
      { _id: "customer-1", storeId: "other-store" },
    ],
    [
      findByStoreFrontUser,
      { storeFrontUserId: "storefront-user-1" },
      "storeFrontUser",
      { _id: "storefront-user-1", storeId: "other-store" },
    ],
    [
      getOrder,
      { identifier: "order-1" },
      "onlineOrder",
      { _id: "order-1", storeId: "other-store" },
    ],
  ] as const)(
    "authorizes an entity's store before reading child data",
    async (fn, args, tableName, document) => {
      const ctx = demoReadCtx({
        documents: new Map([[`${tableName}:${document._id}`, document]]),
      });

      await expect(invoke(fn, ctx, args)).rejects.toThrow(
        "This action isn't allowed in the demo.",
      );
      expect(ctx.db.get).toHaveBeenCalledTimes(1);
      expect(ctx.db.get).toHaveBeenCalledWith(tableName, document._id);
      expect(ctx.domainQueryTables).toEqual([]);
    },
  );

  it("authorizes an online order external reference before reading child data", async () => {
    const order = {
      _id: "order-1",
      externalReference: "paystack-reference-1",
      storeId: "other-store",
    };
    const ctx = demoReadCtx({
      documents: new Map([[`onlineOrder:${order._id}`, order]]),
      normalizeId: (tableName, id) =>
        tableName === "onlineOrder" ? null : id,
      onlineOrdersByExternalReference: new Map([[order.externalReference, order]]),
    });

    await expect(
      invoke(getOrder, ctx, { identifier: order.externalReference }),
    ).rejects.toThrow("This action isn't allowed in the demo.");
    expect(ctx.domainQueryTables).toEqual(["onlineOrder"]);
  });

  it("authorizes an online order checkout session before reading child data", async () => {
    const order = {
      _id: "order-1",
      checkoutSessionId: "checkout-session-1",
      storeId: "other-store",
    };
    const ctx = demoReadCtx({
      documents: new Map([[`onlineOrder:${order._id}`, order]]),
      normalizeId: (tableName, id) =>
        tableName === "checkoutSession" ? id : null,
      onlineOrdersByCheckoutSessionId: new Map([
        [order.checkoutSessionId, order],
      ]),
    });

    await expect(
      invoke(getOrder, ctx, { identifier: order.checkoutSessionId }),
    ).rejects.toThrow("This action isn't allowed in the demo.");
    expect(ctx.domainQueryTables).toEqual(["onlineOrder", "onlineOrder"]);
  });
});

function demoReadCtx(
  args: {
    documents?: Map<string, Record<string, unknown>>;
    normalizeId?: (tableName: string, id: string) => string | null;
    onlineOrdersByCheckoutSessionId?: Map<string, Record<string, unknown>>;
    onlineOrdersByExternalReference?: Map<string, Record<string, unknown>>;
  } = {},
) {
  const domainQueryTables: string[] = [];
  const principal = {
    admissionExpiresAt: Date.now() + 60_000,
    athenaUserId: "athena-user",
    authUserId: "auth-user",
    organizationId: "org-1",
    storeId: "store-1",
  };
  const documents = args.documents ?? new Map<string, Record<string, unknown>>();
  const db = {
    get: vi.fn(async (tableName: string, id: string) => {
      return documents.get(`${tableName}:${id}`) ?? null;
    }),
    normalizeId: vi.fn((tableName: string, id: string) =>
      args.normalizeId ? args.normalizeId(tableName, id) : id,
    ),
    query: vi.fn((tableName: string) => {
      if (tableName === "sharedDemoPrincipal") {
        return {
          withIndex: vi.fn((_name, apply) => {
            apply({ eq: vi.fn().mockReturnThis() });
            return { unique: vi.fn().mockResolvedValue(principal) };
          }),
        };
      }
      domainQueryTables.push(tableName);
      return {
        withIndex: vi.fn((_name, apply) => {
          const eq = vi.fn().mockReturnThis();
          apply({ eq });
          return {
            collect: vi.fn(),
            first: vi.fn(() => {
              const lookupValue = eq.mock.calls[0]?.[1];
              if (
                tableName === "onlineOrder" &&
                _name === "by_externalReference" &&
                typeof lookupValue === "string"
              ) {
                return Promise.resolve(
                  args.onlineOrdersByExternalReference?.get(lookupValue) ??
                    null,
                );
              }
              if (
                tableName === "onlineOrder" &&
                _name === "by_checkoutSessionId" &&
                typeof lookupValue === "string"
              ) {
                return Promise.resolve(
                  args.onlineOrdersByCheckoutSessionId?.get(lookupValue) ??
                    null,
                );
              }
              return Promise.resolve(null);
            }),
            order: vi.fn().mockReturnThis(),
            paginate: vi.fn(),
            take: vi.fn(),
            unique: vi.fn(),
          };
        }),
      };
    }),
  };

  return {
    auth: { getUserIdentity: vi.fn() },
    db,
    domainQueryTables,
  };
}
