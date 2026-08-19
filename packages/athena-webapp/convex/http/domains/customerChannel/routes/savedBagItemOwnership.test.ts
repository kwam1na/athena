/// <reference types="vite/client" />

/**
 * Ownership contract for `convex/storeFront/savedBagItem.ts`.
 *
 * This lives with U10 rather than with the other `storeFront` tests because the
 * `owner` treatment on `savedBagItem` is U10's post-B1 patch: it is the exact
 * gap `bagItem.ts` closed in B1, on the twin module B1 left behind, and it is
 * reachable only through the `/savedBags/:bagId/items` routes this unit admits.
 *
 * The property under test is the one a bearer cookie cannot provide on its own:
 * a valid saved-bag or saved-bag-item id belonging to customer B must not be
 * usable by customer A, even when both shop the same store.
 */

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { internal } from "../../../../_generated/api";
import type { Id } from "../../../../_generated/dataModel";
import schema from "../../../../schema";
import { CUSTOMER_OWNERSHIP_DENIED } from "../../../../storeFront/customerOwnership";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../../../../**/*.ts")).map(
    ([path, loader]) => [path.replace(/^(\.\.\/){4}/, "./"), loader],
  ),
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
      price: 1000,
      productId,
      quantityAvailable: 10,
      sku: "SKU-1",
      storeId,
      unitCost: 100,
    });

    async function savedBagFor(owner: Id<"guest">) {
      const savedBagId = await ctx.db.insert("savedBag", {
        items: [],
        storeFrontUserId: owner,
        storeId,
        updatedAt: Date.now(),
      });
      const itemId = await ctx.db.insert("savedBagItem", {
        productId,
        productSku: "SKU-1",
        productSkuId,
        quantity: 1,
        savedBagId,
        storeFrontUserId: owner,
        updatedAt: Date.now(),
      });
      return { savedBagId, itemId };
    }

    return {
      alice,
      aliceBag: await savedBagFor(alice),
      bob,
      bobBag: await savedBagFor(bob),
      productId,
      productSkuId,
      storeId,
    };
  });

  return { t, ...fixture };
}

describe("savedBagItem ownership", () => {
  it("lets the admitted shopper act on their own saved bag", async () => {
    const f = await seed();
    const owner = { guestId: f.alice, storeId: f.storeId };

    await f.t.mutation(internal.storeFront.savedBagItem.addItemToBag, {
      owner,
      productId: f.productId,
      productSku: "SKU-1",
      productSkuId: f.productSkuId,
      quantity: 2,
      savedBagId: f.aliceBag.savedBagId,
      storeFrontUserId: f.alice,
    });

    await f.t.mutation(internal.storeFront.savedBagItem.updateItemInBag, {
      itemId: f.aliceBag.itemId,
      owner,
      quantity: 5,
    });

    const item = await f.t.run((ctx) =>
      ctx.db.get("savedBagItem", f.aliceBag.itemId),
    );
    expect(item?.quantity).toBe(5);

    await f.t.mutation(internal.storeFront.savedBagItem.deleteItemFromSavedBag, {
      itemId: f.aliceBag.itemId,
      owner,
    });
    expect(
      await f.t.run((ctx) => ctx.db.get("savedBagItem", f.aliceBag.itemId)),
    ).toBeNull();
  });

  it("refuses to insert into another shopper's saved bag", async () => {
    const f = await seed();

    await expect(
      f.t.mutation(internal.storeFront.savedBagItem.addItemToBag, {
        owner: { guestId: f.alice, storeId: f.storeId },
        productId: f.productId,
        productSku: "SKU-1",
        productSkuId: f.productSkuId,
        quantity: 1,
        // Bob's bag id is perfectly valid — possession of it proves nothing.
        savedBagId: f.bobBag.savedBagId,
        storeFrontUserId: f.alice,
      }),
    ).rejects.toThrow(DENIED);
  });

  it("refuses an item identity that is not the admitted shopper's", async () => {
    const f = await seed();

    await expect(
      f.t.mutation(internal.storeFront.savedBagItem.addItemToBag, {
        owner: { guestId: f.alice, storeId: f.storeId },
        productId: f.productId,
        productSku: "SKU-1",
        productSkuId: f.productSkuId,
        quantity: 1,
        savedBagId: f.aliceBag.savedBagId,
        // A forged body field cannot write someone else's id onto the row.
        storeFrontUserId: f.bob,
      }),
    ).rejects.toThrow(DENIED);
  });

  it("refuses to update or delete another shopper's saved bag item", async () => {
    const f = await seed();
    const owner = { guestId: f.alice, storeId: f.storeId };

    await expect(
      f.t.mutation(internal.storeFront.savedBagItem.updateItemInBag, {
        itemId: f.bobBag.itemId,
        owner,
        quantity: 99,
      }),
    ).rejects.toThrow(DENIED);

    await expect(
      f.t.mutation(internal.storeFront.savedBagItem.deleteItemFromSavedBag, {
        itemId: f.bobBag.itemId,
        owner,
      }),
    ).rejects.toThrow(DENIED);

    // Bob's row is untouched by either attempt.
    const item = await f.t.run((ctx) =>
      ctx.db.get("savedBagItem", f.bobBag.itemId),
    );
    expect(item?.quantity).toBe(1);
  });

  it("refuses a shopper whose claim was clamped to a different store", async () => {
    const f = await seed();

    await expect(
      f.t.mutation(internal.storeFront.savedBagItem.updateItemInBag, {
        itemId: f.aliceBag.itemId,
        // Right shopper, wrong store: the parent saved bag carries the store,
        // so both halves of the claim have to match.
        owner: { guestId: f.alice, storeId: f.bobBag.savedBagId as never },
        quantity: 3,
      }),
    ).rejects.toThrow();
  });
});
