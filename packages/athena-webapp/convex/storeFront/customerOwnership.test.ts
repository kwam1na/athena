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
 * The second half of the file covers the guest-store backfill, which exists so
 * a legacy guest row can be clamped at all — and refuses to guess when it
 * cannot be.
 */

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";

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
   * The pre-B2 contract: these callees still have live route callers that pass
   * no `owner` yet, so an absent claim must keep the old behaviour rather than
   * fail closed and break the storefront mid-wave.
   */
  it("keeps pre-migration behaviour when no owner is propagated yet", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedTwoShoppers(t);

    await expect(
      t.run((ctx) =>
        ctx.runMutation(internal.storeFront.bagItem.updateItemInBag, {
          itemId: seed.bobBag.itemId,
          quantity: 7,
        }),
      ),
    ).resolves.toBeDefined();
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
