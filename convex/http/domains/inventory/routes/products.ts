import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { api } from "../../../../_generated/api";
import { Id } from "../../../../_generated/dataModel";

const productRoutes: HonoWithConvex<ActionCtx> = new Hono();

productRoutes.post("/", async (c) => {
  const data = await c.req.json();

  return c.json({});
});

productRoutes.get("/", async (c) => {
  const storeId = c.req.param("storeId");

  if (!storeId) {
    return c.json({ error: "Store id missing" }, 404);
  }

  const products = await c.env.runQuery(api.inventory.products.getAll, {
    storeId: storeId as Id<"store">,
  });

  return c.json({ products });
});

productRoutes.get("/:productId", async (c) => {
  const storeId = c.req.param("storeId");
  const { productId } = c.req.param();

  if (!storeId) {
    return c.json({ error: "Store id missing" }, 404);
  }

  const product = await c.env.runQuery(api.inventory.products.getByIdOrSlug, {
    identifier: productId,
    storeId: storeId as Id<"store">,
  });

  if (!product) {
    return c.json({ error: "Product with identifier not found" }, 400);
  }

  return c.json(product);
});

productRoutes.put("/:productId", async (c) => {
  const storeId = c.req.param("storeId");
  const { productId } = c.req.param();

  return c.json({});
});

productRoutes.post("/:productId/skus", async (c) => {
  const { productId } = c.req.param();
  const data = await c.req.json();

  return c.json({});
});

productRoutes.put("/:productId/skus/:skuId", async (c) => {
  const { skuId } = c.req.param();

  const data = await c.req.json();

  return c.json({});
});

productRoutes.delete("/:productId", async (c) => {
  const { productId } = c.req.param();
  return c.json({});
});

productRoutes.delete("/", async (c) => {
  const storeId = c.req.param("storeId");

  return c.json({});
});

productRoutes.delete("/:productId/skus/:skuId", async (c) => {
  const { skuId } = c.req.param();

  return c.json({});
});

export { productRoutes };
