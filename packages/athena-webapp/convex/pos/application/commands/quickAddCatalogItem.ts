import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";
import { recordOperationalEventWithCtx } from "../../../operations/operationalEvents";
import { toSlug } from "../../../utils";

type CatalogResult = {
  id: Id<"productSku">;
  name: string;
  sku: string;
  barcode: string;
  price: number;
  category: string;
  description: string;
  inStock: boolean;
  quantityAvailable: number;
  image: string | null;
  size: string;
  length: number | null;
  color: string;
  productId: Id<"product">;
  skuId: Id<"productSku">;
  areProcessingFeesAbsorbed: boolean;
};

const QUICK_ADD_CATEGORY_NAME = "POS quick add";
const QUICK_ADD_CATEGORY_SLUG = "pos-quick-add";
const QUICK_ADD_SUBCATEGORY_NAME = "Uncategorized";
const QUICK_ADD_SUBCATEGORY_SLUG = "uncategorized";

async function findOrCreateQuickAddCategory(
  ctx: MutationCtx,
  storeId: Id<"store">,
) {
  const existingCategory = await ctx.db
    .query("category")
    .filter((q) =>
      q.and(
        q.eq(q.field("storeId"), storeId),
        q.eq(q.field("slug"), QUICK_ADD_CATEGORY_SLUG),
      ),
    )
    .first();

  if (existingCategory) {
    return existingCategory;
  }

  const categoryId = await ctx.db.insert("category", {
    name: QUICK_ADD_CATEGORY_NAME,
    slug: QUICK_ADD_CATEGORY_SLUG,
    storeId,
  });

  return (await ctx.db.get("category", categoryId))!;
}

async function findOrCreateQuickAddSubcategory(
  ctx: MutationCtx,
  args: {
    storeId: Id<"store">;
    categoryId: Id<"category">;
  },
) {
  const existingSubcategory = await ctx.db
    .query("subcategory")
    .filter((q) =>
      q.and(
        q.eq(q.field("storeId"), args.storeId),
        q.eq(q.field("categoryId"), args.categoryId),
        q.eq(q.field("slug"), QUICK_ADD_SUBCATEGORY_SLUG),
      ),
    )
    .first();

  if (existingSubcategory) {
    return existingSubcategory;
  }

  const subcategoryId = await ctx.db.insert("subcategory", {
    name: QUICK_ADD_SUBCATEGORY_NAME,
    slug: QUICK_ADD_SUBCATEGORY_SLUG,
    categoryId: args.categoryId,
    storeId: args.storeId,
  });

  return (await ctx.db.get("subcategory", subcategoryId))!;
}

async function mapSkuToCatalogResult(
  ctx: MutationCtx,
  args: {
    product: Doc<"product">;
    sku: Doc<"productSku">;
    categoryName?: string;
  },
): Promise<CatalogResult> {
  const category =
    args.categoryName ??
    (await ctx.db.get("category", args.product.categoryId))?.name ??
    "";

  const color = args.sku.color
    ? ((await ctx.db.get("color", args.sku.color))?.name ?? "")
    : "";

  return {
    id: args.sku._id,
    name: args.product.name,
    sku: args.sku.sku || "",
    barcode: args.sku.barcode || "",
    price: args.sku.netPrice || args.sku.price,
    category,
    description: args.product.description || "",
    inStock: args.sku.quantityAvailable > 0,
    quantityAvailable: args.sku.quantityAvailable,
    image: args.sku.images?.[0] || null,
    size: args.sku.size || "",
    length: args.sku.length || null,
    color,
    productId: args.product._id,
    skuId: args.sku._id,
    areProcessingFeesAbsorbed: args.product.areProcessingFeesAbsorbed || false,
  };
}

async function findExistingSku(
  ctx: MutationCtx,
  args: {
    storeId: Id<"store">;
    lookupCode?: string;
  },
) {
  const lookupCode = args.lookupCode?.trim();
  if (!lookupCode) {
    return null;
  }

  if (!isBarcodeLike(lookupCode)) {
    return null;
  }

  return ctx.db
    .query("productSku")
    .withIndex("by_storeId_barcode", (q) =>
      q.eq("storeId", args.storeId).eq("barcode", lookupCode),
    )
    .first();
}

function isBarcodeLike(value: string): boolean {
  return /^[\d\s-]+$/.test(value);
}

function generateSKU({
  storeId,
  productId,
  skuId,
}: {
  storeId: string;
  productId: string;
  skuId: string;
}): string {
  const encodeBase36 = (id: string, length: number) => {
    const subset = id.substring(id.length - length);
    return parseInt(subset, 36).toString(36).toUpperCase();
  };

  const storeCode = encodeBase36(storeId, 4);
  const productCode = encodeBase36(productId, 3);
  const skuCode = encodeBase36(skuId, 3);

  return `${storeCode}-${productCode}-${skuCode}`;
}

function getActorLabel(user: Doc<"athenaUser"> | null, fallbackId: string) {
  const fullName = [user?.firstName, user?.lastName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");

  return fullName || user?.email?.trim() || fallbackId;
}

function buildQuickAddEventMessage(args: {
  actorLabel: string;
  eventType:
    | "pos_quick_add_barcode_attached"
    | "pos_quick_add_product_created"
    | "pos_quick_add_variant_created";
  productName: string;
  quantityAvailable: number;
  barcode?: string;
}) {
  if (args.eventType === "pos_quick_add_barcode_attached") {
    const barcode = args.barcode?.trim() || "a barcode";
    return `${args.actorLabel} attached barcode ${barcode} to ${args.productName}.`;
  }

  return `${args.actorLabel} quick added ${args.productName} with quantity ${args.quantityAvailable}.`;
}

async function recordQuickAddOperationalEvent(
  ctx: MutationCtx,
  args: {
    actorUserId: Id<"athenaUser">;
    eventType:
      | "pos_quick_add_barcode_attached"
      | "pos_quick_add_product_created"
      | "pos_quick_add_variant_created";
    organizationId: Id<"organization">;
    product: Doc<"product">;
    sku: Doc<"productSku">;
    storeId: Id<"store">;
  },
) {
  const actor = await ctx.db.get("athenaUser", args.actorUserId);
  const actorLabel = getActorLabel(actor, String(args.actorUserId));

  await recordOperationalEventWithCtx(ctx, {
    actorUserId: args.actorUserId,
    eventType: args.eventType,
    message: buildQuickAddEventMessage({
      actorLabel,
      barcode: args.sku.barcode,
      eventType: args.eventType,
      productName: args.product.name,
      quantityAvailable: args.sku.quantityAvailable,
    }),
    metadata: {
      actorLabel,
      barcode: args.sku.barcode,
      price: args.sku.netPrice ?? args.sku.price,
      productId: args.product._id,
      productName: args.product.name,
      productSkuId: args.sku._id,
      quantityAvailable: args.sku.quantityAvailable,
      sku: args.sku.sku,
    },
    organizationId: args.organizationId,
    storeId: args.storeId,
    subjectId: String(args.sku._id),
    subjectLabel: args.product.name,
    subjectType: "product_sku",
  });
}

export async function quickAddCatalogItem(
  ctx: MutationCtx,
  args: {
    storeId: Id<"store">;
    createdByUserId: Id<"athenaUser">;
    name: string;
    lookupCode?: string;
    productId?: Id<"product">;
    productSkuId?: Id<"productSku">;
    price: number;
    quantityAvailable: number;
  },
): Promise<CatalogResult> {
  const store = await ctx.db.get("store", args.storeId);
  if (!store) {
    throw new Error("Store not found");
  }

  const lookupCode = args.lookupCode?.trim();
  const existingSku = await findExistingSku(ctx, {
    storeId: args.storeId,
    lookupCode,
  });

  if (args.productSkuId) {
    if (!lookupCode || !isBarcodeLike(lookupCode)) {
      throw new Error("Enter a valid barcode before attaching it to a SKU");
    }

    if (existingSku && String(existingSku._id) !== String(args.productSkuId)) {
      throw new Error("Barcode is already attached to another SKU");
    }

    const skuToAttach = await ctx.db.get("productSku", args.productSkuId);
    if (!skuToAttach || String(skuToAttach.storeId) !== String(args.storeId)) {
      throw new Error("SKU not found");
    }

    const product = await ctx.db.get("product", skuToAttach.productId);
    if (!product || String(product.storeId) !== String(args.storeId)) {
      throw new Error("Product not found");
    }

    if (
      skuToAttach.barcode &&
      String(skuToAttach.barcode) !== String(lookupCode)
    ) {
      throw new Error("Selected SKU already has a barcode");
    }

    if (!skuToAttach.barcode) {
      await ctx.db.patch("productSku", skuToAttach._id, {
        barcode: lookupCode,
      });
    }

    const attachedSku = (await ctx.db.get("productSku", skuToAttach._id)) ?? {
      ...skuToAttach,
      barcode: lookupCode,
    };

    await recordQuickAddOperationalEvent(ctx, {
      actorUserId: args.createdByUserId,
      eventType: "pos_quick_add_barcode_attached",
      organizationId: store.organizationId,
      product,
      sku: attachedSku,
      storeId: args.storeId,
    });

    return mapSkuToCatalogResult(ctx, {
      product,
      sku: attachedSku,
    });
  }

  if (existingSku) {
    const existingProduct = await ctx.db.get("product", existingSku.productId);
    if (existingProduct) {
      return mapSkuToCatalogResult(ctx, {
        product: existingProduct,
        sku: existingSku,
      });
    }
  }

  const quantityAvailable = Math.max(0, Math.trunc(args.quantityAvailable));
  let productId = args.productId;

  if (!productId) {
    const category = await findOrCreateQuickAddCategory(ctx, args.storeId);
    const subcategory = await findOrCreateQuickAddSubcategory(ctx, {
      storeId: args.storeId,
      categoryId: category._id,
    });
    const productName = args.name.trim() || lookupCode || "Quick add item";
    productId = (await ctx.db.insert("product", {
      availability: "live",
      areProcessingFeesAbsorbed: false,
      attributes: {},
      categoryId: category._id,
      createdByUserId: args.createdByUserId,
      currency: store.currency,
      description: "",
      inventoryCount: quantityAvailable,
      isVisible: false,
      name: productName,
      organizationId: store.organizationId,
      quantityAvailable,
      slug: toSlug(productName),
      storeId: args.storeId,
      subcategoryId: subcategory._id,
    })) as Id<"product">;
  }

  const product = await ctx.db.get("product", productId);
  if (!product || String(product.storeId) !== String(args.storeId)) {
    throw new Error("Product not found");
  }

  const productName = product.name;
  if (productName === undefined) {
    throw new Error("Product not found");
  }

  const barcode =
    lookupCode && isBarcodeLike(lookupCode) ? lookupCode : undefined;
  const skuId = await ctx.db.insert("productSku", {
    attributes: {},
    barcode,
    images: [],
    inventoryCount: quantityAvailable,
    isVisible: true,
    netPrice: args.price,
    price: args.price,
    productId,
    productName,
    quantityAvailable,
    sku: "TEMP_SKU",
    storeId: args.storeId,
  });

  const sku = generateSKU({
    storeId: args.storeId,
    productId,
    skuId,
  });
  await ctx.db.patch("productSku", skuId, { sku });

  const productSku = (await ctx.db.get("productSku", skuId))!;

  await recordQuickAddOperationalEvent(ctx, {
    actorUserId: args.createdByUserId,
    eventType: args.productId
      ? "pos_quick_add_variant_created"
      : "pos_quick_add_product_created",
    organizationId: store.organizationId,
    product,
    sku: productSku,
    storeId: args.storeId,
  });

  return mapSkuToCatalogResult(ctx, {
    product,
    sku: productSku,
  });
}
