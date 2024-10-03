import { db } from "../../index";
import { and, eq } from "drizzle-orm";
import { bagItems } from "../../models/schema";

export const bagItemRepository = {
  // Add an item to a bag
  addItemToBag: async ({
    bagId,
    productId,
    customerId,
    quantity,
    price,
  }: {
    bagId: number;
    productId: number;
    customerId: number;
    quantity: number;
    price: number;
  }) => {
    const newItem = {
      bagId,
      productId,
      customerId,
      quantity,
      price,
    };

    const res = await db.insert(bagItems).values(newItem).returning();

    return res[0];
  },

  // Update an item in a bag
  updateItemInBag: async ({
    bagId,
    itemId,
    quantity,
  }: {
    bagId: number;
    itemId: number;
    quantity: number;
  }) => {
    const res = await db
      .update(bagItems)
      .set({ quantity })
      .where(and(eq(bagItems.bagId, bagId), eq(bagItems.id, itemId)))
      .returning();

    return res[0];
  },

  // Delete an item from a bag
  deleteItemFromBag: async ({
    bagId,
    itemId,
  }: {
    bagId: number;
    itemId: number;
  }) => {
    const res = await db
      .delete(bagItems)
      .where(and(eq(bagItems.bagId, bagId), eq(bagItems.id, itemId)))
      .returning();

    return res[0];
  },

  // Get a specific item by its ID
  getItemByProductId: async ({
    bagId,
    productId,
  }: {
    bagId: number;
    productId: number;
  }) => {
    const res = await db
      .select()
      .from(bagItems)
      .where(and(eq(bagItems.productId, productId), eq(bagItems.bagId, bagId)));

    return res[0];
  },

  // Get all items in a specific bag
  getItemsInBag: async (bagId: number) => {
    return await db.select().from(bagItems).where(eq(bagItems.bagId, bagId));
  },
};
