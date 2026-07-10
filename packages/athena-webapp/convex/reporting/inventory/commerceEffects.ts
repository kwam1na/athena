import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { resolveReportingOperatingPeriodWithCtx } from "../operatingPeriods";
import {
  applyInventoryEffectWithCtx,
  type ReportingCompleteness,
  type ReportingInventoryEffectType,
  type ReportingSourceDomain,
} from "./effects";
import type {
  InventoryOutboundDisposition,
  InventoryReturnDisposition,
  OutboundValuationBasisSnapshot,
  ValuationCostLane,
} from "./types";

type CommerceEffectBase = {
  activityType: string;
  actorStaffProfileId?: Id<"staffProfile">;
  actorUserId?: Id<"athenaUser">;
  businessEventKey: string;
  completeness?: ReportingCompleteness;
  contentFingerprint: string;
  customerProfileId?: Id<"customerProfile">;
  effectType: ReportingInventoryEffectType;
  movementType: string;
  notes?: string;
  occurrenceAt: number;
  onlineOrderId?: Id<"onlineOrder">;
  organizationId: Id<"organization">;
  posTransactionId?: Id<"posTransaction">;
  productId: Id<"product">;
  productSkuId: Id<"productSku">;
  reasonCode?: string;
  recordedAt?: number;
  registerSessionId?: Id<"registerSession">;
  sellableQuantityDelta: number;
  sourceDomain: ReportingSourceDomain;
  sourceId: string;
  sourceLineId?: string;
  sourceType: string;
  storeId: Id<"store">;
  workItemId?: Id<"operationalWorkItem">;
};

export type CommerceInventoryEffectArgs = CommerceEffectBase &
  (
    | { kind: "availability_only" }
    | {
        disposition: InventoryOutboundDisposition;
        kind: "outbound";
        quantity: number;
      }
    | {
        disposition?: InventoryReturnDisposition;
        financialContribution?: "reverse_original_lane" | "none";
        kind: "return";
        originalBasis?: OutboundValuationBasisSnapshot;
        originalCostLane?: ValuationCostLane;
        quantity: number;
      }
  );

export function uncostedOutboundBasis(
  quantity: number,
): OutboundValuationBasisSnapshot {
  return {
    allocatedKnownCost: 0,
    basisVersion: 0,
    costedQuantity: 0,
    currency: null,
    knownCostPoolBefore: 0,
    roundedWeightedAverageUnitCost: null,
    uncostedQuantity: quantity,
    unresolvedDeficitQuantity: 0,
  };
}

export function outboundBasisFromEffect(
  effect: Pick<
    Doc<"reportingInventoryEffect">,
    | "costedQuantityDelta"
    | "currencyCode"
    | "outboundBasisMinor"
    | "uncostedQuantityDelta"
    | "unresolvedDeficitDelta"
  >,
  quantity: number,
): OutboundValuationBasisSnapshot | null {
  const costedQuantity = Math.max(0, -effect.costedQuantityDelta);
  const uncostedQuantity =
    Math.max(0, -effect.uncostedQuantityDelta) +
    Math.max(0, effect.unresolvedDeficitDelta);
  const allocatedKnownCost = effect.outboundBasisMinor ?? 0;
  if (
    costedQuantity + uncostedQuantity !== quantity ||
    (costedQuantity > 0 && !effect.currencyCode)
  ) {
    return null;
  }
  return {
    allocatedKnownCost,
    basisVersion: 0,
    costedQuantity,
    currency: costedQuantity > 0 ? effect.currencyCode ?? null : null,
    knownCostPoolBefore: allocatedKnownCost,
    roundedWeightedAverageUnitCost:
      costedQuantity > 0
        ? Math.round(allocatedKnownCost / costedQuantity)
        : null,
    uncostedQuantity,
    unresolvedDeficitQuantity: 0,
  };
}

export function reportingLineCostFromEffect(
  effect: Pick<
    Doc<"reportingInventoryEffect">,
    | "costedQuantityDelta"
    | "currencyCode"
    | "outboundBasisMinor"
    | "uncostedQuantityDelta"
    | "unresolvedDeficitDelta"
  > | null,
  quantity: number,
) {
  if (!effect) return { costStatus: "unknown" as const };
  const basis = outboundBasisFromEffect(effect, quantity);
  if (!basis || basis.costedQuantity === 0) {
    return { costStatus: "unknown" as const };
  }
  const uncoveredQuantity =
    basis.uncostedQuantity + basis.unresolvedDeficitQuantity;
  if (uncoveredQuantity > 0) {
    return {
      cogsKnownMinor: basis.allocatedKnownCost,
      cogsKnownQuantity: basis.costedQuantity,
      cogsUncoveredQuantity: uncoveredQuantity,
      costStatus: "partial" as const,
      valuationCurrencyCode: basis.currency ?? undefined,
      valuationCurrencyMinorUnitScale: basis.currency ? 2 : undefined,
    };
  }
  return {
    cogsKnownMinor: basis.allocatedKnownCost,
    costStatus: "known" as const,
    valuationCurrencyCode: basis.currency ?? undefined,
    valuationCurrencyMinorUnitScale: basis.currency ? 2 : undefined,
  };
}

export async function applyCommerceInventoryEffectWithCtx(
  ctx: MutationCtx,
  args: CommerceInventoryEffectArgs,
) {
  const sku = await ctx.db.get("productSku", args.productSkuId);
  if (
    !sku ||
    sku.storeId !== args.storeId ||
    sku.productId !== args.productId
  ) {
    throw new Error("Commerce inventory SKU could not be found for this store.");
  }
  const returnDisposition =
    args.kind === "return" ? args.disposition ?? "sellable" : null;
  const physicalQuantityDelta =
    args.kind === "outbound"
      ? -args.quantity
      : args.kind === "return"
        ? returnDisposition === "sellable"
          ? args.quantity
          : 0
        : 0;
  const nextOnHand = Math.max(0, sku.inventoryCount + physicalQuantityDelta);
  const nextSellable = Math.min(
    nextOnHand,
    Math.max(0, sku.quantityAvailable + args.sellableQuantityDelta),
  );
  const period = await resolveReportingOperatingPeriodWithCtx(ctx, {
    occurrenceAt: args.occurrenceAt,
    storeId: args.storeId,
  });

  return applyInventoryEffectWithCtx(ctx, {
    activityStatus: "committed",
    activityType: args.activityType,
    actorStaffProfileId: args.actorStaffProfileId,
    actorUserId: args.actorUserId,
    businessEventKey: args.businessEventKey,
    compatibilityBalance: {
      onHandQuantity: nextOnHand,
      sellableQuantity: nextSellable,
    },
    completeness:
      period.kind === "resolved" ? args.completeness ?? "complete" : "partial",
    contentFingerprint: args.contentFingerprint,
    customerProfileId: args.customerProfileId,
    effectType: args.effectType,
    movementType: args.movementType,
    notes: args.notes,
    occurrenceAt: args.occurrenceAt,
    onlineOrderId: args.onlineOrderId,
    ...(period.kind === "resolved"
      ? {
          operatingDate: period.operatingDate,
          scheduleVersionId: period.scheduleVersionId as Id<"storeSchedule">,
        }
      : {}),
    organizationId: args.organizationId,
    physicalQuantityDelta,
    posTransactionId: args.posTransactionId,
    productId: args.productId,
    productSkuId: args.productSkuId,
    reasonCode: args.reasonCode,
    recordedAt: args.recordedAt ?? Date.now(),
    registerSessionId: args.registerSessionId,
    sellableQuantityDelta: nextSellable - sku.quantityAvailable,
    sourceDomain: args.sourceDomain,
    sourceId: args.sourceId,
    sourceLineId: args.sourceLineId,
    sourceType: args.sourceType,
    storeId: args.storeId,
    valuation:
      args.kind === "availability_only"
        ? { kind: "availability_only" }
        : args.kind === "outbound"
          ? {
              disposition: args.disposition,
              kind: "outbound",
              quantity: args.quantity,
            }
          : {
              disposition: returnDisposition!,
              financialContribution:
                args.financialContribution ??
                (returnDisposition === "sellable"
                  ? "reverse_original_lane"
                  : "none"),
              kind: "return",
              originalBasis:
                args.originalBasis ?? uncostedOutboundBasis(args.quantity),
              originalCostLane: args.originalCostLane ?? "merchandise_cogs",
              quantity: args.quantity,
            },
    workItemId: args.workItemId,
  });
}
