import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";

import { isTrustedRegisterCatalogSku } from "./queries/listRegisterCatalog";

type DbCtx = Pick<QueryCtx | MutationCtx, "db">;

export type PendingCheckoutSkuResolution =
  | {
      kind: "unresolved_pending";
      pendingCheckoutItemId: Id<"posPendingCheckoutItem">;
      provisionalProductId?: Id<"product">;
      provisionalProductSkuId?: Id<"productSku">;
      stockMutationPolicy: "pending_evidence_only";
    }
  | {
      kind: "linked_alias";
      pendingCheckoutItemId: Id<"posPendingCheckoutItem">;
      effectiveProductId: Id<"product">;
      effectiveProductSkuId: Id<"productSku">;
      aliasDecisionAt: number;
      aliasEffectiveAt: number;
      stockMutationPolicy: "trusted_for_post_link_commands";
    }
  | {
      kind: "finalized_trusted";
      pendingCheckoutItemId: Id<"posPendingCheckoutItem">;
      effectiveProductId: Id<"product">;
      effectiveProductSkuId: Id<"productSku">;
      stockMutationPolicy: "trusted_inventory";
    }
  | {
      kind: "invalid";
      pendingCheckoutItemId: Id<"posPendingCheckoutItem">;
      reason:
        | "missing_pending_item"
        | "store_mismatch"
        | "missing_approved_target"
        | "invalid_approved_target"
        | "rejected"
        | "unsupported_status";
    };

export function normalizePendingCheckoutLookupCode(value?: string | null) {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : undefined;
}

function firstEvidenceTime(item: Doc<"posPendingCheckoutItem">) {
  return item.evidence.firstSeenAt || item.createdAt;
}

export async function hasPendingCheckoutTransactionAttribution(
  ctx: DbCtx,
  pendingCheckoutItemId: Id<"posPendingCheckoutItem">,
) {
  const attributedItem = await ctx.db
    .query("posTransactionItem")
    .withIndex("by_pendingCheckoutItemId", (q) =>
      q.eq("pendingCheckoutItemId", pendingCheckoutItemId),
    )
    .first();

  return Boolean(attributedItem);
}

export async function resolvePendingCheckoutSku(
  ctx: DbCtx,
  args: {
    storeId: Id<"store">;
    pendingCheckoutItemId: Id<"posPendingCheckoutItem">;
  },
): Promise<PendingCheckoutSkuResolution> {
  const item = await ctx.db.get(
    "posPendingCheckoutItem",
    args.pendingCheckoutItemId,
  );

  if (!item) {
    return {
      kind: "invalid",
      pendingCheckoutItemId: args.pendingCheckoutItemId,
      reason: "missing_pending_item",
    };
  }

  return resolvePendingCheckoutSkuFromItem(ctx, {
    item,
    storeId: args.storeId,
  });
}

export async function resolvePendingCheckoutSkuFromItem(
  ctx: DbCtx,
  args: {
    storeId: Id<"store">;
    item: Doc<"posPendingCheckoutItem">;
  },
): Promise<PendingCheckoutSkuResolution> {
  const { item } = args;
  if (item.storeId !== args.storeId) {
    return {
      kind: "invalid",
      pendingCheckoutItemId: item._id,
      reason: "store_mismatch",
    };
  }

  if (item.status === "pending_review" || item.status === "flagged") {
    return {
      kind: "unresolved_pending",
      pendingCheckoutItemId: item._id,
      ...(item.provisionalProductId
        ? { provisionalProductId: item.provisionalProductId }
        : {}),
      ...(item.provisionalProductSkuId
        ? { provisionalProductSkuId: item.provisionalProductSkuId }
        : {}),
      stockMutationPolicy: "pending_evidence_only",
    };
  }

  if (item.status === "rejected") {
    return {
      kind: "invalid",
      pendingCheckoutItemId: item._id,
      reason: "rejected",
    };
  }

  if (!item.approvedProductId || !item.approvedProductSkuId) {
    return {
      kind: "invalid",
      pendingCheckoutItemId: item._id,
      reason: "missing_approved_target",
    };
  }

  const approvedProduct = await ctx.db.get("product", item.approvedProductId);
  const approvedSku = await ctx.db.get("productSku", item.approvedProductSkuId);
  const approvedCategory = approvedProduct?.categoryId
    ? await ctx.db.get("category", approvedProduct.categoryId)
    : null;

  if (
    !approvedProduct ||
    approvedProduct.storeId !== args.storeId ||
    !approvedSku ||
    approvedSku.storeId !== args.storeId ||
    approvedSku.productId !== approvedProduct._id ||
    !isTrustedRegisterCatalogSku({
      category: approvedCategory,
      product: approvedProduct,
      sku: approvedSku,
    })
  ) {
    return {
      kind: "invalid",
      pendingCheckoutItemId: item._id,
      reason: "invalid_approved_target",
    };
  }

  if (item.status === "linked_to_catalog") {
    return {
      kind: "linked_alias",
      pendingCheckoutItemId: item._id,
      effectiveProductId: approvedProduct._id,
      effectiveProductSkuId: approvedSku._id,
      aliasDecisionAt: item.reviewedAt ?? item.updatedAt,
      aliasEffectiveAt: firstEvidenceTime(item),
      stockMutationPolicy: "trusted_for_post_link_commands",
    };
  }

  if (item.status === "approved") {
    return {
      kind: "finalized_trusted",
      pendingCheckoutItemId: item._id,
      effectiveProductId: approvedProduct._id,
      effectiveProductSkuId: approvedSku._id,
      stockMutationPolicy: "trusted_inventory",
    };
  }

  return {
    kind: "invalid",
    pendingCheckoutItemId: item._id,
    reason: "unsupported_status",
  };
}

export async function findActivePendingCheckoutLookupAliasByCode(
  ctx: DbCtx,
  args: {
    storeId: Id<"store">;
    lookupCode: string;
  },
) {
  const normalizedLookupCode = normalizePendingCheckoutLookupCode(
    args.lookupCode,
  );
  if (!normalizedLookupCode) {
    return null;
  }

  return ctx.db
    .query("posPendingCheckoutLookupAlias")
    .withIndex("by_storeId_normalizedLookupCode_status", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("normalizedLookupCode", normalizedLookupCode)
        .eq("status", "active"),
    )
    .first();
}

export async function upsertPendingCheckoutLookupAlias(
  ctx: MutationCtx,
  args: {
    storeId: Id<"store">;
    organizationId: Id<"organization">;
    lookupCode?: string;
    pendingCheckoutItemId: Id<"posPendingCheckoutItem">;
    productId: Id<"product">;
    productSkuId: Id<"productSku">;
    now: number;
  },
) {
  const normalizedLookupCode = normalizePendingCheckoutLookupCode(
    args.lookupCode,
  );
  if (!normalizedLookupCode) {
    return null;
  }

  const existingAlias = await findActivePendingCheckoutLookupAliasByCode(ctx, {
    lookupCode: normalizedLookupCode,
    storeId: args.storeId,
  });
  if (
    existingAlias &&
    (existingAlias.pendingCheckoutItemId !== args.pendingCheckoutItemId ||
      existingAlias.productSkuId !== args.productSkuId)
  ) {
    throw new Error("This lookup code is already linked to another SKU.");
  }

  if (existingAlias) {
    await ctx.db.patch("posPendingCheckoutLookupAlias", existingAlias._id, {
      productId: args.productId,
      productSkuId: args.productSkuId,
      updatedAt: args.now,
    });
    return existingAlias._id;
  }

  return ctx.db.insert("posPendingCheckoutLookupAlias", {
    storeId: args.storeId,
    organizationId: args.organizationId,
    normalizedLookupCode,
    pendingCheckoutItemId: args.pendingCheckoutItemId,
    productId: args.productId,
    productSkuId: args.productSkuId,
    status: "active",
    createdAt: args.now,
    updatedAt: args.now,
  });
}

export async function retirePendingCheckoutLookupAliasForItem(
  ctx: MutationCtx,
  args: {
    storeId: Id<"store">;
    lookupCode?: string;
    pendingCheckoutItemId: Id<"posPendingCheckoutItem">;
    now: number;
  },
) {
  const existingAlias = args.lookupCode
    ? await findActivePendingCheckoutLookupAliasByCode(ctx, {
        lookupCode: args.lookupCode,
        storeId: args.storeId,
      })
    : null;

  if (
    !existingAlias ||
    existingAlias.pendingCheckoutItemId !== args.pendingCheckoutItemId
  ) {
    return null;
  }

  await ctx.db.patch("posPendingCheckoutLookupAlias", existingAlias._id, {
    status: "retired",
    updatedAt: args.now,
  });
  return existingAlias._id;
}
