import { beforeEach, describe, expect, it, vi } from "vitest";

import { AthenaUnauthenticatedError } from "../lib/athenaUnauthenticated";
import {
  ATHENA_CAPABILITY_CATALOG,
  SHARED_DEMO_ALLOWED_CAPABILITIES,
} from "../platform/capabilityCatalog";
import { SHARED_DEMO_ALLOWED_READ_INTENTS } from "../sharedDemo/policy";
import { U7_STOREFRONT_OPERATOR_OPERATION_DEFINITIONS } from "../operationAdmission/domains/u7_storefrontOperator_definitions";
import { U7_STOREFRONT_OPERATOR_READ_OPERATION_DEFINITIONS } from "../operationAdmission/domains/u7_storefrontOperator_readDefinitions";
import {
  sendOrderUpdateEmailOperationDefinition,
  updateOnlineOrderOperationDefinition,
  validateOperationDefinition,
} from "../operationAdmission/definitions";
import { validateReadOperationDefinition } from "../operationAdmission/readDefinitions";

const mocks = vi.hoisted(() => ({
  getSharedDemoActorWithCtx: vi.fn(),
  requireAuthenticatedAthenaUserWithCtx: vi.fn(),
  requireOrganizationMemberRoleWithCtx: vi.fn(),
  requireReportsStoreAccess: vi.fn(),
}));

vi.mock("../lib/athenaUserAuth", async () => {
  const actual =
    await vi.importActual<typeof import("../lib/athenaUserAuth")>(
      "../lib/athenaUserAuth",
    );
  return {
    ...actual,
    requireAuthenticatedAthenaUserWithCtx:
      mocks.requireAuthenticatedAthenaUserWithCtx,
    requireOrganizationMemberRoleWithCtx:
      mocks.requireOrganizationMemberRoleWithCtx,
  };
});

vi.mock("../sharedDemo/actor", async () => {
  const actual = await vi.importActual<typeof import("../sharedDemo/actor")>(
    "../sharedDemo/actor",
  );
  return {
    ...actual,
    getSharedDemoActorWithCtx: mocks.getSharedDemoActorWithCtx,
  };
});

vi.mock("../reports/access", async () => {
  const actual = await vi.importActual<typeof import("../reports/access")>(
    "../reports/access",
  );
  return {
    ...actual,
    requireReportsStoreAccess: mocks.requireReportsStoreAccess,
  };
});

import { CUSTOMER_OWNERSHIP_DENIED } from "./customerOwnership";
import * as analytics from "./analytics";
import * as onlineOrder from "./onlineOrder";
import * as reviews from "./reviews";

const DEMO_ENV = {
  ATHENA_SHARED_DEMO_ENABLED: "true",
  ATHENA_SHARED_DEMO_ATHENA_USER_ID: "demo-user",
  ATHENA_SHARED_DEMO_ORGANIZATION_ID: "demo-org",
  ATHENA_SHARED_DEMO_STORE_ID: "demo-store",
  STAGE: "qa",
};

const DEMO_DENIAL = /shared_demo_action_denied|isn't allowed in the demo/;
const DEMO_ACTOR = {
  kind: "shared_demo",
  athenaUserId: "demo-user",
  authUserId: "auth-user",
  organizationId: "demo-org",
  storeId: "demo-store",
};

function getHandler(definition: unknown) {
  return (definition as { _handler: Function })._handler;
}

/**
 * A context whose every row resolves to `storeId`, so a scope resolver that
 * reads the named order / review / product row lands on that store.
 */
function ctxForStore(storeId: string, overrides: Record<string, any> = {}) {
  const writes = {
    delete: vi.fn(),
    insert: vi.fn(async () => "inserted-1"),
    patch: vi.fn(),
    replace: vi.fn(),
  };
  return {
    auth: { getUserIdentity: vi.fn().mockResolvedValue(null) },
    db: {
      ...writes,
      get: vi.fn(async (table: string, id: string) => ({
        _id: id,
        _creationTime: 1,
        storeId,
        organizationId: "demo-org",
        orderId: "order-1",
        productSkuId: "sku-1",
        createdByStoreFrontUserId: "shopper-1",
        storeFrontUserId: "shopper-1",
        images: [],
        name: table,
      })),
      normalizeId: vi.fn((_table: string, id: string) => id),
      query: vi.fn(() => {
        const chain: Record<string, unknown> = {};
        const self = () => chain;
        Object.assign(chain, {
          collect: vi.fn(async () => []),
          filter: self,
          first: vi.fn(async () => null),
          order: self,
          paginate: vi.fn(async () => ({
            page: [],
            continueCursor: "",
            isDone: true,
          })),
          take: vi.fn(async () => []),
          unique: vi.fn(async () => null),
          withIndex: self,
        });
        return chain;
      }),
      ...overrides,
    },
    runQuery: vi.fn(async () => null),
    runMutation: vi.fn(async () => null),
    scheduler: { runAfter: vi.fn(), runAt: vi.fn() },
    writes,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const [key, value] of Object.entries(DEMO_ENV)) vi.stubEnv(key, value);
  mocks.requireAuthenticatedAthenaUserWithCtx.mockResolvedValue({
    _id: "athena-user-1",
    email: "admin@example.com",
  } as never);
  mocks.requireOrganizationMemberRoleWithCtx.mockResolvedValue({
    _id: "member-1",
    role: "full_admin",
  } as never);
  mocks.requireReportsStoreAccess.mockResolvedValue({
    athenaUser: { _id: "athena-user-1" },
    store: { _id: "tenant-store", organizationId: "tenant-org" },
  } as never);
  mocks.getSharedDemoActorWithCtx.mockResolvedValue(null);
});

// ---------------------------------------------------------------------------
// Definition contract
// ---------------------------------------------------------------------------

describe("U7 storefront operator operation definitions", () => {
  const knownCapabilities = new Set(
    ATHENA_CAPABILITY_CATALOG.map(({ id }) => id),
  );

  it("declares 7 write definitions and 20 read definitions", () => {
    expect(U7_STOREFRONT_OPERATOR_OPERATION_DEFINITIONS.length).toBe(7);
    expect(U7_STOREFRONT_OPERATOR_READ_OPERATION_DEFINITIONS.length).toBe(20);
  });

  it("validates every write definition against the rail contract", () => {
    for (const definition of U7_STOREFRONT_OPERATOR_OPERATION_DEFINITIONS) {
      expect(
        validateOperationDefinition(definition),
        definition.operationId,
      ).toEqual([]);
      expect(knownCapabilities.has(definition.capability as never)).toBe(true);
    }
  });

  it("validates every read definition against the rail contract", () => {
    for (const definition of U7_STOREFRONT_OPERATOR_READ_OPERATION_DEFINITIONS) {
      expect(
        validateReadOperationDefinition(definition),
        definition.operationId,
      ).toEqual([]);
    }
  });

  it("derives actors.sharedDemo from the capability grant set, never widening it", () => {
    const granted = new Set<string>(SHARED_DEMO_ALLOWED_CAPABILITIES);
    for (const definition of U7_STOREFRONT_OPERATOR_OPERATION_DEFINITIONS) {
      expect(
        definition.actors.sharedDemo === "admit",
        definition.operationId,
      ).toBe(granted.has(definition.capability as string));
    }
  });

  it("admits the demo on a read only when its intent is granted", () => {
    const granted = new Set<string>(SHARED_DEMO_ALLOWED_READ_INTENTS);
    for (const definition of U7_STOREFRONT_OPERATOR_READ_OPERATION_DEFINITIONS) {
      if (definition.actors.sharedDemo !== "admit") continue;
      expect(granted.has(definition.access.intent), definition.operationId).toBe(
        true,
      );
    }
  });

  it("keeps every migrated read on the three unit intents", () => {
    const intents = new Set(
      U7_STOREFRONT_OPERATOR_READ_OPERATION_DEFINITIONS.map(
        (definition) => definition.access.intent,
      ),
    );
    expect([...intents].sort()).toEqual([
      "online_orders.view",
      "storefront.analytics.view",
      "storefront.reviews.view",
    ]);
  });

  // The storefront-reached writes now enter only through their HTTP routes and
  // their `internal.*` siblings, so no U7 write gives up identity any more.
  it("admits anonymous writers on no operator write", () => {
    const anonymous = U7_STOREFRONT_OPERATOR_OPERATION_DEFINITIONS.filter(
      (definition) => definition.actors.public === "admit",
    ).map((definition) => definition.functionName);

    expect(anonymous).toEqual([]);
  });

  it("denies anonymous callers on every operator surface", () => {
    const operatorOnly = [
      "storeFront/analytics:clear",
      "storeFront/onlineOrder:create",
      "storeFront/onlineOrder:updateOrderItems",
      "storeFront/reviews:approve",
      "storeFront/reviews:reject",
      "storeFront/reviews:publish",
      "storeFront/reviews:unpublish",
    ];
    for (const functionName of operatorOnly) {
      const definition = U7_STOREFRONT_OPERATOR_OPERATION_DEFINITIONS.find(
        (candidate) => candidate.functionName === functionName,
      );
      expect(definition?.actors.public, functionName).toBe("deny");
      expect(definition?.actors.normalUser, functionName).toBe("admit");
    }
  });

  it("admits anonymous readers only on the reads storefront routes serve", () => {
    const anonymous = U7_STOREFRONT_OPERATOR_READ_OPERATION_DEFINITIONS.filter(
      (definition) => definition.actors.public === "admit",
    ).map((definition) => definition.functionName);

    expect(anonymous.sort()).toEqual(
      [
        "storeFront/onlineOrder:getByCheckoutSessionId",
      ].sort(),
    );
  });

  it("resolves every store scope, so no migrated operation admits unscoped", () => {
    for (const definition of [
      ...U7_STOREFRONT_OPERATOR_OPERATION_DEFINITIONS,
      ...U7_STOREFRONT_OPERATOR_READ_OPERATION_DEFINITIONS,
    ]) {
      expect(definition.scope.kind, definition.operationId).toBe("store");
    }
  });
});

// ---------------------------------------------------------------------------
// Retired handler-local demo guards → definition fields
// ---------------------------------------------------------------------------

describe("retired shared-demo call sites map to definition fields", () => {
  it("onlineOrder:update carries the capability the handler used to require", () => {
    // Retired: `requireSharedDemoCapability("orders.fulfill")` in the handler.
    expect(updateOnlineOrderOperationDefinition.capability).toBe(
      "orders.fulfill",
    );
    expect(updateOnlineOrderOperationDefinition.actors.sharedDemo).toBe("admit");
    expect(updateOnlineOrderOperationDefinition.readiness.kind).toBe(
      "store_write",
    );
  });

  it("onlineOrder:update resolves its store from the order, replacing the handler's cross-store denial", async () => {
    // Retired: the two `denySharedDemoAction()` calls comparing
    // `order.storeId` to the demo actor's store.
    mocks.getSharedDemoActorWithCtx.mockResolvedValue(DEMO_ACTOR as never);
    const ctx = ctxForStore("tenant-store");

    await expect(
      getHandler(onlineOrder.update)(ctx, {
        orderId: "order-1",
        update: { status: "ready-for-pickup" },
      }),
    ).rejects.toThrow(DEMO_DENIAL);

    expect(ctx.writes.patch).not.toHaveBeenCalled();
  });

  it("orderUpdateEmails' retired capability probe is the sendOrderUpdateEmail definition", () => {
    // Retired: `(internal as any).sharedDemo.actor.enforceSharedDemoActionCapability`
    // inside `helpers/orderUpdateEmails.ts`.
    expect(sendOrderUpdateEmailOperationDefinition.capability).toBe(
      "customer.messaging.send",
    );
    expect(sendOrderUpdateEmailOperationDefinition.readiness.kind).toBe(
      "store_ready",
    );
    expect(sendOrderUpdateEmailOperationDefinition.scope.kind).toBe("store");
  });
});

// ---------------------------------------------------------------------------
// Actor coverage at the exported handler
// ---------------------------------------------------------------------------

const OPERATOR_WRITE_CASES: Array<[string, unknown, Record<string, unknown>]> = [
  ["analytics:clear", analytics.clear, {
    storeId: "tenant-store",
    storeFrontUserId: "shopper-1",
  }],
  ["onlineOrder:updateOrderItems", onlineOrder.updateOrderItems, {
    orderItemIds: ["item-1"],
    updates: {},
  }],
  ["reviews:approve", reviews.approve, {
    id: "review-1",
    userId: "athena-user-1",
  }],
  ["reviews:reject", reviews.reject, {
    id: "review-1",
    userId: "athena-user-1",
  }],
  ["reviews:publish", reviews.publish, {
    id: "review-1",
    userId: "athena-user-1",
  }],
  ["reviews:unpublish", reviews.unpublish, {
    id: "review-1",
    userId: "athena-user-1",
  }],
];

describe("operator write admission by actor", () => {
  it.each(OPERATOR_WRITE_CASES)(
    "%s denies an unauthenticated caller before any write",
    async (_name, fn, args) => {
      const ctx = ctxForStore("tenant-store");
      mocks.requireAuthenticatedAthenaUserWithCtx.mockRejectedValue(
        new AthenaUnauthenticatedError(),
      );

      await expect(getHandler(fn)(ctx, args)).rejects.toThrow(
        "Sign in again to continue.",
      );

      expect(ctx.writes.insert).not.toHaveBeenCalled();
      expect(ctx.writes.patch).not.toHaveBeenCalled();
      expect(ctx.writes.delete).not.toHaveBeenCalled();
    },
  );

  it.each(OPERATOR_WRITE_CASES)(
    "%s admits a normal user unchanged",
    async (_name, fn, args) => {
      const ctx = ctxForStore("tenant-store");
      await expect(getHandler(fn)(ctx, args)).resolves.toBeDefined();
    },
  );
});

describe("analytics writes deny the shared demo (ungranted capability)", () => {
  it.each([
    ["analytics:clear", analytics.clear, {
      storeId: "demo-store",
      storeFrontUserId: "shopper-1",
    }],
  ] as Array<[string, unknown, Record<string, unknown>]>)(
    "%s denies a shared-demo visitor before any write",
    async (_name, fn, args) => {
      mocks.getSharedDemoActorWithCtx.mockResolvedValue(DEMO_ACTOR as never);
      const ctx = ctxForStore("demo-store");

      await expect(getHandler(fn)(ctx, args)).rejects.toThrow(DEMO_DENIAL);

      expect(ctx.writes.insert).not.toHaveBeenCalled();
      expect(ctx.writes.patch).not.toHaveBeenCalled();
      expect(ctx.writes.delete).not.toHaveBeenCalled();
    },
  );
});

describe("review moderation admission", () => {
  it("denies an anonymous moderator", async () => {
    const ctx = ctxForStore("tenant-store");
    mocks.requireAuthenticatedAthenaUserWithCtx.mockRejectedValue(
      new AthenaUnauthenticatedError(),
    );

    await expect(
      getHandler(reviews.publish)(ctx, {
        id: "review-1",
        userId: "athena-user-1",
      }),
    ).rejects.toThrow("Sign in again to continue.");
  });

  it("denies a shared-demo moderator reaching another store's review", async () => {
    mocks.getSharedDemoActorWithCtx.mockResolvedValue(DEMO_ACTOR as never);
    const ctx = ctxForStore("tenant-store");

    await expect(
      getHandler(reviews.publish)(ctx, {
        id: "review-1",
        userId: "athena-user-1",
      }),
    ).rejects.toThrow(DEMO_DENIAL);
    expect(ctx.writes.patch).not.toHaveBeenCalled();
  });

  it("reaches the demo readiness fence inside its own store rather than an actor denial (reviews.manage is granted)", async () => {
    // `reviews.manage` IS granted, so the demo actor passes capability and
    // scope; what stops this fixture is the store_write restore fence, which
    // is exactly the ordering the rail promises.
    const definition = U7_STOREFRONT_OPERATOR_OPERATION_DEFINITIONS.find(
      (candidate) => candidate.functionName === "storeFront/reviews:publish",
    );
    expect(definition?.actors.sharedDemo).toBe("admit");
    expect(definition?.readiness.kind).toBe("store_write");
  });

  it("keeps the CommandResult shape for a missing review", async () => {
    const ctx = ctxForStore("tenant-store", { get: vi.fn(async () => null) });

    await expect(
      getHandler(reviews.approve)(ctx, {
        id: "review-1",
        userId: "athena-user-1",
      }),
    ).resolves.toEqual({
      kind: "user_error",
      error: { code: "not_found", message: "Review not found." },
    });
  });
});

describe("read admission", () => {
  it("denies an unauthenticated reader on an operator analytics read", async () => {
    const ctx = ctxForStore("tenant-store");
    mocks.requireAuthenticatedAthenaUserWithCtx.mockRejectedValue(
      new AthenaUnauthenticatedError(),
    );

    await expect(
      getHandler(analytics.getAll)(ctx, { storeId: "tenant-store" }),
    ).rejects.toThrow("Sign in again to continue.");
  });

  it("denies a shared-demo reader on the ungranted storefront.analytics.view intent", async () => {
    mocks.getSharedDemoActorWithCtx.mockResolvedValue(DEMO_ACTOR as never);
    const ctx = ctxForStore("demo-store");

    await expect(
      getHandler(analytics.getAll)(ctx, { storeId: "demo-store" }),
    ).rejects.toThrow(DEMO_DENIAL);
  });

  it("denies a shared-demo reader on the ungranted storefront.reviews.view intent", async () => {
    mocks.getSharedDemoActorWithCtx.mockResolvedValue(DEMO_ACTOR as never);
    const ctx = ctxForStore("demo-store");

    await expect(
      getHandler(reviews.getAllReviewsForStore)(ctx, {
        storeId: "demo-store",
      }),
    ).rejects.toThrow(DEMO_DENIAL);
  });

  it("admits a shared-demo reader on the granted online_orders.view intent inside its store", async () => {
    mocks.getSharedDemoActorWithCtx.mockResolvedValue(DEMO_ACTOR as never);
    const ctx = ctxForStore("demo-store");

    await expect(
      getHandler(onlineOrder.getOrderItems)(ctx, { orderId: "order-1" }),
    ).resolves.toEqual([]);
  });

  it("denies a shared-demo reader whose order lives in another store", async () => {
    mocks.getSharedDemoActorWithCtx.mockResolvedValue(DEMO_ACTOR as never);
    const ctx = ctxForStore("tenant-store");

    await expect(
      getHandler(onlineOrder.getOrderItems)(ctx, { orderId: "order-1" }),
    ).rejects.toThrow(DEMO_DENIAL);
  });

  it("denies an anonymous reader on the moderation queue", async () => {
    const ctx = ctxForStore("tenant-store");
    mocks.requireAuthenticatedAthenaUserWithCtx.mockRejectedValue(
      new AthenaUnauthenticatedError(),
    );

    await expect(
      getHandler(reviews.getUnapprovedReviewsCount)(ctx, {
        storeId: "tenant-store",
      }),
    ).rejects.toThrow("Sign in again to continue.");
  });
});

// ---------------------------------------------------------------------------
// Internal siblings: same behaviour, plus the ownership assertions
// ---------------------------------------------------------------------------

describe("internal siblings are the only remaining entry points", () => {
  it("exposes an internal sibling for every route-reached function", () => {
    for (const fn of [
      analytics.createInternal,
      analytics.updateOwnerInternal,
      analytics.getProductViewCountInternal,
      onlineOrder.getAllForCustomerInternal,
      onlineOrder.getForCustomerInternal,
      onlineOrder.getByCheckoutSessionIdInternal,
      onlineOrder.updateOwnerInternal,
      reviews.createInternal,
      reviews.updateInternal,
      reviews.deleteReviewInternal,
      reviews.markHelpfulInternal,
      reviews.getByOrderItemInternal,
      reviews.hasReviewForOrderItemInternal,
      reviews.hasUserReviewForOrderItemInternal,
      reviews.getByProductSkuIdInternal,
      reviews.getByProductIdInternal,
      reviews.getByUserInternal,
      reviews.getByUserAndProductSkuIdInternal,
    ]) {
      expect(typeof getHandler(fn)).toBe("function");
    }
  });
});

describe("ownership assertions on internal callees reachable from customer routes", () => {
  const OWNER = { storeFrontUserId: "shopper-1", storeId: "tenant-store" };
  const FOREIGN_OWNER = {
    storeFrontUserId: "shopper-2",
    storeId: "tenant-store",
  };

  it("reviews:updateInternal refuses another shopper's review", async () => {
    const ctx = ctxForStore("tenant-store");

    await expect(
      getHandler(reviews.updateInternal)(ctx, {
        id: "review-1",
        title: "hijacked",
        owner: FOREIGN_OWNER,
      }),
    ).rejects.toThrow("You do not have access to this review.");
    expect(ctx.writes.patch).not.toHaveBeenCalled();
  });

  it("reviews:updateInternal refuses a review in another store", async () => {
    const ctx = ctxForStore("other-store");

    await expect(
      getHandler(reviews.updateInternal)(ctx, {
        id: "review-1",
        title: "hijacked",
        owner: OWNER,
      }),
    ).rejects.toThrow("You do not have access to this review.");
  });

  it("reviews:updateInternal patches the shopper's own review", async () => {
    const ctx = ctxForStore("tenant-store");

    await getHandler(reviews.updateInternal)(ctx, {
      id: "review-1",
      title: "fixed a typo",
      owner: OWNER,
    });

    expect(ctx.writes.patch).toHaveBeenCalled();
  });

  it("reviews:deleteReviewInternal refuses another shopper's review", async () => {
    const ctx = ctxForStore("tenant-store");

    await expect(
      getHandler(reviews.deleteReviewInternal)(ctx, {
        id: "review-1",
        owner: FOREIGN_OWNER,
      }),
    ).rejects.toThrow("You do not have access to this review.");
    expect(ctx.writes.delete).not.toHaveBeenCalled();
  });

  it("reviews:markHelpfulInternal refuses a review in another store", async () => {
    const ctx = ctxForStore("other-store");

    await expect(
      getHandler(reviews.markHelpfulInternal)(ctx, {
        reviewId: "review-1",
        owner: OWNER,
      }),
    ).rejects.toThrow("You do not have access to this review.");
  });

  it("reviews:markHelpfulInternal votes as the admitted actor, not a client id", async () => {
    const ctx = ctxForStore("tenant-store");

    await getHandler(reviews.markHelpfulInternal)(ctx, {
      reviewId: "review-1",
      owner: OWNER,
    });

    expect(ctx.writes.patch).toHaveBeenCalledWith(
      "review",
      "review-1",
      expect.objectContaining({ helpfulUserIds: ["shopper-1"] }),
    );
  });

  it("reviews:createInternal refuses an order that is not the shopper's", async () => {
    const ctx = ctxForStore("tenant-store");

    await expect(
      getHandler(reviews.createInternal)(ctx, {
        orderId: "order-1",
        orderNumber: "1001",
        orderItemId: "item-1",
        productId: "product-1",
        productSkuId: "sku-1",
        title: "Great",
        ratings: [],
        owner: FOREIGN_OWNER,
      }),
    ).rejects.toThrow("You do not have access to this order.");
    expect(ctx.writes.insert).not.toHaveBeenCalled();
  });

  it("reviews:createInternal attributes the review to the admitted actor and store", async () => {
    const ctx = ctxForStore("tenant-store");

    await getHandler(reviews.createInternal)(ctx, {
      orderId: "order-1",
      orderNumber: "1001",
      orderItemId: "item-1",
      productId: "product-1",
      productSkuId: "sku-1",
      title: "Great",
      ratings: [],
      owner: OWNER,
    });

    expect(ctx.writes.insert).toHaveBeenCalledWith(
      "review",
      expect.objectContaining({
        createdByStoreFrontUserId: "shopper-1",
        storeId: "tenant-store",
      }),
    );
  });

  it("reviews:getByUserInternal reads the admitted actor's reviews only", async () => {
    const ctx = ctxForStore("tenant-store");
    const handler = getHandler(reviews.getByUserInternal);

    // The internal signature has no caller-supplied `userId` at all: the only
    // shopper it can read is the one in `owner`.
    await expect(handler(ctx, { owner: OWNER })).resolves.toEqual([]);
  });

  it("onlineOrder:getForCustomerInternal refuses another shopper's order", async () => {
    const ctx = ctxForStore("tenant-store");

    await expect(
      getHandler(onlineOrder.getForCustomerInternal)(ctx, {
        identifier: "order-1",
        owner: FOREIGN_OWNER,
      }),
    ).rejects.toThrow(CUSTOMER_OWNERSHIP_DENIED);
  });

  it("onlineOrder:getForCustomerInternal serves backend callers with no shopper claim", async () => {
    const ctx = ctxForStore("tenant-store");

    await expect(
      getHandler(onlineOrder.getForCustomerInternal)(ctx, {
        identifier: "order-1",
      }),
    ).resolves.toBeDefined();
  });

  it("onlineOrder:getByCheckoutSessionIdInternal refuses another shopper's session order", async () => {
    const ctx = ctxForStore("tenant-store", {
      query: vi.fn(() => {
        const chain: Record<string, unknown> = {};
        const self = () => chain;
        Object.assign(chain, {
          collect: vi.fn(async () => []),
          filter: self,
          first: vi.fn(async () => ({
            _id: "order-1",
            storeId: "tenant-store",
            storeFrontUserId: "shopper-1",
          })),
          order: self,
          take: vi.fn(async () => []),
          withIndex: self,
        });
        return chain;
      }),
    });

    await expect(
      getHandler(onlineOrder.getByCheckoutSessionIdInternal)(ctx, {
        checkoutSessionId: "session-1",
        owner: FOREIGN_OWNER,
      }),
    ).rejects.toThrow(CUSTOMER_OWNERSHIP_DENIED);
  });

  it("onlineOrder:updateOwnerInternal refuses a guest session from another store", async () => {
    const ctx = ctxForStore("other-store");

    await expect(
      getHandler(onlineOrder.updateOwnerInternal)(ctx, {
        currentOwner: "guest-1",
        claimGuestId: "guest-1",
        owner: OWNER,
      }),
    ).rejects.toThrow(CUSTOMER_OWNERSHIP_DENIED);
    expect(ctx.writes.patch).not.toHaveBeenCalled();
  });

  it("onlineOrder:updateOwnerInternal refuses a guest session the caller does not hold", async () => {
    const ctx = ctxForStore("tenant-store");

    // Same store, so the old store-only bound admitted this: a signed-in
    // shopper naming a STRANGER's guest id absorbed their order history.
    await expect(
      getHandler(onlineOrder.updateOwnerInternal)(ctx, {
        currentOwner: "guest-stranger",
        claimGuestId: "guest-mine",
        owner: OWNER,
      }),
    ).rejects.toThrow(CUSTOMER_OWNERSHIP_DENIED);

    // …and with no guest cookie presented at all.
    await expect(
      getHandler(onlineOrder.updateOwnerInternal)(ctx, {
        currentOwner: "guest-stranger",
        owner: OWNER,
      }),
    ).rejects.toThrow(CUSTOMER_OWNERSHIP_DENIED);
    expect(ctx.writes.patch).not.toHaveBeenCalled();
  });

  it("onlineOrder:updateOwnerInternal re-owns the caller's OWN guest session", async () => {
    const ctx = ctxForStore("tenant-store");

    await expect(
      getHandler(onlineOrder.updateOwnerInternal)(ctx, {
        currentOwner: "guest-mine",
        claimGuestId: "guest-mine",
        owner: OWNER,
      }),
    ).resolves.toBeDefined();
  });

  it("analytics:updateOwnerInternal refuses a guest session from another store", async () => {
    const ctx = ctxForStore("other-store");

    await expect(
      getHandler(analytics.updateOwnerInternal)(ctx, {
        guestId: "guest-1",
        owner: OWNER,
      }),
    ).rejects.toThrow("You do not have access to this guest session.");
  });

  it("analytics:createInternal attributes the event to the admitted actor and store", async () => {
    const ctx = ctxForStore("tenant-store");

    await getHandler(analytics.createInternal)(ctx, {
      action: "viewed_product",
      data: {},
      owner: OWNER,
    });

    expect(ctx.writes.insert).toHaveBeenCalledWith(
      "analytics",
      expect.objectContaining({
        storeFrontUserId: "shopper-1",
        storeId: "tenant-store",
      }),
    );
  });
});
