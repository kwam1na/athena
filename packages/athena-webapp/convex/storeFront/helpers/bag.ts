import { Doc } from "../../_generated/dataModel";
import { QueryCtx } from "../../_generated/server";

const MAX_BAG_ITEMS = 200;
const MAX_BAG_ITEMS_PER_SKU = 500;

async function listBagItems(ctx: QueryCtx, bagId: Doc<"bag">["_id"]) {
  return await ctx.db
    .query("bagItem")
    .withIndex("by_bagId", (q) => q.eq("bagId", bagId))
    .take(MAX_BAG_ITEMS);
}

export async function loadBagWithItems(
  ctx: QueryCtx,
  bag: Doc<"bag">,
  options: { includeOtherBagsWithSku?: boolean } = {},
) {
  const items = await listBagItems(ctx, bag._id);

  const itemsWithProductDetails = await Promise.all(
    items.map(async (item) => {
      const [sku, product] = await Promise.all([
        ctx.db.get("productSku", item.productSkuId),
        ctx.db.get("product", item.productId),
      ]);

      let colorName: string | undefined;

      if (sku?.color) {
        const color = await ctx.db.get("color", sku.color);
        colorName = color?.name;
      }

      let category: string | undefined;

      if (product) {
        const productCategory = await ctx.db.get(
          "category",
          product.categoryId,
        );
        category = productCategory?.name;
      }

      let otherBagsWithSku: number | undefined;

      if (options.includeOtherBagsWithSku) {
        const otherBagItemsWithSameSku = await ctx.db
          .query("bagItem")
          .withIndex("by_productSkuId", (q) =>
            q.eq("productSkuId", item.productSkuId),
          )
          .take(MAX_BAG_ITEMS_PER_SKU);

        const uniqueOtherBagIds = new Set(
          otherBagItemsWithSameSku
            .filter((bagItem) => bagItem.bagId !== bag._id)
            .map((bagItem) => bagItem.bagId),
        );

        otherBagsWithSku = uniqueOtherBagIds.size;
      }

      return {
        ...item,
        price: sku?.price,
        length: sku?.length,
        size: sku?.size,
        colorName,
        productName: product?.name,
        productCategory: category,
        productImage: sku?.images?.[0],
        productSlug: product?.slug,
        ...(typeof otherBagsWithSku === "number" ? { otherBagsWithSku } : {}),
      };
    }),
  );

  return {
    ...bag,
    items: itemsWithProductDetails,
  };
}
