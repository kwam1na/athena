import { Hono } from "hono";
import { bagRepository, bagItemRepository } from "@athena/db";

const bagRoutes = new Hono();

// Get all bags
bagRoutes.get("/", async (c) => {
  const bags = await bagRepository.getAll();
  return c.json({ bags });
});

// Get a specific bag
bagRoutes.get("/:bagId", async (c) => {
  const { bagId } = c.req.param();

  if (bagId == "active") {
    const customerId = c.req.param("customerId");
    const bag = await bagRepository.getByCustomerId(parseInt(customerId!));

    if (!bag) {
      const newBag = await bagRepository.create(parseInt(customerId!));
      return c.json(newBag);
    }

    return c.json(bag);
  }

  const bag = await bagRepository.getById(parseInt(bagId));
  return bag ? c.json(bag) : c.json({ error: "Bag not found" }, 404);
});

// Create a new bag
bagRoutes.post("/", async (c) => {
  const { customerId } = await c.req.json();
  const newBag = await bagRepository.create(customerId);
  return c.json(newBag, 201);
});

// Delete a bag
bagRoutes.delete("/:bagId", async (c) => {
  const { bagId } = c.req.param();
  const result = await bagRepository.delete(parseInt(bagId));
  return result.length > 0
    ? c.json({ message: "Bag deleted" })
    : c.json({ error: "Bag not found" }, 404);
});

// Get all items in a bag
bagRoutes.get("/:bagId/items", async (c) => {
  const { bagId } = c.req.param();
  const items = await bagRepository.getItemsInBag(parseInt(bagId));
  return c.json({ items });
});

// Add an item to a bag
// bagRoutes.post("/:bagId/items", async (c) => {
//   const { bagId } = c.req.param();
//   const { productId, customerId, quantity, price } = await c.req.json();
//   const newItem = await bagItemRepository.addItemToBag({
//     bagId: parseInt(bagId),
//     productId,
//     customerId,
//     quantity,
//     price,
//   });
//   return c.json(newItem, 201);
// });

bagRoutes.post("/:bagId/items", async (c) => {
  const { bagId } = c.req.param();
  const { productId, customerId, quantity, price } = await c.req.json();

  // Check if the item is already in the bag
  const existingItem = await bagItemRepository.getItemByProductId({
    bagId: parseInt(bagId),
    productId,
  });

  if (existingItem) {
    // If the item exists, update the quantity
    const updatedItem = await bagItemRepository.updateItemInBag({
      bagId: parseInt(bagId),
      itemId: existingItem.id,
      quantity: existingItem.quantity + quantity, // Add to existing quantity
    });
    return c.json(updatedItem, 200);
  } else {
    // If the item doesn't exist, create a new item in the bag
    const newItem = await bagItemRepository.addItemToBag({
      bagId: parseInt(bagId),
      productId,
      customerId,
      quantity,
      price,
    });
    return c.json(newItem, 201);
  }
});

// Update an item in a bag
bagRoutes.put("/:bagId/items/:itemId", async (c) => {
  const { bagId, itemId } = c.req.param();
  const { quantity } = await c.req.json();
  const updatedItem = await bagItemRepository.updateItemInBag({
    bagId: parseInt(bagId),
    itemId: parseInt(itemId),
    quantity,
  });
  return updatedItem
    ? c.json(updatedItem)
    : c.json({ error: "Item not found" }, 404);
});

// Delete an item from a bag
bagRoutes.delete("/:bagId/items/:itemId", async (c) => {
  const { bagId, itemId } = c.req.param();
  const result = await bagItemRepository.deleteItemFromBag({
    bagId: parseInt(bagId),
    itemId: parseInt(itemId),
  });
  return result
    ? c.json({ message: "Item removed from bag" })
    : c.json({ error: "Item not found" }, 404);
});

export { bagRoutes };
