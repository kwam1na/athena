import { db, type BagItemPreview } from "../../index";
import { desc, eq } from "drizzle-orm";
import { bags, bagItems, products } from "../../models/schema";

export const bagRepository = {
  // Get all bags
  getAll: async () => {
    return await db.select().from(bags);
  },

  // Get a bag by ID (including its items)
  getById: async (id: number) => {
    // Fetch the bag
    const bagRes = await db.select().from(bags).where(eq(bags.id, id));
    const bag = bagRes[0];

    if (!bag) {
      return null; // Return null if no bag is found
    }

    // Fetch associated bag items
    const items = await db
      .select({
        id: bagItems.id,
        bagId: bagItems.bagId,
        productId: bagItems.productId,
        quantity: bagItems.quantity,
        price: bagItems.price,
        addedAt: bagItems.addedAt,
        productName: products.name,
        productSlug: products.slug,
        productImage: products.images,
      })
      .from(bagItems)
      .leftJoin(products, eq(bagItems.productId, products.id))
      .where(eq(bagItems.bagId, bag.id))
      .orderBy(desc(bagItems.addedAt));

    const itemsWithFirstImage = items.map((item) => ({
      ...item,
      productImage: item.productImage?.[0] ?? null,
    }));

    return {
      ...bag,
      items: itemsWithFirstImage,
    };
  },

  // Get a bag by customer ID (including its items)
  getByCustomerId: async (customerId: number) => {
    // Fetch the bag for the customer
    const bagRes = await db
      .select()
      .from(bags)
      .where(eq(bags.customerId, customerId));

    const bag = bagRes[0];

    if (!bag) {
      return null; // Return null if no bag is found
    }

    const items = await db
      .select({
        id: bagItems.id,
        bagId: bagItems.bagId,
        productId: bagItems.productId,
        quantity: bagItems.quantity,
        price: bagItems.price,
        addedAt: bagItems.addedAt,
        productName: products.name,
        productSlug: products.slug,
        productImage: products.images,
      })
      .from(bagItems)
      .leftJoin(products, eq(bagItems.productId, products.id))
      .where(eq(bagItems.bagId, bag.id))
      .orderBy(desc(bagItems.addedAt));

    const itemsWithFirstImage = items.map((item) => ({
      ...item,
      productImage: item.productImage?.[0] ?? null,
    }));

    return {
      ...bag,
      items: itemsWithFirstImage,
    };
  },

  // Create a new bag
  create: async (customerId: number) => {
    const newBag = {
      customerId,
    };

    const res = await db.insert(bags).values(newBag).returning();

    return {
      ...res[0],
      items: [] as BagItemPreview[],
    };
  },

  // Delete a bag and its associated items
  delete: async (id: number) => {
    // Delete all items associated with the bag first
    await db.delete(bagItems).where(eq(bagItems.bagId, id));

    // Delete the bag
    return await db.delete(bags).where(eq(bags.id, id)).returning();
  },

  // Get all items in a specific bag
  getItemsInBag: async (bagId: number) => {
    return await db.select().from(bagItems).where(eq(bagItems.bagId, bagId));
  },
};
