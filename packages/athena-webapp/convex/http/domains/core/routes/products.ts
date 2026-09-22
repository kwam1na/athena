import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { internal } from "../../../../_generated/api";
import { Id } from "../../../../_generated/dataModel";
import {
  getProductRouteReadDefinition,
  listBestSellersRouteReadDefinition,
  listFeaturedProductsRouteReadDefinition,
  listProductColorsRouteReadDefinition,
  listProductsRouteReadDefinition,
} from "../../../../operationAdmission/domains/httpCore_readDefinitions";
import { admitHttpRead } from "../../../../platform/operationAdmission";
import {
  projectPublicCatalogBestSellers,
  projectPublicCatalogFeaturedItems,
  projectPublicCatalogProduct,
  projectPublicCatalogProducts,
} from "../../../../storeFront/publicCatalog";
import { getStoreDataFromRequest } from "../../../utils";

const productRoutes: HonoWithConvex<ActionCtx> = new Hono();

/**
 * The catalogue reads below answer anonymous shoppers, so every response is
 * projected to the public catalogue shape after the read. The list read goes
 * through a Valkey cache, and projecting here rather than inside the cached
 * action means a cache hit is projected exactly like a miss.
 */

productRoutes.get(
  "/",
  admitHttpRead(listProductsRouteReadDefinition, async (c) => {
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
      internal.inventory.productUtil.getAllProducts,
      {
        storeId: storeId as Id<"store">,
        color: colors,
        length: lengths,
        category: categories,
        subcategory: subcategories,
        isVisible: isVisible,
        excludeStorefrontHidden: isVisible,
      },
    );

    return c.json({ products: projectPublicCatalogProducts(products) });
  }),
);

productRoutes.get(
  "/colors",
  admitHttpRead(listProductColorsRouteReadDefinition, async (c) => {
    const { storeId } = getStoreDataFromRequest(c);

    if (!storeId) {
      return c.json({ error: "Store id missing" }, 404);
    }

    return c.json({});
  }),
);

productRoutes.get(
  "/bestSellers",
  admitHttpRead(listBestSellersRouteReadDefinition, async (c) => {
    const { storeId } = getStoreDataFromRequest(c);

    if (!storeId) {
      return c.json({ error: "Store id missing" }, 404);
    }

    const res = await c.env.runQuery(
      internal.inventory.bestSeller.getAllInternal,
      {
        storeId: storeId as Id<"store">,
        isVisible: true,
      },
    );

    return c.json(projectPublicCatalogBestSellers(res));
  }),
);

productRoutes.get(
  "/featured",
  admitHttpRead(listFeaturedProductsRouteReadDefinition, async (c) => {
    const { storeId } = getStoreDataFromRequest(c);

    if (!storeId) {
      return c.json({ error: "Store id missing" }, 404);
    }

    const res = await c.env.runQuery(
      internal.inventory.featuredItem.getAllInternal,
      {
        storeId: storeId as Id<"store">,
      },
    );

    return c.json(projectPublicCatalogFeaturedItems(res));
  }),
);

productRoutes.get(
  "/:productId",
  admitHttpRead(getProductRouteReadDefinition, async (c) => {
    const { storeId } = getStoreDataFromRequest(c);
    const { productId } = c.req.param();

    const params = c.req.queries();

    if (!storeId) {
      return c.json({ error: "Store id missing" }, 404);
    }

    const product = await c.env.runQuery(
      internal.inventory.products.getByIdOrSlugInternal,
      {
        identifier: productId,
        storeId: storeId as Id<"store">,
        filters: {
          isVisible: !!params.isVisible,
          excludeStorefrontHidden: !!params.isVisible,
        },
      },
    );

    if (!product) {
      return c.json({ error: "Product with identifier not found" }, 400);
    }

    return c.json(projectPublicCatalogProduct(product));
  }),
);

export { productRoutes };
