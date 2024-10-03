import { Hono } from "hono";
import { productsRepository } from "@athena/db";

const productRoutes = new Hono();

productRoutes.post("/", async (c) => {
  const data = await c.req.json();

  const newCategory = await productsRepository.create(data);

  return c.json(newCategory, 201);
});

productRoutes.get("/", async (c) => {
  const storeId = c.req.param("storeId");

  const slug = c.req.query("slug");

  const products = await productsRepository.getAll(parseInt(storeId!));

  return c.json({ products });
});

productRoutes.put("/:productId", async (c) => {
  const { productId } = c.req.param();

  const data = await c.req.json();

  const updatedProduct = await productsRepository.update(
    parseInt(productId),
    data
  );

  return updatedProduct
    ? c.json(updatedProduct)
    : c.json({ error: "Yuhh, Not found" }, 404);
});

productRoutes.post("/:productId/skus", async (c) => {
  const { productId } = c.req.param();
  const data = await c.req.json();

  try {
    const newSku = await productsRepository.createSku({
      ...data,
      productId: parseInt(productId),
    });
    return c.json(newSku, 201);
  } catch (error) {
    if (error instanceof Error) {
      return c.json({ error: error.message }, 400);
    }
    return c.json({ error: "An unexpected error occurred" }, 500);
  }
});

productRoutes.put("/:productId/skus/:skuId", async (c) => {
  const { skuId } = c.req.param();

  const data = await c.req.json();

  const updatedSKU = await productsRepository.updateSku(parseInt(skuId), data);

  return updatedSKU
    ? c.json(updatedSKU)
    : c.json({ error: "Yuhh, Not found" }, 404);
});

productRoutes.get("/:productId", async (c) => {
  const { productId } = c.req.param();

  const id = parseInt(productId);

  let product;

  if (isNaN(id)) {
    product = await productsRepository.getBySlug(productId);
  } else {
    product = await productsRepository.getById(id);
  }

  return product
    ? c.json(product)
    : c.json({ error: "Product not found" }, 404);
});

productRoutes.delete("/:productId", async (c) => {
  const { productId } = c.req.param();
  const result = await productsRepository.delete(parseInt(productId));
  return result
    ? c.json({ message: "Deleted" })
    : c.json({ error: "Not found" }, 404);
});

productRoutes.delete("/", async (c) => {
  const storeId = c.req.param("storeId");

  const result = await productsRepository.deleteAllByStoreId(
    parseInt(storeId!)
  );

  return result
    ? c.json({ message: "Deleted" })
    : c.json({ error: "No products to delete" }, 404);
});

export { productRoutes };
