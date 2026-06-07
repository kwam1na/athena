import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";
import { recordOperationalEventWithCtx } from "../../../operations/operationalEvents";
import { createOperationalWorkItemWithCtx } from "../../../operations/operationalWorkItems";
import { toSlug } from "../../../utils";

export type PendingCheckoutResult = {
  id: Id<"posPendingCheckoutItem">;
  pendingCheckoutItemId: Id<"posPendingCheckoutItem">;
  name: string;
  lookupCode: string;
  price: number;
  quantitySold: number;
  status: Doc<"posPendingCheckoutItem">["status"];
  reviewPriority: Doc<"posPendingCheckoutItem">["reviewPriority"];
  productId: Id<"product">;
  productSkuId: Id<"productSku">;
  sku: string;
};

const PENDING_CHECKOUT_CATEGORY_NAME = "POS pending checkout";
const PENDING_CHECKOUT_CATEGORY_SLUG = "pos-pending-checkout";
const PENDING_CHECKOUT_SUBCATEGORY_NAME = "Needs review";
const PENDING_CHECKOUT_SUBCATEGORY_SLUG = "needs-review";

type PendingCheckoutEvidenceArgs = {
  actorUserId?: Id<"athenaUser">;
  actorStaffProfileId?: Id<"staffProfile">;
  localEventId?: string;
  lookupCode?: string;
  price: number;
  quantitySold: number;
  registerSessionId?: Id<"registerSession">;
  terminalId?: Id<"posTerminal">;
  source: "online" | "offline_sync";
  timestamp: number;
};

function normalizeText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeLookupCode(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toLowerCase() : undefined;
}

function uniqueNumbers(values: number[]) {
  return Array.from(new Set(values)).slice(0, 10);
}

function uniqueStrings(values: Array<string | undefined>) {
  return Array.from(
    new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  ).slice(0, 25);
}

function generateSKU({
  storeId,
  productId,
  skuId,
}: {
  storeId: string;
  productId: string;
  skuId: string;
}) {
  const encodeBase36 = (id: string, length: number) => {
    const subset = id.substring(id.length - length);
    return parseInt(subset, 36).toString(36).toUpperCase();
  };

  const storeCode = encodeBase36(storeId, 4);
  const productCode = encodeBase36(productId, 3);
  const skuCode = encodeBase36(skuId, 3);

  return `${storeCode}-${productCode}-${skuCode}`;
}

function isTrustedCatalogProductSku(
  product: Doc<"product"> | null,
  sku: Doc<"productSku">,
  storeId: Id<"store">,
) {
  return (
    product?.storeId === storeId &&
    product.availability !== "archived" &&
    product.availability !== "draft" &&
    product.isVisible !== false &&
    sku.storeId === storeId &&
    sku.isVisible !== false
  );
}

async function findTrustedCatalogSkuForLookupCode(
  ctx: MutationCtx,
  args: {
    lookupCode?: string;
    storeId: Id<"store">;
  },
) {
  const lookupCode = args.lookupCode?.trim();
  if (!lookupCode) {
    return null;
  }

  const candidates = await Promise.all([
    ctx.db
      .query("productSku")
      .withIndex("by_storeId_barcode", (q) =>
        q.eq("storeId", args.storeId).eq("barcode", lookupCode),
      )
      .first(),
    ctx.db
      .query("productSku")
      .withIndex("by_storeId_sku", (q) =>
        q.eq("storeId", args.storeId).eq("sku", lookupCode),
      )
      .first(),
  ]);

  for (const sku of candidates) {
    if (!sku) continue;
    const product = await ctx.db.get("product", sku.productId);
    if (isTrustedCatalogProductSku(product, sku, args.storeId)) {
      return sku;
    }
  }

  return null;
}

async function findOrCreatePendingCheckoutCategory(
  ctx: MutationCtx,
  storeId: Id<"store">,
) {
  const existingCategory = await ctx.db
    .query("category")
    .filter((q) =>
      q.and(
        q.eq(q.field("storeId"), storeId),
        q.eq(q.field("slug"), PENDING_CHECKOUT_CATEGORY_SLUG),
      ),
    )
    .first();

  if (existingCategory) {
    return existingCategory;
  }

  const categoryId = await ctx.db.insert("category", {
    name: PENDING_CHECKOUT_CATEGORY_NAME,
    slug: PENDING_CHECKOUT_CATEGORY_SLUG,
    storeId,
  });

  return (await ctx.db.get("category", categoryId))!;
}

async function findOrCreatePendingCheckoutSubcategory(
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
        q.eq(q.field("slug"), PENDING_CHECKOUT_SUBCATEGORY_SLUG),
      ),
    )
    .first();

  if (existingSubcategory) {
    return existingSubcategory;
  }

  const subcategoryId = await ctx.db.insert("subcategory", {
    name: PENDING_CHECKOUT_SUBCATEGORY_NAME,
    slug: PENDING_CHECKOUT_SUBCATEGORY_SLUG,
    categoryId: args.categoryId,
    storeId: args.storeId,
  });

  return (await ctx.db.get("subcategory", subcategoryId))!;
}

async function createProvisionalCatalogAnchors(
  ctx: MutationCtx,
  args: {
    createdByUserId?: Id<"athenaUser">;
    name: string;
    price: number;
    store: Doc<"store">;
    storeId: Id<"store">;
  },
) {
  if (!args.createdByUserId) {
    throw new Error("Sign in again to continue.");
  }

  const category = await findOrCreatePendingCheckoutCategory(ctx, args.storeId);
  const subcategory = await findOrCreatePendingCheckoutSubcategory(ctx, {
    storeId: args.storeId,
    categoryId: category._id,
  });
  const productId = await ctx.db.insert("product", {
    availability: "draft",
    areProcessingFeesAbsorbed: false,
    attributes: {},
    categoryId: category._id,
    createdByUserId: args.createdByUserId,
    currency: args.store.currency,
    description: "Pending checkout item awaiting owner review.",
    inventoryCount: 0,
    isVisible: false,
    name: args.name,
    organizationId: args.store.organizationId,
    quantityAvailable: 0,
    slug: toSlug(args.name),
    storeId: args.storeId,
    subcategoryId: subcategory._id,
  });
  const productSkuId = await ctx.db.insert("productSku", {
    attributes: {},
    images: [],
    inventoryCount: 0,
    isVisible: false,
    netPrice: args.price,
    price: args.price,
    productId,
    productName: args.name,
    quantityAvailable: 0,
    sku: "PENDING",
    storeId: args.storeId,
  });
  const sku = generateSKU({
    storeId: args.storeId,
    productId,
    skuId: productSkuId,
  });

  await ctx.db.patch("productSku", productSkuId, { sku });

  return { productId, productSkuId, sku };
}

function buildReviewPriority(args: {
  transactionCount: number;
  observedPrices: number[];
  observedLookupCodes: string[];
}) {
  if (args.observedPrices.length > 1 || args.transactionCount >= 5) {
    return "high" as const;
  }

  if (args.observedLookupCodes.length > 1 || args.transactionCount >= 2) {
    return "elevated" as const;
  }

  return "normal" as const;
}

function getActorLabel(user: Doc<"athenaUser"> | null, fallback?: string) {
  const fullName = [user?.firstName, user?.lastName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");

  return fullName || user?.email?.trim() || fallback || "Cashier";
}

async function findMatchingPendingCheckoutItem(
  ctx: MutationCtx,
  args: {
    storeId: Id<"store">;
    normalizedLookupCode?: string;
    normalizedName: string;
  },
) {
  const statuses: Array<Doc<"posPendingCheckoutItem">["status"]> = [
    "pending_review",
    "flagged",
    "rejected",
    "approved",
    "linked_to_catalog",
  ];

  if (args.normalizedLookupCode) {
    for (const status of statuses) {
      const lookupMatch = await ctx.db
        .query("posPendingCheckoutItem")
        .withIndex("by_storeId_lookup_status", (q) =>
          q
            .eq("storeId", args.storeId)
            .eq("normalizedLookupCode", args.normalizedLookupCode)
            .eq("status", status),
        )
        .first();

      if (lookupMatch) {
        return lookupMatch;
      }
    }
  }

  for (const status of statuses) {
    const nameMatch = await ctx.db
      .query("posPendingCheckoutItem")
      .withIndex("by_storeId_name_status", (q) =>
        q
          .eq("storeId", args.storeId)
          .eq("normalizedName", args.normalizedName)
          .eq("status", status),
      )
      .first();

    if (
      nameMatch &&
      (!args.normalizedLookupCode || !nameMatch.normalizedLookupCode)
    ) {
      return nameMatch;
    }
  }

  return null;
}

function buildNextEvidence(
  existingEvidence: Doc<"posPendingCheckoutItem">["evidence"] | undefined,
  args: PendingCheckoutEvidenceArgs,
) {
  const observedLookupCodes = uniqueStrings([
    ...(existingEvidence?.observedLookupCodes ?? []),
    args.lookupCode,
  ]);
  const observedPrices = uniqueNumbers([
    ...(existingEvidence?.observedPrices ?? []),
    args.price,
  ]);
  const localEventIds = uniqueStrings([
    ...(existingEvidence?.localEventIds ?? []),
    args.localEventId,
  ]);
  return {
    firstSeenAt: existingEvidence?.firstSeenAt ?? args.timestamp,
    lastSeenAt: args.timestamp,
    transactionCount: existingEvidence?.transactionCount ?? 0,
    totalQuantitySold:
      existingEvidence?.totalQuantitySold ?? 0,
    observedPrices,
    observedLookupCodes,
    lastActorUserId: args.actorUserId,
    lastActorStaffProfileId: args.actorStaffProfileId,
    lastRegisterSessionId: args.registerSessionId,
    lastTerminalId: args.terminalId,
    offlineSaleCount: existingEvidence?.offlineSaleCount ?? 0,
    localEventIds: localEventIds.length > 0 ? localEventIds : undefined,
  };
}

function buildNextSaleEvidence(
  existingEvidence: Doc<"posPendingCheckoutItem">["evidence"],
  args: PendingCheckoutEvidenceArgs & {
    posTransactionId?: Id<"posTransaction">;
  },
) {
  const localEventIds = uniqueStrings([
    ...(existingEvidence.localEventIds ?? []),
    args.localEventId,
  ]);

  return {
    ...existingEvidence,
    firstSeenAt: existingEvidence.firstSeenAt ?? args.timestamp,
    lastSeenAt: args.timestamp,
    transactionCount: existingEvidence.transactionCount + 1,
    totalQuantitySold: existingEvidence.totalQuantitySold + args.quantitySold,
    observedPrices: uniqueNumbers([...existingEvidence.observedPrices, args.price]),
    observedLookupCodes: uniqueStrings([
      ...existingEvidence.observedLookupCodes,
      args.lookupCode,
    ]),
    lastActorUserId: args.actorUserId,
    lastActorStaffProfileId: args.actorStaffProfileId,
    lastRegisterSessionId: args.registerSessionId,
    lastTerminalId: args.terminalId,
    lastPosTransactionId: args.posTransactionId,
    offlineSaleCount:
      (existingEvidence.offlineSaleCount ?? 0) +
      (args.source === "offline_sync" ? 1 : 0),
    localEventIds: localEventIds.length > 0 ? localEventIds : undefined,
  };
}

function buildEventMessage(args: {
  actorLabel: string;
  itemName: string;
  quantitySold: number;
  reused: boolean;
}) {
  const action = args.reused ? "reused" : "added";

  return `${args.actorLabel} ${action} pending checkout item ${args.itemName} for ${args.quantitySold} sold.`;
}

function buildWorkItemPriority(
  reviewPriority: Doc<"posPendingCheckoutItem">["reviewPriority"],
) {
  if (reviewPriority === "high") return "high";
  if (reviewPriority === "elevated") return "medium";
  return "normal";
}

async function syncPendingCheckoutWorkItem(
  ctx: MutationCtx,
  item: Doc<"posPendingCheckoutItem">,
) {
  if (!item.operationalWorkItemId) {
    return;
  }

  const workItem = await ctx.db.get(
    "operationalWorkItem",
    item.operationalWorkItemId,
  );
  if (!workItem) {
    return;
  }

  await ctx.db.patch("operationalWorkItem", workItem._id, {
    metadata: {
      ...(workItem.metadata ?? {}),
      lookupCode: item.lookupCode,
      pendingCheckoutItemId: item._id,
      price: item.provisionalPrice,
      provisionalProductId: item.provisionalProductId,
      provisionalProductSkuId: item.provisionalProductSkuId,
      reviewPriority: item.reviewPriority,
      totalQuantitySold: item.evidence.totalQuantitySold,
      transactionCount: item.evidence.transactionCount,
    },
    priority: buildWorkItemPriority(item.reviewPriority),
  });
}

async function recordPendingCheckoutOperationalEvent(
  ctx: MutationCtx,
  args: {
    actorUserId?: Id<"athenaUser">;
    item: Doc<"posPendingCheckoutItem">;
    quantitySold: number;
    reused: boolean;
    source: "online" | "offline_sync";
  },
) {
  const actor = args.actorUserId
    ? await ctx.db.get("athenaUser", args.actorUserId)
    : null;
  const actorLabel = getActorLabel(actor, args.actorUserId);
  const eventType = args.reused
    ? "pos_pending_checkout_item_reused"
    : "pos_pending_checkout_item_created";

  await recordOperationalEventWithCtx(ctx, {
    actorUserId: args.actorUserId,
    eventType,
    message: buildEventMessage({
      actorLabel,
      itemName: args.item.name,
      quantitySold: args.quantitySold,
      reused: args.reused,
    }),
    metadata: {
      actorLabel,
      lookupCode: args.item.lookupCode,
      pendingCheckoutItemId: args.item._id,
      price: args.item.provisionalPrice,
      provisionalProductId: args.item.provisionalProductId,
      provisionalProductSkuId: args.item.provisionalProductSkuId,
      quantitySold: args.quantitySold,
      reviewPriority: args.item.reviewPriority,
      source: args.source,
      status: args.item.status,
      totalQuantitySold: args.item.evidence.totalQuantitySold,
      transactionCount: args.item.evidence.transactionCount,
    },
    metadataDedupeKeys: ["source", "transactionCount", "totalQuantitySold"],
    organizationId: args.item.organizationId,
    storeId: args.item.storeId,
    subjectId: String(args.item._id),
    subjectLabel: args.item.name,
    subjectType: "pos_pending_checkout_item",
  });
}

export async function recordPendingCheckoutItemSaleEvidence(
  ctx: MutationCtx,
  args: {
    pendingCheckoutItemId: Id<"posPendingCheckoutItem">;
    storeId: Id<"store">;
    actorUserId?: Id<"athenaUser">;
    actorStaffProfileId?: Id<"staffProfile">;
    lookupCode?: string;
    price: number;
    quantitySold: number;
    posTransactionId?: Id<"posTransaction">;
    registerSessionId?: Id<"registerSession">;
    terminalId?: Id<"posTerminal">;
    localEventId?: string;
    source: "online" | "offline_sync";
    timestamp: number;
  },
) {
  const item = await ctx.db.get(
    "posPendingCheckoutItem",
    args.pendingCheckoutItemId,
  );
  if (
    !item ||
    item.storeId !== args.storeId ||
    (item.status !== "pending_review" && item.status !== "flagged")
  ) {
    return null;
  }

  if (args.localEventId && item.evidence.localEventIds?.includes(args.localEventId)) {
    return item;
  }

  const evidence = buildNextSaleEvidence(item.evidence, {
    actorStaffProfileId: args.actorStaffProfileId,
    actorUserId: args.actorUserId,
    localEventId: args.localEventId,
    lookupCode: args.lookupCode ?? item.lookupCode,
    posTransactionId: args.posTransactionId,
    price: args.price,
    quantitySold: Math.trunc(args.quantitySold),
    registerSessionId: args.registerSessionId,
    source: args.source,
    terminalId: args.terminalId,
    timestamp: args.timestamp,
  });
  const reviewPriority = buildReviewPriority({
    observedLookupCodes: evidence.observedLookupCodes,
    observedPrices: evidence.observedPrices,
    transactionCount: evidence.transactionCount,
  });

  await ctx.db.patch("posPendingCheckoutItem", item._id, {
    evidence,
    reviewPriority,
    updatedAt: args.timestamp,
  });

  const updatedItem = (await ctx.db.get("posPendingCheckoutItem", item._id))!;
  await syncPendingCheckoutWorkItem(ctx, updatedItem);
  await recordPendingCheckoutOperationalEvent(ctx, {
    actorUserId: args.actorUserId,
    item: updatedItem,
    quantitySold: Math.trunc(args.quantitySold),
    reused: true,
    source: args.source,
  });

  return updatedItem;
}

export async function recordPendingCheckoutItemEvidenceCorrection(
  ctx: MutationCtx,
  args: {
    pendingCheckoutItemId: Id<"posPendingCheckoutItem">;
    storeId: Id<"store">;
    actorUserId?: Id<"athenaUser">;
    actorStaffProfileId?: Id<"staffProfile">;
    posTransactionId?: Id<"posTransaction">;
    quantityDelta: number;
    transactionCountDelta?: number;
    reason: "transaction_void" | "item_adjustment";
    timestamp: number;
  },
) {
  if (args.quantityDelta === 0 && !args.transactionCountDelta) {
    return null;
  }

  const item = await ctx.db.get(
    "posPendingCheckoutItem",
    args.pendingCheckoutItemId,
  );
  if (!item || item.storeId !== args.storeId) {
    return null;
  }

  const evidence = {
    ...item.evidence,
    lastSeenAt: args.timestamp,
    lastActorUserId: args.actorUserId,
    lastActorStaffProfileId: args.actorStaffProfileId,
    lastPosTransactionId: args.posTransactionId,
    observedLookupCodes: item.evidence.observedLookupCodes ?? [],
    observedPrices: item.evidence.observedPrices ?? [],
    totalQuantitySold: Math.max(
      0,
      item.evidence.totalQuantitySold + args.quantityDelta,
    ),
    transactionCount: Math.max(
      0,
      item.evidence.transactionCount + (args.transactionCountDelta ?? 0),
    ),
  };
  const reviewPriority = buildReviewPriority({
    observedLookupCodes: evidence.observedLookupCodes,
    observedPrices: evidence.observedPrices,
    transactionCount: evidence.transactionCount,
  });

  await ctx.db.patch("posPendingCheckoutItem", item._id, {
    evidence,
    reviewPriority,
    updatedAt: args.timestamp,
  });

  const updatedItem = (await ctx.db.get("posPendingCheckoutItem", item._id))!;
  await syncPendingCheckoutWorkItem(ctx, updatedItem);
  await recordOperationalEventWithCtx(ctx, {
    actorStaffProfileId: args.actorStaffProfileId,
    actorUserId: args.actorUserId,
    eventType: "pos_pending_checkout_item_evidence_corrected",
    message: `Adjusted pending checkout item ${updatedItem.name} evidence by ${args.quantityDelta}.`,
    metadata: {
      pendingCheckoutItemId: updatedItem._id,
      posTransactionId: args.posTransactionId,
      quantityDelta: args.quantityDelta,
      reason: args.reason,
      totalQuantitySold: updatedItem.evidence.totalQuantitySold,
      transactionCount: updatedItem.evidence.transactionCount,
      transactionCountDelta: args.transactionCountDelta ?? 0,
    },
    organizationId: updatedItem.organizationId,
    storeId: updatedItem.storeId,
    subjectId: String(updatedItem._id),
    subjectLabel: updatedItem.name,
    subjectType: "pos_pending_checkout_item",
  });

  return updatedItem;
}

export async function createOrReusePendingCheckoutItem(
  ctx: MutationCtx,
  args: {
    storeId: Id<"store">;
    createdByUserId?: Id<"athenaUser">;
    createdByStaffProfileId?: Id<"staffProfile">;
    name: string;
    lookupCode?: string;
    price: number;
    quantitySold: number;
    registerSessionId?: Id<"registerSession">;
    terminalId?: Id<"posTerminal">;
    localEventId?: string;
    source?: "online" | "offline_sync";
    timestamp?: number;
  },
): Promise<PendingCheckoutResult> {
  const store = await ctx.db.get("store", args.storeId);
  if (!store) {
    throw new Error("Store not found");
  }

  const quantitySold = Math.trunc(args.quantitySold);
  if (quantitySold <= 0) {
    throw new Error("Enter a quantity sold greater than zero.");
  }

  if (args.price < 0) {
    throw new Error("Enter a valid sale price.");
  }

  const name = args.name.trim() || args.lookupCode?.trim() || "Pending item";
  const normalizedName = normalizeText(name);
  const lookupCode = args.lookupCode?.trim();
  const normalizedLookupCode = normalizeLookupCode(lookupCode);
  const source = args.source ?? "online";
  const timestamp = args.timestamp ?? Date.now();
  const trustedCatalogSku = await findTrustedCatalogSkuForLookupCode(ctx, {
    lookupCode,
    storeId: args.storeId,
  });
  if (trustedCatalogSku) {
    throw new Error("This item is already in the catalog. Add it from search instead.");
  }

  const existing = await findMatchingPendingCheckoutItem(ctx, {
    storeId: args.storeId,
    normalizedLookupCode,
    normalizedName,
  });

  if (existing?.status === "rejected") {
    throw new Error(
      "This item was rejected in review. Ask a manager before selling it again.",
    );
  }

  if (existing?.status === "approved" || existing?.status === "linked_to_catalog") {
    throw new Error(
      "This item was already reviewed. Add the catalog item from search instead.",
    );
  }

  const evidence = buildNextEvidence(existing?.evidence, {
    actorUserId: args.createdByUserId,
    actorStaffProfileId: args.createdByStaffProfileId,
    localEventId: args.localEventId,
    lookupCode,
    price: args.price,
    quantitySold,
    registerSessionId: args.registerSessionId,
    source,
    terminalId: args.terminalId,
    timestamp,
  });
  const reviewPriority = buildReviewPriority({
    observedLookupCodes: evidence.observedLookupCodes,
    observedPrices: evidence.observedPrices,
    transactionCount: evidence.transactionCount,
  });

  if (existing) {
    await ctx.db.patch("posPendingCheckoutItem", existing._id, {
      evidence,
      provisionalPrice: args.price,
      reviewPriority,
      updatedAt: timestamp,
    });

    const item = (await ctx.db.get("posPendingCheckoutItem", existing._id))!;
    await syncPendingCheckoutWorkItem(ctx, item);
    await recordPendingCheckoutOperationalEvent(ctx, {
      actorUserId: args.createdByUserId,
      item,
      quantitySold,
      reused: true,
      source,
    });

    return {
      id: item._id,
      pendingCheckoutItemId: item._id,
      name: item.name,
      lookupCode: item.lookupCode ?? "",
      price: item.provisionalPrice,
      productId: item.provisionalProductId!,
      productSkuId: item.provisionalProductSkuId!,
      quantitySold,
      reviewPriority: item.reviewPriority,
      sku: item.provisionalProductSkuId
        ? ((await ctx.db.get("productSku", item.provisionalProductSkuId))?.sku ??
          "")
        : "",
      status: item.status,
    };
  }

  const pendingCheckoutItemId = await ctx.db.insert("posPendingCheckoutItem", {
    createdAt: timestamp,
    createdByStaffProfileId: args.createdByStaffProfileId,
    createdByUserId: args.createdByUserId,
    createdFrom: source,
    currency: store.currency,
    evidence,
    lookupCode,
    name,
    normalizedLookupCode,
    normalizedName,
    organizationId: store.organizationId,
    provisionalPrice: args.price,
    reviewPriority,
    status: "pending_review",
    storeId: args.storeId,
    updatedAt: timestamp,
  });

  const item = (await ctx.db.get(
    "posPendingCheckoutItem",
    pendingCheckoutItemId,
  ))!;
  const anchors = await createProvisionalCatalogAnchors(ctx, {
    createdByUserId: args.createdByUserId,
    name: item.name,
    price: item.provisionalPrice,
    store,
    storeId: args.storeId,
  });
  await ctx.db.patch("posPendingCheckoutItem", item._id, {
    provisionalProductId: anchors.productId,
    provisionalProductSkuId: anchors.productSkuId,
  });
  const itemWithAnchors = (await ctx.db.get(
    "posPendingCheckoutItem",
    pendingCheckoutItemId,
  ))!;
  const workItem = await createOperationalWorkItemWithCtx(ctx, {
    createdByStaffProfileId: args.createdByStaffProfileId,
    createdByUserId: args.createdByUserId,
    metadata: {
      lookupCode: itemWithAnchors.lookupCode,
      pendingCheckoutItemId: itemWithAnchors._id,
      price: itemWithAnchors.provisionalPrice,
      provisionalProductId: itemWithAnchors.provisionalProductId,
      provisionalProductSkuId: itemWithAnchors.provisionalProductSkuId,
      quantitySold,
      reviewPriority: itemWithAnchors.reviewPriority,
      source,
      totalQuantitySold: itemWithAnchors.evidence.totalQuantitySold,
    },
    organizationId: itemWithAnchors.organizationId,
    priority: buildWorkItemPriority(itemWithAnchors.reviewPriority),
    status: "open",
    storeId: itemWithAnchors.storeId,
    title: `Review pending checkout item: ${itemWithAnchors.name}`,
    type: "pos_pending_checkout_item_review",
  });

  if (workItem) {
    await ctx.db.patch("posPendingCheckoutItem", itemWithAnchors._id, {
      operationalWorkItemId: workItem._id,
    });
  }

  const itemWithWork = (await ctx.db.get(
    "posPendingCheckoutItem",
    pendingCheckoutItemId,
  ))!;
  await recordPendingCheckoutOperationalEvent(ctx, {
    actorUserId: args.createdByUserId,
    item: itemWithWork,
    quantitySold,
    reused: false,
    source,
  });

  return {
    id: itemWithWork._id,
    pendingCheckoutItemId: itemWithWork._id,
    name: itemWithWork.name,
    lookupCode: itemWithWork.lookupCode ?? "",
    price: itemWithWork.provisionalPrice,
    productId: itemWithWork.provisionalProductId!,
    productSkuId: itemWithWork.provisionalProductSkuId!,
    quantitySold,
    reviewPriority: itemWithWork.reviewPriority,
    sku: anchors.sku,
    status: itemWithWork.status,
  };
}
