/**
 * Read ports for `inventory.positions` and `inventory.replenishment`
 * (V26-1267).
 *
 * Authority boundary: the kernel's port query reauthorizes, scopes, and strips
 * projections. Two escalations matter here:
 *
 * - `costOverlay` requires the `inventory.cost_overlay.view` read intent. The
 *   handler always computes unit cost and stock value; the kernel removes them
 *   for a reader without the overlay, so the escalation FAILS CLOSED and the
 *   fields are absent rather than zero.
 * - `supplierCommercial` is a full-admin projection on a resource that already
 *   requires `procurement.view`.
 *
 * `get({ skuRef })` resolves the reference against the verified store scope; a
 * guessed or cross-store reference resolves to nothing.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import {
  mintAgentResourceRef,
  mintAgentSourceRef,
  money,
  pageOf,
  resolveAgentResourceRef,
  units,
} from "../../lib/agentCapabilitySupport";
import { defineAgentReadPortQuery } from "../../platform/operationAdmission";
import type { AgentReadPortHandler, AgentReadPortHandlerOutput } from "../../agentHarness/readPorts";
import type { AgentSourceCompleteness } from "../../../shared/agentHarness/results";
import { known, unknown } from "../../../shared/agentHarness/results";
import { listInventorySnapshotForProductSkusWithCtx } from "../adjustments";
import { listReplenishmentRecommendationsWithCtx } from "../replenishment";
import { POSITIONS_PORT_KEY, REPLENISHMENT_PORT_KEY } from "./inventory";

const SKU_REF_KIND = "product_sku";
const RECOMMENDATION_REF_KIND = "replenishment_recommendation";
const LOW_STOCK_THRESHOLD = 5;

type PositionRow = Awaited<ReturnType<typeof listInventorySnapshotForProductSkusWithCtx>>[number];

function stockStateOf(available: number): "in_stock" | "low" | "out" {
  if (available <= 0) return "out";
  return available <= LOW_STOCK_THRESHOLD ? "low" : "in_stock";
}

function variantLabelOf(row: PositionRow): string | undefined {
  const parts = [row.size, row.colorName, row.length !== undefined ? `${row.length}in` : undefined].filter(
    (part): part is string => typeof part === "string" && part.trim().length > 0,
  );
  return parts.length > 0 ? parts.join(" / ") : undefined;
}

function projectPosition(row: PositionRow, storeId: Id<"store">, currency: string, unitCost: number | null) {
  const onHand = row.inventoryCount;
  const available = row.quantityAvailable;
  return {
    skuRef: mintAgentResourceRef(SKU_REF_KIND, storeId, String(row._id)),
    skuCode: row.sku,
    displayName: row.productSkuProductName ?? row.productName,
    variantLabel: variantLabelOf(row),
    category: row.productCategory,
    subcategory: row.productSubcategory,
    onHand: units(onHand),
    available: units(available),
    reserved: units(Math.max(0, row.reservedQuantity ?? 0)),
    stockState: stockStateOf(available),
    adjustmentBlockedReason: row.stockAdjustmentBlockedReason,
    // Absent, never zero: a SKU with no cost basis is uncosted, and a zero cost
    // would state a full margin the store never earned.
    unitCost: unitCost === null ? unknown("not_recorded") : known(money(unitCost, currency)),
    stockValue: unitCost === null ? unknown("not_recorded") : known(money(unitCost * onHand, currency)),
  };
}

/** The domain read itself, exported so the direct-harness smoke can bind the exact same code. */
export const readPositionsHandler: AgentReadPortHandler = async (ctx, input): Promise<AgentReadPortHandlerOutput> => {
  const storeId = input.scope.storeId as Id<"store"> | undefined;
  if (!storeId) {
    return { kind: "unavailable", reason: "store_scope_missing", retryable: false, sourceKey: "positions" };
  }
  const store = await ctx.db.get("store", storeId);
  const currency = store?.currency ?? "GHS";

  const costOf = async (skuIds: readonly Id<"productSku">[]) => {
    const docs = await Promise.all(skuIds.map((skuId) => ctx.db.get("productSku", skuId)));
    return new Map(
      docs
        .filter((doc): doc is Doc<"productSku"> => doc !== null && doc.storeId === storeId)
        .map((doc) => [String(doc._id), doc.unitCost ?? null] as const),
    );
  };

  if (input.verb === "get") {
    const skuId = resolveAgentResourceRef(SKU_REF_KIND, storeId, input.args.skuRef);
    if (!skuId) {
      return { kind: "unavailable", reason: "sku_reference_unresolvable", retryable: false, sourceKey: "positions" };
    }
    const rows = await listInventorySnapshotForProductSkusWithCtx(ctx, {
      now: input.now,
      productSkuIds: [skuId as Id<"productSku">],
      storeId,
    });
    const row = rows[0];
    if (!row) {
      return { kind: "unavailable", reason: "sku_not_found_in_store", retryable: false, sourceKey: "positions" };
    }
    const costs = await costOf([row._id]);
    return {
      kind: "data",
      data: projectPosition(row, storeId, currency, costs.get(String(row._id)) ?? null),
      observedAt: input.now,
      freshness: { class: "live", authority: "live_read" },
      sources: [{ sourceKey: "positions", status: "complete", capturedAt: input.now }],
      warnings: [],
      sourceRefs: [
        {
          ref: mintAgentSourceRef("sku_snapshot", storeId, String(row._id)),
          kind: "sku_snapshot",
          label: row.sku ?? row.productName,
          capturedAt: input.now,
        },
      ],
    };
  }

  // Page the catalogue by the store index, then build the bounded snapshot for
  // exactly the page's SKUs. Filters are applied to the built page, so the
  // completeness statement is about the page, never about the filter.
  const cursor = input.cursor ?? null;
  const skuPage = await ctx.db
    .query("productSku")
    .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
    .paginate({ cursor, numItems: input.pageSize });
  const built = await listInventorySnapshotForProductSkusWithCtx(ctx, {
    now: input.now,
    productSkuIds: skuPage.page.map((sku) => sku._id),
    storeId,
  });
  const costs = new Map(skuPage.page.map((sku) => [String(sku._id), sku.unitCost ?? null] as const));

  const requestedCategory = typeof input.args.category === "string" ? input.args.category : undefined;
  const requestedState = input.args.stockState as "in_stock" | "low" | "out" | undefined;
  const rows = built
    .filter((row) => requestedCategory === undefined || row.productCategory === requestedCategory)
    .filter((row) => requestedState === undefined || stockStateOf(row.quantityAvailable) === requestedState);

  const filtered = requestedCategory !== undefined || requestedState !== undefined;
  const sources: AgentSourceCompleteness[] = [
    {
      sourceKey: "positions",
      status: skuPage.isDone && !filtered ? "complete" : "partial",
      reason: skuPage.isDone
        ? filtered
          ? "filtered_within_pages"
          : undefined
        : "more_pages_available",
      capturedAt: input.now,
    },
  ];

  return {
    kind: "data",
    data: rows.map((row) => projectPosition(row, storeId, currency, costs.get(String(row._id)) ?? null)),
    observedAt: input.now,
    freshness: { class: "live", authority: "live_read" },
    sources,
    warnings: [],
    sourceRefs: rows.map((row) => ({
      ref: mintAgentSourceRef("sku_snapshot", storeId, String(row._id)),
      kind: "sku_snapshot",
      label: row.sku ?? row.productName,
      capturedAt: input.now,
    })),
    page: { hasMore: !skuPage.isDone, rawCursor: skuPage.isDone ? null : skuPage.continueCursor },
  };
};

export const readPositions = defineAgentReadPortQuery({ portKey: POSITIONS_PORT_KEY, handler: readPositionsHandler });

/** The domain read itself, exported so the direct-harness smoke can bind the exact same code. */
export const listReplenishmentHandler: AgentReadPortHandler = async (ctx, input): Promise<AgentReadPortHandlerOutput> => {
  const storeId = input.scope.storeId as Id<"store"> | undefined;
  if (!storeId) {
    return { kind: "unavailable", reason: "store_scope_missing", retryable: false, sourceKey: "recommendations" };
  }
  const store = await ctx.db.get("store", storeId);
  const currency = store?.currency ?? "GHS";
  const recommendations = await listReplenishmentRecommendationsWithCtx(ctx, { storeId });
  const requested = input.args.continuityStatus;
  const matching = recommendations.filter(
    (recommendation) => requested === undefined || recommendation.status === requested,
  );
  const page = pageOf(matching, input.pageIndex * input.pageSize, input.pageSize);
  const hasActiveVendor = recommendations.every((recommendation) => recommendation.status !== "vendor_missing");

  return {
    kind: "data",
    data: page.items.map((recommendation) => ({
      recommendationRef: mintAgentResourceRef(
        RECOMMENDATION_REF_KIND,
        storeId,
        String(recommendation._id),
      ),
      skuRef: mintAgentResourceRef(SKU_REF_KIND, storeId, String(recommendation._id)),
      skuCode: recommendation.sku ?? undefined,
      displayName: recommendation.productName,
      continuityStatus: recommendation.status,
      needsAction: recommendation.needsAction,
      onHand: units(recommendation.inventoryCount),
      available: units(recommendation.quantityAvailable),
      suggestedOrderQuantity: units(recommendation.suggestedOrderQuantity),
      inboundQuantity: units(recommendation.inboundPurchaseOrderQuantity),
      plannedQuantity: units(recommendation.plannedPurchaseOrderQuantity),
      guidance: recommendation.guidance,
      derivationVersion: "replenishment.v1",
      // The derivation reads live stock and procurement rows on every call.
      inputFreshness: "live",
      nextExpectedAt: recommendation.nextExpectedAt,
      supplierCommitment: {
        hasActiveVendor,
        openPurchaseOrderCount: recommendation.pendingPurchaseOrderCount,
        cancelledPurchaseOrderCount: recommendation.cancelledPurchaseOrderCount,
        supplierCost: undefined,
      },
    })),
    observedAt: input.now,
    freshness: { class: "derived", authority: "derived" },
    sources: [
      {
        sourceKey: "recommendations",
        status: page.hasMore ? "partial" : "complete",
        reason: page.hasMore ? "more_pages_available" : undefined,
        capturedAt: input.now,
      },
      { sourceKey: "inputs", status: "complete", capturedAt: input.now },
    ],
    warnings: [],
    sourceRefs: page.items.flatMap((recommendation) => [
      {
        ref: mintAgentSourceRef(RECOMMENDATION_REF_KIND, storeId, String(recommendation._id)),
        kind: "replenishment_recommendation",
        label: recommendation.productName,
        capturedAt: input.now,
      },
      {
        ref: mintAgentSourceRef("sku_snapshot", storeId, String(recommendation._id)),
        kind: "sku_snapshot",
        capturedAt: input.now,
      },
    ]),
    page: { hasMore: page.hasMore, rawCursor: page.rawCursor },
  };
};

export const listReplenishment = defineAgentReadPortQuery({ portKey: REPLENISHMENT_PORT_KEY, handler: listReplenishmentHandler });
