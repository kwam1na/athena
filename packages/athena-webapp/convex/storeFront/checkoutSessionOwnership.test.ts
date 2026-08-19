/// <reference types="vite/client" />

/**
 * Ownership + behaviour contract for the checkout-session internal siblings.
 *
 * `storeFront/checkoutSession.create` and `cancelOrder` used to be public Convex
 * exports. The admission migration deleted them and moved their bodies behind
 * `createInternal` / `cancelOrderInternal`, which are reachable only from
 * `POST /checkout` and `POST /checkout/:checkoutSessionId`. The `owner`
 * parameter is now the ONLY thing standing between a bearer id and another
 * shopper's session, so it is what these tests exercise:
 *
 * - a shopper opens a session on their OWN bag, and the session is persisted
 *   for them;
 * - a valid bag id belonging to someone else is refused and NO session row is
 *   written;
 * - a forged `storeFrontUserId` cannot be laundered past the admitted owner;
 * - a cancel against a foreign session is refused before any refund call goes
 *   out to the provider.
 */

import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { CUSTOMER_OWNERSHIP_DENIED } from "./customerOwnership";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../")
      ? path.replace(/^\.\.\//, "./")
      : path.replace(/^\.\//, "./storeFront/"),
    loader,
  ]),
);

const DENIED = new RegExp(
  CUSTOMER_OWNERSHIP_DENIED.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
);

async function seed() {
  const t = convexTest(schema, modules);

  const fixture = await t.run(async (ctx) => {
    const athenaUserId = await ctx.db.insert("athenaUser", {
      email: "operator@test",
      normalizedEmail: "operator@test",
    });
    const organizationId = await ctx.db.insert("organization", {
      createdByUserId: athenaUserId,
      name: "org",
      slug: "org",
    });
    const storeId = await ctx.db.insert("store", {
      createdByUserId: athenaUserId,
      currency: "GHS",
      name: "store",
      organizationId,
      slug: "store",
    });

    const alice = await ctx.db.insert("guest", {
      marker: "alice",
      organizationId,
      storeId,
    });
    const bob = await ctx.db.insert("guest", {
      marker: "bob",
      organizationId,
      storeId,
    });

    const categoryId = await ctx.db.insert("category", {
      name: "wigs",
      slug: "wigs",
      storeId,
    });
    const subcategoryId = await ctx.db.insert("subcategory", {
      categoryId,
      name: "lace",
      slug: "lace",
      storeId,
    });
    const productId = await ctx.db.insert("product", {
      availability: "live",
      categoryId,
      createdByUserId: athenaUserId,
      currency: "GHS",
      inventoryCount: 10,
      name: "wig",
      organizationId,
      slug: "wig",
      storeId,
      subcategoryId,
    });
    const productSkuId = await ctx.db.insert("productSku", {
      images: [],
      inventoryCount: 10,
      price: 1_000,
      productId,
      quantityAvailable: 10,
      sku: "SKU-1",
      storeId,
      unitCost: 100,
    });

    async function bagFor(owner: Id<"guest">) {
      return await ctx.db.insert("bag", {
        items: [],
        storeFrontUserId: owner,
        storeId,
        updatedAt: Date.now(),
      });
    }

    return {
      alice,
      aliceBag: await bagFor(alice),
      bob,
      bobBag: await bagFor(bob),
      organizationId,
      productId,
      productSkuId,
      storeId,
    };
  });

  return { t, ...fixture };
}

const products = (f: Awaited<ReturnType<typeof seed>>) => [
  {
    price: 1_000,
    productId: f.productId,
    productSku: "SKU-1",
    productSkuId: f.productSkuId,
    quantity: 1,
  },
];

const countSessions = (t: any) =>
  t.run(async (ctx: any) =>
    (await ctx.db.query("checkoutSession").collect()).length,
  );

describe("checkoutSession.createInternal ownership", () => {
  it("opens a session for the admitted shopper on their own bag", async () => {
    const f = await seed();

    const result = await f.t.mutation(
      internal.storeFront.checkoutSession.createInternal,
      {
        amount: 1_000,
        bagId: f.aliceBag,
        owner: { guestId: f.alice, storeId: f.storeId },
        products: products(f),
        storeFrontUserId: f.alice,
        storeId: f.storeId,
      },
    );

    expect(result.success).toBe(true);

    const sessions = await f.t.run(async (ctx) =>
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      ctx.db.query("checkoutSession").collect(),
    );
    expect(sessions).toHaveLength(1);
    expect(sessions[0].storeFrontUserId).toBe(f.alice);
    expect(sessions[0].storeId).toBe(f.storeId);
  });

  it("refuses to open a session on another shopper's bag and writes nothing", async () => {
    const f = await seed();

    await expect(
      f.t.mutation(internal.storeFront.checkoutSession.createInternal, {
        amount: 1_000,
        // Bob's bag id is perfectly valid — possession of it proves nothing.
        bagId: f.bobBag,
        owner: { guestId: f.alice, storeId: f.storeId },
        products: products(f),
        storeFrontUserId: f.alice,
        storeId: f.storeId,
      }),
    ).rejects.toThrow(DENIED);

    expect(await countSessions(f.t)).toBe(0);
  });

  it("refuses a forged storeFrontUserId that is not the admitted shopper", async () => {
    const f = await seed();

    await expect(
      f.t.mutation(internal.storeFront.checkoutSession.createInternal, {
        amount: 1_000,
        bagId: f.aliceBag,
        owner: { guestId: f.alice, storeId: f.storeId },
        products: products(f),
        // A body-supplied id cannot become the shopper the session is opened for.
        storeFrontUserId: f.bob,
        storeId: f.storeId,
      }),
    ).rejects.toThrow(DENIED);

    expect(await countSessions(f.t)).toBe(0);
  });

  it("refuses a store the admitted claim was not clamped to", async () => {
    const f = await seed();

    const otherStoreId = await f.t.run(async (ctx) => {
      const athenaUserId = await ctx.db.insert("athenaUser", {
        email: "other@test",
        normalizedEmail: "other@test",
      });
      return await ctx.db.insert("store", {
        createdByUserId: athenaUserId,
        currency: "GHS",
        name: "other",
        organizationId: f.organizationId,
        slug: "other",
      });
    });

    await expect(
      f.t.mutation(internal.storeFront.checkoutSession.createInternal, {
        amount: 1_000,
        bagId: f.aliceBag,
        owner: { guestId: f.alice, storeId: f.storeId },
        products: products(f),
        storeFrontUserId: f.alice,
        storeId: otherStoreId,
      }),
    ).rejects.toThrow(DENIED);

    expect(await countSessions(f.t)).toBe(0);
  });
});

describe("checkoutSession.cancelOrderInternal ownership", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function sessionFor(
    f: Awaited<ReturnType<typeof seed>>,
    owner: Id<"guest">,
  ) {
    return await f.t.run(async (ctx) =>
      ctx.db.insert("checkoutSession", {
        amount: 1_000,
        bagId: owner === f.alice ? f.aliceBag : f.bobBag,
        billingDetails: null,
        customerDetails: null,
        deliveryDetails: null,
        deliveryFee: null,
        deliveryInstructions: null,
        deliveryOption: null,
        discount: null,
        expiresAt: Date.now() + 60_000,
        externalReference: `reference-${owner}`,
        externalTransactionId: `transaction-${owner}`,
        hasCompletedCheckoutSession: false,
        hasCompletedPayment: false,
        hasVerifiedPayment: false,
        isFinalizingPayment: true,
        pickupLocation: null,
        storeFrontUserId: owner,
        storeId: f.storeId,
      }),
    );
  }

  it("cancels and refunds the admitted shopper's own session", async () => {
    const f = await seed();
    const sessionId = await sessionFor(f, f.alice);

    const refund = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", refund);

    const result = await f.t.action(
      internal.storeFront.checkoutSession.cancelOrderInternal,
      { id: sessionId, owner: { guestId: f.alice, storeId: f.storeId } },
    );

    expect(result).toEqual({
      message: "Order has been cancelled.",
      success: true,
    });
    expect(refund).toHaveBeenCalledTimes(1);

    const session = await f.t.run((ctx) =>
      ctx.db.get("checkoutSession", sessionId),
    );
    expect(session?.isPaymentRefunded).toBe(true);
    expect(session?.isFinalizingPayment).toBe(false);
  });

  it("refuses to cancel another shopper's session without calling the provider", async () => {
    const f = await seed();
    const bobSession = await sessionFor(f, f.bob);

    const refund = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", refund);

    await expect(
      f.t.action(internal.storeFront.checkoutSession.cancelOrderInternal, {
        id: bobSession,
        owner: { guestId: f.alice, storeId: f.storeId },
      }),
    ).rejects.toThrow(DENIED);

    // No refund was attempted, and Bob's session is untouched.
    expect(refund).not.toHaveBeenCalled();
    const session = await f.t.run((ctx) =>
      ctx.db.get("checkoutSession", bobSession),
    );
    expect(session?.isPaymentRefunded).toBeUndefined();
    expect(session?.isFinalizingPayment).toBe(true);
  });
});
