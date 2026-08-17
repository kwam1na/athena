/// <reference types="vite/client" />

/**
 * The ownership half of U6: what a storefront bearer id may reach.
 *
 * `assurance: "bearer_id"` means holding a `guest_id` cookie proves possession
 * and nothing else, so every internal callee a customer route can reach must
 * check the caller-supplied resource id against the ADMITTED actor. The plan
 * names three known gaps, and all three are covered below:
 * `bagItem.addItemToBag` patched and inserted into any `bagId`, while
 * `updateItemInBag` and `deleteItemFromBag` acted on a bare `itemId`.
 *
 * `owner` is now REQUIRED on every one of these callees. The transitional
 * "assert only if propagated" helpers — which silently skipped the assertion
 * when `owner` was absent, reading at the call site exactly like a live
 * check — are gone.
 * Where genuinely no customer actor exists, the call passes the explicit
 * `SERVER_INITIATED_OWNER` sentinel instead, covered at the end of this file.
 *
 * The guest-store backfill section covers the migration that lets a legacy
 * guest row be clamped at all — and refuses to guess when it cannot be.
 */

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { SERVER_INITIATED_OWNER } from "./customerOwnership";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../")
      ? path.replace(/^\.\.\//, "./")
      : path.replace(/^\.\//, "./storeFront/"),
    loader,
  ]),
);

const NOT_YOURS = /not available for this shopper/;

/** Two shoppers in the same store, each with their own bag and one item. */
async function seedTwoShoppers(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
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
    const otherStoreId = await ctx.db.insert("store", {
      createdByUserId: athenaUserId,
      currency: "GHS",
      name: "other",
      organizationId,
      slug: "other",
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
      price: 1000,
      productId,
      quantityAvailable: 10,
      sku: "SKU-1",
      storeId,
      unitCost: 100,
    });

    async function bagFor(owner: Id<"guest">) {
      const bagId = await ctx.db.insert("bag", {
        items: [],
        storeFrontUserId: owner,
        storeId,
        updatedAt: Date.now(),
      });
      const itemId = await ctx.db.insert("bagItem", {
        bagId,
        productId,
        productSku: "SKU-1",
        productSkuId,
        quantity: 1,
        storeFrontUserId: owner,
        updatedAt: Date.now(),
      });
      return { bagId, itemId };
    }

    return {
      alice,
      aliceBag: await bagFor(alice),
      bob,
      bobBag: await bagFor(bob),
      otherStoreId,
      productId,
      productSkuId,
      storeId,
    };
  });
}

describe("storefront bearer ownership", () => {
  it("refuses to add an item to another shopper's bag", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedTwoShoppers(t);
    const alice = { guestId: seed.alice, storeId: seed.storeId };

    await expect(
      t.run((ctx) =>
        ctx.runMutation(internal.storeFront.bagItem.addItemToBag, {
          bagId: seed.bobBag.bagId,
          owner: alice,
          productId: seed.productId,
          productSku: "SKU-1",
          productSkuId: seed.productSkuId,
          quantity: 1,
          storeFrontUserId: seed.alice,
        }),
      ),
    ).rejects.toThrow(NOT_YOURS);

    // Terminal: Bob's bag is untouched, not merely un-added-to.
    await expect(
      t.run(async (ctx) =>
        (
          await ctx.db
            .query("bagItem")
            .withIndex("by_bagId", (q) => q.eq("bagId", seed.bobBag.bagId))
            .take(10)
        ).length,
      ),
    ).resolves.toBe(1);
  });

  it("refuses to write another shopper's identity onto an item in its own bag", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedTwoShoppers(t);

    await expect(
      t.run((ctx) =>
        ctx.runMutation(internal.storeFront.bagItem.addItemToBag, {
          bagId: seed.aliceBag.bagId,
          owner: { guestId: seed.alice, storeId: seed.storeId },
          productId: seed.productId,
          productSku: "SKU-1",
          productSkuId: seed.productSkuId,
          quantity: 1,
          // The request body claims to be Bob. The admitted claim says Alice.
          storeFrontUserId: seed.bob,
        }),
      ),
    ).rejects.toThrow(NOT_YOURS);
  });

  it("refuses to update or delete a bare item id that belongs to someone else", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedTwoShoppers(t);
    const alice = { guestId: seed.alice, storeId: seed.storeId };

    await expect(
      t.run((ctx) =>
        ctx.runMutation(internal.storeFront.bagItem.updateItemInBag, {
          itemId: seed.bobBag.itemId,
          owner: alice,
          quantity: 99,
        }),
      ),
    ).rejects.toThrow(NOT_YOURS);

    await expect(
      t.run((ctx) =>
        ctx.runMutation(internal.storeFront.bagItem.deleteItemFromBag, {
          itemId: seed.bobBag.itemId,
          owner: alice,
        }),
      ),
    ).rejects.toThrow(NOT_YOURS);

    await expect(
      t.run(async (ctx) =>
        (await ctx.db.get("bagItem", seed.bobBag.itemId))?.quantity,
      ),
    ).resolves.toBe(1);
  });

  it("still lets a shopper act on their own rows", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedTwoShoppers(t);
    const alice = { guestId: seed.alice, storeId: seed.storeId };

    await t.run((ctx) =>
      ctx.runMutation(internal.storeFront.bagItem.updateItemInBag, {
        itemId: seed.aliceBag.itemId,
        owner: alice,
        quantity: 4,
      }),
    );

    await expect(
      t.run(async (ctx) =>
        (await ctx.db.get("bagItem", seed.aliceBag.itemId))?.quantity,
      ),
    ).resolves.toBe(4);
  });

  /**
   * A same-store claim is not a licence to roam. Alice and Bob shop the same
   * store, so a store-only check would have let this through.
   */
  it("denies a claim clamped to another store even for its own bag", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedTwoShoppers(t);

    await expect(
      t.run((ctx) =>
        ctx.runQuery(internal.storeFront.bag.getByIdInternal, {
          id: seed.aliceBag.bagId,
          owner: { guestId: seed.alice, storeId: seed.otherStoreId },
        }),
      ),
    ).rejects.toThrow(NOT_YOURS);
  });

  /**
   * The migration has landed, so `owner` is REQUIRED rather than optional.
   * Omitting it used to be a silent no-op that read like a live check; it now
   * fails closed at the argument validator before the handler ever runs.
   */
  it("refuses the call outright when no owner is passed at all", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedTwoShoppers(t);

    await expect(
      t.run((ctx) =>
        ctx.runMutation(internal.storeFront.bagItem.updateItemInBag, {
          itemId: seed.bobBag.itemId,
          quantity: 7,
        } as never),
      ),
    ).rejects.toThrow(/ArgumentValidationError|owner/i);

    // Terminal: Bob's item is untouched, not merely un-updated.
    await expect(
      t.run(async (ctx) =>
        (await ctx.db.get("bagItem", seed.bobBag.itemId))?.quantity,
      ),
    ).resolves.toBe(1);
  });
});

/* ------------------------------------------------- the rest of the callees */

/**
 * The nine other storefront-reachable internal callees whose `owner` went from
 * optional to required. Each is exercised with a mismatched claim: a valid id
 * for one shopper presented by another, or the right shopper clamped to the
 * wrong store.
 */
describe("required owner on the remaining storefront callees", () => {
  it("bag.create refuses to create a bag for someone else", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedTwoShoppers(t);

    await expect(
      t.run((ctx) =>
        ctx.runMutation(internal.storeFront.bag.create, {
          owner: { guestId: seed.alice, storeId: seed.storeId },
          storeFrontUserId: seed.bob,
          storeId: seed.storeId,
        }),
      ),
    ).rejects.toThrow(NOT_YOURS);
  });

  it("bag.clearBag refuses to empty another shopper's bag", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedTwoShoppers(t);

    await expect(
      t.run((ctx) =>
        ctx.runMutation(internal.storeFront.bag.clearBag, {
          id: seed.bobBag.bagId,
          owner: { guestId: seed.alice, storeId: seed.storeId },
        }),
      ),
    ).rejects.toThrow(NOT_YOURS);

    await expect(
      t.run(async (ctx) =>
        (
          await ctx.db
            .query("bagItem")
            .withIndex("by_bagId", (q) => q.eq("bagId", seed.bobBag.bagId))
            .take(10)
        ).length,
      ),
    ).resolves.toBe(1);
  });

  /**
   * The guest→account merge, from both directions.
   *
   * The destination is no longer body-supplied at all, and the source guest id
   * is authorized by a SERVER-ISSUED GRANT on the guest row. Bounding the merge
   * by store alone let any signed-in shopper absorb (and destroy) a stranger's
   * guest bag; bounding it by the caller's own `guest_id` COOKIE was no better,
   * because a cookie is caller-supplied — both operands of that comparison came
   * from the same request. These tests therefore never pass merge evidence as
   * an argument: they either write the grant onto the row (as `/auth/verify`
   * does) or they do not, and the callee's answer follows from the row.
   */
  async function accountIn(
    t: ReturnType<typeof convexTest>,
    storeId: Id<"store">,
    email: string,
  ) {
    return t.run(async (ctx) =>
      ctx.db.insert("storeFrontUser", {
        email,
        organizationId: (await ctx.db.get("store", storeId))!.organizationId,
        storeId,
      }),
    );
  }

  /** Write the server-issued merge grant, exactly as `/auth/verify` does. */
  async function grantMerge(
    t: ReturnType<typeof convexTest>,
    guestId: Id<"guest">,
    storeFrontUserId: Id<"storeFrontUser">,
    overrides: { expiresAt?: number; consumedBy?: string[] } = {},
  ) {
    await t.run((ctx) =>
      ctx.db.patch("guest", guestId, {
        mergeGrantedToStoreFrontUserId: storeFrontUserId,
        mergeGrantExpiresAt: overrides.expiresAt ?? Date.now() + 15 * 60 * 1000,
        mergeGrantConsumedBy: overrides.consumedBy ?? [],
      }),
    );
  }

  it("bag.updateOwner refuses a guest row that carries no grant for the caller", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedTwoShoppers(t);
    const mallory = await accountIn(t, seed.storeId, "mallory@test");

    // Mallory signed in, so her OWN guest session (alice) is granted to her.
    // She names Bob's guest session instead. This is the P0/P1 attack, and it
    // no longer matters what she presents: Bob's row carries no grant for her.
    await grantMerge(t, seed.alice, mallory);

    await expect(
      t.run((ctx) =>
        ctx.runMutation(internal.storeFront.bag.updateOwner, {
          currentOwner: seed.bob,
          owner: { storeFrontUserId: mallory, storeId: seed.storeId },
        }),
      ),
    ).rejects.toThrow(NOT_YOURS);

    // A grant naming a DIFFERENT account does not authorize this caller.
    const other = await accountIn(t, seed.storeId, "other@test");
    await grantMerge(t, seed.bob, other);

    await expect(
      t.run((ctx) =>
        ctx.runMutation(internal.storeFront.bag.updateOwner, {
          currentOwner: seed.bob,
          owner: { storeFrontUserId: mallory, storeId: seed.storeId },
        }),
      ),
    ).rejects.toThrow(NOT_YOURS);

    // Bob's bag and its item are untouched.
    await expect(
      t.run(async (ctx) => {
        const bag = await ctx.db.get("bag", seed.bobBag.bagId);
        const item = await ctx.db.get("bagItem", seed.bobBag.itemId);
        return {
          bagOwner: String(bag?.storeFrontUserId),
          itemBag: String(item?.bagId),
        };
      }),
    ).resolves.toEqual({
      bagOwner: String(seed.bob),
      itemBag: String(seed.bobBag.bagId),
    });
  });

  it("bag.updateOwner refuses a guest caller with no account to merge into", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedTwoShoppers(t);

    await expect(
      t.run((ctx) =>
        ctx.runMutation(internal.storeFront.bag.updateOwner, {
          currentOwner: seed.alice,
          owner: { guestId: seed.alice, storeId: seed.storeId },
        }),
      ),
    ).rejects.toThrow(NOT_YOURS);
  });

  it("bag.updateOwner merges a granted guest session, once", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedTwoShoppers(t);
    const alice = await accountIn(t, seed.storeId, "alice-account@test");
    await grantMerge(t, seed.alice, alice);

    const merged = await t.run((ctx) =>
      ctx.runMutation(internal.storeFront.bag.updateOwner, {
        currentOwner: seed.alice,
        owner: { storeFrontUserId: alice, storeId: seed.storeId },
      }),
    );

    expect(String(merged?.storeFrontUserId)).toBe(String(alice));

    // Single-use per merge kind: the grant is consumed, so a replay is refused
    // even though the grant has not expired.
    await expect(
      t.run((ctx) =>
        ctx.runMutation(internal.storeFront.bag.updateOwner, {
          currentOwner: seed.alice,
          owner: { storeFrontUserId: alice, storeId: seed.storeId },
        }),
      ),
    ).rejects.toThrow(NOT_YOURS);
  });

  it("bag.updateOwner refuses an EXPIRED grant", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedTwoShoppers(t);
    const alice = await accountIn(t, seed.storeId, "alice-expired@test");
    await grantMerge(t, seed.alice, alice, { expiresAt: Date.now() - 1 });

    await expect(
      t.run((ctx) =>
        ctx.runMutation(internal.storeFront.bag.updateOwner, {
          currentOwner: seed.alice,
          owner: { storeFrontUserId: alice, storeId: seed.storeId },
        }),
      ),
    ).rejects.toThrow(NOT_YOURS);

    // The bag stayed with the guest.
    await expect(
      t.run(async (ctx) =>
        String((await ctx.db.get("bag", seed.aliceBag.bagId))?.storeFrontUserId),
      ),
    ).resolves.toBe(String(seed.alice));
  });

  it("bag.updateOwner refuses a guest session from another store", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedTwoShoppers(t);
    const account = await accountIn(t, seed.storeId, "cross-store@test");

    // A guest with a bag in the OTHER store, granted to this account anyway:
    // the store bound is kept on top of the grant, not replaced by it.
    const stranger = await t.run(async (ctx) => {
      const organizationId = (await ctx.db.get("store", seed.storeId))!
        .organizationId;
      const guestId = await ctx.db.insert("guest", {
        marker: "cross-store",
        organizationId,
        storeId: seed.otherStoreId,
      });
      await ctx.db.insert("bag", {
        items: [],
        storeFrontUserId: guestId,
        storeId: seed.otherStoreId,
        updatedAt: Date.now(),
      });
      return guestId;
    });
    await grantMerge(t, stranger, account);

    await expect(
      t.run((ctx) =>
        ctx.runMutation(internal.storeFront.bag.updateOwner, {
          currentOwner: stranger,
          owner: { storeFrontUserId: account, storeId: seed.storeId },
        }),
      ),
    ).rejects.toThrow(NOT_YOURS);
  });

  it("savedBag.create and savedBag.getByUserId refuse another shopper's id", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedTwoShoppers(t);
    const alice = { guestId: seed.alice, storeId: seed.storeId };

    await expect(
      t.run((ctx) =>
        ctx.runMutation(internal.storeFront.savedBag.create, {
          owner: alice,
          storeFrontUserId: seed.bob,
          storeId: seed.storeId,
        }),
      ),
    ).rejects.toThrow(NOT_YOURS);

    await expect(
      t.run((ctx) =>
        ctx.runQuery(internal.storeFront.savedBag.getByUserId, {
          owner: alice,
          storeFrontUserId: seed.bob,
        }),
      ),
    ).rejects.toThrow(NOT_YOURS);
  });

  it("savedBag.updateOwner refuses a guest row that carries no grant for the caller", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedTwoShoppers(t);
    const mallory = await accountIn(t, seed.storeId, "mallory2@test");
    await grantMerge(t, seed.alice, mallory);

    const bobSavedBag = await t.run((ctx) =>
      ctx.db.insert("savedBag", {
        items: [],
        storeFrontUserId: seed.bob,
        storeId: seed.storeId,
        updatedAt: Date.now(),
      }),
    );

    await expect(
      t.run((ctx) =>
        ctx.runMutation(internal.storeFront.savedBag.updateOwner, {
          currentOwner: seed.bob,
          owner: { storeFrontUserId: mallory, storeId: seed.storeId },
        }),
      ),
    ).rejects.toThrow(NOT_YOURS);

    await expect(
      t.run(async (ctx) =>
        String((await ctx.db.get("savedBag", bobSavedBag))?.storeFrontUserId),
      ),
    ).resolves.toBe(String(seed.bob));
  });

  it("savedBag.updateOwner merges a granted guest session", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedTwoShoppers(t);
    const alice = await accountIn(t, seed.storeId, "alice-saved@test");
    await grantMerge(t, seed.alice, alice);

    await t.run((ctx) =>
      ctx.db.insert("savedBag", {
        items: [],
        storeFrontUserId: seed.alice,
        storeId: seed.storeId,
        updatedAt: Date.now(),
      }),
    );

    const merged = await t.run((ctx) =>
      ctx.runMutation(internal.storeFront.savedBag.updateOwner, {
        currentOwner: seed.alice,
        owner: { storeFrontUserId: alice, storeId: seed.storeId },
      }),
    );

    expect(String(merged?.storeFrontUserId)).toBe(String(alice));
  });

  /**
   * The five merges the storefront fires after ONE sign-in must all succeed
   * under ONE grant — single-use is per merge kind, not per grant. This is the
   * regression a naive "clear the grant on first success" would cause: four of
   * the five would start failing in production.
   */
  it("one grant covers all five merges, and none of them twice", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedTwoShoppers(t);
    const account = await accountIn(t, seed.storeId, "five-merges@test");
    await grantMerge(t, seed.alice, account);

    await t.run((ctx) =>
      ctx.db.insert("savedBag", {
        items: [],
        storeFrontUserId: seed.alice,
        storeId: seed.storeId,
        updatedAt: Date.now(),
      }),
    );

    const owner = { storeFrontUserId: account, storeId: seed.storeId };

    await t.run((ctx) =>
      ctx.runMutation(internal.storeFront.bag.updateOwner, {
        currentOwner: seed.alice,
        owner,
      }),
    );
    await t.run((ctx) =>
      ctx.runMutation(internal.storeFront.savedBag.updateOwner, {
        currentOwner: seed.alice,
        owner,
      }),
    );
    await t.run((ctx) =>
      ctx.runMutation(internal.storeFront.onlineOrder.updateOwnerInternal, {
        currentOwner: seed.alice,
        owner,
      }),
    );
    await t.run((ctx) =>
      ctx.runMutation(internal.storeFront.analytics.updateOwnerInternal, {
        guestId: seed.alice,
        owner,
      }),
    );
    await t.run((ctx) =>
      ctx.runMutation(
        internal.storeFront.rewards.awardPointsForGuestOrdersInternal,
        { storeFrontUserId: account, guestId: seed.alice, owner },
      ),
    );

    // All five kinds consumed, so every one of them is now a replay.
    await expect(
      t.run(async (ctx) =>
        (await ctx.db.get("guest", seed.alice))?.mergeGrantConsumedBy?.slice()
          .sort(),
      ),
    ).resolves.toEqual([
      "analytics",
      "bag",
      "onlineOrder",
      "rewards",
      "savedBag",
    ]);

    await expect(
      t.run((ctx) =>
        ctx.runMutation(internal.storeFront.onlineOrder.updateOwnerInternal, {
          currentOwner: seed.alice,
          owner,
        }),
      ),
    ).rejects.toThrow(NOT_YOURS);
  });

  it("savedBag.updateOwner refuses a guest session from another store", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedTwoShoppers(t);
    const account = await accountIn(t, seed.storeId, "cross-store-saved@test");

    const stranger = await t.run(async (ctx) => {
      const organizationId = (await ctx.db.get("store", seed.storeId))!
        .organizationId;
      const guestId = await ctx.db.insert("guest", {
        marker: "cross-store-saved",
        organizationId,
        storeId: seed.otherStoreId,
      });
      await ctx.db.insert("savedBag", {
        items: [],
        storeFrontUserId: guestId,
        storeId: seed.otherStoreId,
        updatedAt: Date.now(),
      });
      return guestId;
    });
    await grantMerge(t, stranger, account);

    await expect(
      t.run((ctx) =>
        ctx.runMutation(internal.storeFront.savedBag.updateOwner, {
          currentOwner: stranger,
          owner: { storeFrontUserId: account, storeId: seed.storeId },
        }),
      ),
    ).rejects.toThrow(NOT_YOURS);
  });

  it("user.getById and user.update refuse another shopper's row", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedTwoShoppers(t);
    const organizationId = await t.run(
      async (ctx) => (await ctx.db.get("store", seed.storeId))!.organizationId,
    );
    const [aliceUser, bobUser] = await t.run(async (ctx) => [
      await ctx.db.insert("storeFrontUser", {
        email: "alice@test",
        organizationId,
        storeId: seed.storeId,
      }),
      await ctx.db.insert("storeFrontUser", {
        email: "bob@test",
        organizationId,
        storeId: seed.storeId,
      }),
    ]);
    const alice = { storeFrontUserId: aliceUser, storeId: seed.storeId };

    await expect(
      t.run((ctx) =>
        ctx.runQuery(internal.storeFront.user.getById, {
          id: bobUser,
          owner: alice,
        }),
      ),
    ).rejects.toThrow(NOT_YOURS);

    await expect(
      t.run((ctx) =>
        ctx.runMutation(internal.storeFront.user.update, {
          firstName: "Mallory",
          id: bobUser,
          owner: alice,
        }),
      ),
    ).rejects.toThrow(NOT_YOURS);

    // Alice's own row still updates, and only inside her own store.
    await t.run((ctx) =>
      ctx.runMutation(internal.storeFront.user.update, {
        firstName: "Alice",
        id: aliceUser,
        owner: alice,
      }),
    );
    await expect(
      t.run(async (ctx) =>
        (await ctx.db.get("storeFrontUser", aliceUser))?.firstName,
      ),
    ).resolves.toBe("Alice");

    await expect(
      t.run((ctx) =>
        ctx.runMutation(internal.storeFront.user.update, {
          firstName: "Elsewhere",
          id: aliceUser,
          owner: { storeFrontUserId: aliceUser, storeId: seed.otherStoreId },
        }),
      ),
    ).rejects.toThrow(NOT_YOURS);
  });

  it("guest.update refuses to patch another guest's row", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedTwoShoppers(t);

    await expect(
      t.run((ctx) =>
        ctx.runMutation(internal.storeFront.guest.update, {
          firstName: "Mallory",
          id: seed.bob,
          owner: { guestId: seed.alice, storeId: seed.storeId },
        }),
      ),
    ).rejects.toThrow(NOT_YOURS);

    // Right guest, wrong store: the row's own store has to match too.
    await expect(
      t.run((ctx) =>
        ctx.runMutation(internal.storeFront.guest.update, {
          firstName: "Alice",
          id: seed.alice,
          owner: { guestId: seed.alice, storeId: seed.otherStoreId },
        }),
      ),
    ).rejects.toThrow(NOT_YOURS);
  });

  it("auth.verifyCodeInternal refuses a userId that is not the admitted one", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedTwoShoppers(t);
    const organizationId = await t.run(
      async (ctx) => (await ctx.db.get("store", seed.storeId))!.organizationId,
    );

    await expect(
      t.run((ctx) =>
        ctx.runMutation(internal.storeFront.auth.verifyCodeInternal, {
          code: "123456",
          email: "bob@test",
          organizationId,
          owner: { guestId: seed.alice, storeId: seed.storeId },
          storeId: seed.storeId,
          userId: seed.bob,
        }),
      ),
    ).rejects.toThrow(NOT_YOURS);

    // Right shopper, wrong store.
    await expect(
      t.run((ctx) =>
        ctx.runMutation(internal.storeFront.auth.verifyCodeInternal, {
          code: "123456",
          email: "alice@test",
          organizationId,
          owner: { guestId: seed.alice, storeId: seed.otherStoreId },
          storeId: seed.storeId,
          userId: seed.alice,
        }),
      ),
    ).rejects.toThrow(NOT_YOURS);
  });
});

/* ------------------------------------------------ explicit server-initiated */

/**
 * The two call sites where no customer actor exists. `owner` is still required
 * there — it just accepts `SERVER_INITIATED_OWNER`, so "no ownership check
 * here" is a visible argument rather than an omitted one.
 */
describe("SERVER_INITIATED_OWNER", () => {
  it("guest.getById reads without a check for the sentinel, and asserts otherwise", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedTwoShoppers(t);

    // The public `GET /guests` bootstrap path: no admitted owner exists.
    // This is the accepted IDOR on the guest record — Bob's row comes back.
    await expect(
      t.run((ctx) =>
        ctx.runQuery(internal.storeFront.guest.getById, {
          id: seed.bob,
          owner: SERVER_INITIATED_OWNER,
        }),
      ),
    ).resolves.toMatchObject({ marker: "bob" });

    // A REAL claim is still asserted: the sentinel is the only thing that skips.
    await expect(
      t.run((ctx) =>
        ctx.runQuery(internal.storeFront.guest.getById, {
          id: seed.bob,
          owner: { guestId: seed.alice, storeId: seed.storeId },
        }),
      ),
    ).rejects.toThrow(NOT_YOURS);
  });

  it("offers.createInternal mints a server-initiated offer, but asserts a real claim", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedTwoShoppers(t);
    const promoCodeId = await t.run(async (ctx) => {
      const athenaUserId = (
        await ctx.db.query("athenaUser").first()
      )!._id;
      return ctx.db.insert("promoCode", {
        active: true,
        code: "FIRSTREVIEW",
        createdByUserId: athenaUserId,
        discountType: "percentage",
        discountValue: 10,
        displayText: "10% off",
        span: "entire-order",
        storeId: seed.storeId,
        validFrom: Date.now() - 1000,
        validTo: Date.now() + 1_000_000,
      });
    });

    // The first-review reward flow in `reviews.ts`: no customer actor at all.
    await expect(
      t.run((ctx) =>
        ctx.runMutation(internal.storeFront.offers.createInternal, {
          email: "bob@test",
          owner: SERVER_INITIATED_OWNER,
          promoCodeId,
          storeFrontUserId: seed.bob,
          storeId: seed.storeId,
        }),
      ),
    ).resolves.toBeDefined();

    // A real claim is still checked: Alice cannot mint an offer for Bob.
    await expect(
      t.run((ctx) =>
        ctx.runMutation(internal.storeFront.offers.createInternal, {
          email: "bob@test",
          owner: { guestId: seed.alice, storeId: seed.storeId },
          promoCodeId,
          storeFrontUserId: seed.bob,
          storeId: seed.storeId,
        }),
      ),
    ).rejects.toThrow(NOT_YOURS);
  });
});

/* --------------------------------------------------------- guest backfill */

describe("guest storeId backfill", () => {
  async function seedGuests(t: ReturnType<typeof convexTest>) {
    return t.run(async (ctx) => {
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
      const otherStoreId = await ctx.db.insert("store", {
        createdByUserId: athenaUserId,
        currency: "GHS",
        name: "other",
        organizationId,
        slug: "other",
      });

      // Resolvable: has a bag in `storeId`.
      const withBag = await ctx.db.insert("guest", { marker: "with-bag" });
      await ctx.db.insert("bag", {
        items: [],
        storeFrontUserId: withBag,
        storeId,
        updatedAt: Date.now(),
      });

      // Unresolvable: no related row anywhere.
      const orphan = await ctx.db.insert("guest", { marker: "orphan" });

      // Conflicted: bags in two different stores.
      const conflicted = await ctx.db.insert("guest", { marker: "conflict" });
      await ctx.db.insert("bag", {
        items: [],
        storeFrontUserId: conflicted,
        storeId,
        updatedAt: Date.now(),
      });
      await ctx.db.insert("bag", {
        items: [],
        storeFrontUserId: conflicted,
        storeId: otherStoreId,
        updatedAt: Date.now(),
      });

      return { conflicted, orphan, otherStoreId, storeId, withBag };
    });
  }

  it("derives a store only from an authoritative related row", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedGuests(t);

    await t.run((ctx) =>
      ctx.runMutation(internal.storeFront.guestStoreIdBackfill.backfillGuestStoreId, {
        dryRun: false,
        limit: 100,
      }),
    );

    const rows = await t.run(async (ctx) => ({
      conflicted: (await ctx.db.get("guest", seed.conflicted))?.storeId,
      orphan: (await ctx.db.get("guest", seed.orphan))?.storeId,
      withBag: (await ctx.db.get("guest", seed.withBag))?.storeId,
    }));

    expect(rows.withBag).toBe(seed.storeId);
    // Refusals, not guesses: an unresolvable or ambiguous guest stays unset and
    // therefore stays denied. A wrong store would be worse than a denial.
    expect(rows.orphan ?? undefined).toBeUndefined();
    expect(rows.conflicted ?? undefined).toBeUndefined();
  });

  it("defaults to a dry run and changes nothing", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedGuests(t);

    const result = await t.run((ctx) =>
      ctx.runMutation(internal.storeFront.guestStoreIdBackfill.backfillGuestStoreId, {
        limit: 100,
      }),
    );

    expect(result).toMatchObject({ changedCount: 1, dryRun: true });
    await expect(
      t.run(
        async (ctx) =>
          (await ctx.db.get("guest", seed.withBag))?.storeId ?? null,
      ),
    ).resolves.toBeNull();
  });

  it("converges: a second run has nothing left to resolve", async () => {
    const t = convexTest(schema, modules);
    await seedGuests(t);

    const run = () =>
      t.run((ctx) =>
        ctx.runMutation(
          internal.storeFront.guestStoreIdBackfill.backfillGuestStoreId,
          { dryRun: false, limit: 100 },
        ),
      );

    await run();
    expect(await run()).toMatchObject({ changedCount: 0, conflictedCount: 1 });

    await expect(
      t.run((ctx) =>
        ctx.runQuery(
          internal.storeFront.guestStoreIdBackfill.verifyGuestStoreId,
          { limit: 100 },
        ),
      ),
    ).resolves.toMatchObject({
      conflictedCount: 1,
      missingCount: 2,
      resolvableCount: 0,
      unresolvedCount: 1,
    });
  });
});

/**
 * The same grant bound on the two merges that were left store-only.
 *
 * `analytics.updateOwnerInternal` and `rewards.awardPointsForGuestOrdersInternal`
 * proved the guest row belonged to the admitted STORE and stopped there, so any
 * signed-in shopper could name a stranger's guest id and absorb their browsing
 * history — and, in the rewards case, the transferable points attached to it.
 * Both now require a server-issued grant naming the caller's account, on the
 * guest row itself.
 */
describe("guest merge grant bound", () => {
  async function mallorySeed(email: string) {
    const t = convexTest(schema, modules);
    const seed = await seedTwoShoppers(t);
    const mallory = await t.run(async (ctx) =>
      ctx.db.insert("storeFrontUser", {
        email,
        organizationId: (await ctx.db.get("store", seed.storeId))!
          .organizationId,
        storeId: seed.storeId,
      }),
    );
    // Mallory signed in, so HER guest session carries a grant. Bob's does not.
    await t.run((ctx) =>
      ctx.db.patch("guest", seed.alice, {
        mergeGrantedToStoreFrontUserId: mallory,
        mergeGrantExpiresAt: Date.now() + 15 * 60 * 1000,
        mergeGrantConsumedBy: [],
      }),
    );
    return {
      t,
      seed,
      mallory,
      owner: { storeFrontUserId: mallory, storeId: seed.storeId },
    };
  }

  it("analytics.updateOwnerInternal refuses a guest row with no grant for the caller", async () => {
    const { t, seed, owner } = await mallorySeed("mallory-analytics@test");

    await expect(
      t.run((ctx) =>
        ctx.runMutation(internal.storeFront.analytics.updateOwnerInternal, {
          guestId: seed.bob,
          owner,
        }),
      ),
    ).rejects.toThrow(NOT_YOURS);

    // Her OWN granted guest session still merges — the real flow is not broken.
    await expect(
      t.run((ctx) =>
        ctx.runMutation(internal.storeFront.analytics.updateOwnerInternal, {
          guestId: seed.alice,
          owner,
        }),
      ),
    ).resolves.not.toThrow();
  });

  it("rewards.awardPointsForGuestOrdersInternal refuses a guest row with no grant for the caller", async () => {
    const { t, seed, mallory, owner } = await mallorySeed(
      "mallory-rewards@test",
    );

    await expect(
      t.run((ctx) =>
        ctx.runMutation(
          internal.storeFront.rewards.awardPointsForGuestOrdersInternal,
          { storeFrontUserId: mallory, guestId: seed.bob, owner },
        ),
      ),
    ).rejects.toThrow(NOT_YOURS);

    // An EXPIRED grant on her own guest session is refused too.
    await t.run((ctx) =>
      ctx.db.patch("guest", seed.alice, {
        mergeGrantExpiresAt: Date.now() - 1,
      }),
    );

    await expect(
      t.run((ctx) =>
        ctx.runMutation(
          internal.storeFront.rewards.awardPointsForGuestOrdersInternal,
          { storeFrontUserId: mallory, guestId: seed.alice, owner },
        ),
      ),
    ).rejects.toThrow(NOT_YOURS);
  });
});
