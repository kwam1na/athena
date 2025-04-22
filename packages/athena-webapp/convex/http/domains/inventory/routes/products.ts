import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { api } from "../../../../_generated/api";
import { Id } from "../../../../_generated/dataModel";
import { getStoreDataFromRequest } from "../../../utils";

const productRoutes: HonoWithConvex<ActionCtx> = new Hono();

productRoutes.get("/", async (c) => {
  const params = c.req.queries();

  const { storeId } = getStoreDataFromRequest(c);

  if (!storeId) {
    return c.json({ error: "Store id missing" }, 404);
  }

  const colors = params.color?.[0]?.split(",") as Id<"color">[];
  const lengths = params.length?.[0]?.split(",").map((l) => parseInt(l));
  const categories = params.category?.[0]?.split(",").map((s) => s);
  const subcategories = params.subcategory?.[0]?.split(",").map((s) => s);
  const isVisible = params.isVisible?.[0] === "true";

  const products = await c.env.runAction(
    api.inventory.productUtil.getAllProducts,
    {
      storeId: storeId as Id<"store">,
      color: colors,
      length: lengths,
      category: categories,
      subcategory: subcategories,
      isVisible: isVisible,
    }
  );

  return c.json({ products });
});

productRoutes.get("/colors", async (c) => {
  const { storeId } = getStoreDataFromRequest(c);

  if (!storeId) {
    return c.json({ error: "Store id missing" }, 404);
  }

  console.log("hit colors...");

  return c.json({});
});

productRoutes.get("/bestSellers", async (c) => {
  const { storeId } = getStoreDataFromRequest(c);

  if (!storeId) {
    return c.json({ error: "Store id missing" }, 404);
  }

  const res = await c.env.runQuery(api.inventory.bestSeller.getAll, {
    storeId: storeId as Id<"store">,
  });

  return c.json(res);
});

productRoutes.get("/featured", async (c) => {
  const { storeId } = getStoreDataFromRequest(c);

  if (!storeId) {
    return c.json({ error: "Store id missing" }, 404);
  }

  const res = await c.env.runQuery(api.inventory.featuredItem.getAll, {
    storeId: storeId as Id<"store">,
  });

  return c.json(res);
});

productRoutes.get("/:productId", async (c) => {
  const { storeId } = getStoreDataFromRequest(c);
  const { productId } = c.req.param();

  const params = c.req.queries();

  if (!storeId) {
    return c.json({ error: "Store id missing" }, 404);
  }

  const product = await c.env.runQuery(api.inventory.products.getByIdOrSlug, {
    identifier: productId,
    storeId: storeId as Id<"store">,
    filters: {
      isVisible: !!params.isVisible,
    },
  });

  if (!product) {
    return c.json({ error: "Product with identifier not found" }, 400);
  }

  return c.json(product);
});

export { productRoutes };
