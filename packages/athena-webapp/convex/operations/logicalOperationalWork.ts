import type { Doc, Id } from "../_generated/dataModel";

export const MAX_ATOMIC_SYNCED_SALE_REVIEW_GROUP_SIZE = 50;

export type LogicalWorkSourceCompleteness = "complete" | "incomplete";
export type LogicalWorkResolutionAvailability =
  | "available"
  | "budget_exceeded"
  | "remediation_in_progress"
  | "source_incomplete";

export type LogicalOperationalWorkGroup = {
  completeness: LogicalWorkSourceCompleteness;
  items: Array<Doc<"operationalWorkItem">>;
  key: string;
  oldestActionableAt: number;
  priority: string;
  productSkuId: Id<"productSku"> | null;
  representative: Doc<"operationalWorkItem">;
  representatives: Array<Doc<"operationalWorkItem">>;
  resolutionAvailability: LogicalWorkResolutionAvailability;
  sourceIdentities: string[];
  status: string;
};

export type LogicalOperationalWorkProjection = {
  completeness: LogicalWorkSourceCompleteness;
  groups: LogicalOperationalWorkGroup[];
  observedCount: number;
};

export function operationalWorkMetadataString(
  metadata: Record<string, unknown> | undefined,
  key: string,
) {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function joinSourceIdentity(parts: Array<string | null | undefined>) {
  return parts.filter((part): part is string => Boolean(part)).join(":");
}

export function stableOperationalWorkItemSourceIdentity(
  item: Doc<"operationalWorkItem">,
) {
  const metadata = item.metadata;

  switch (item.type) {
    case "catalog_taxonomy_setup": {
      const productId = operationalWorkMetadataString(metadata, "productId");
      if (productId) return joinSourceIdentity([item.type, productId]);
      break;
    }
    case "daily_close_carry_forward": {
      const businessDate = operationalWorkMetadataString(
        metadata,
        "businessDate",
      );
      const sourceId =
        operationalWorkMetadataString(metadata, "carryForwardSourceId") ??
        operationalWorkMetadataString(metadata, "dailyCloseId") ??
        operationalWorkMetadataString(metadata, "sourceId");
      if (businessDate || sourceId) {
        return joinSourceIdentity([
          item.type,
          businessDate ?? String(item.storeId),
          sourceId ?? String(item._id),
        ]);
      }
      break;
    }
    case "pos_pending_checkout_item_review": {
      const pendingCheckoutItemId =
        operationalWorkMetadataString(metadata, "posPendingCheckoutItemId") ??
        operationalWorkMetadataString(metadata, "pendingCheckoutItemId");
      if (pendingCheckoutItemId) {
        return joinSourceIdentity([item.type, pendingCheckoutItemId]);
      }
      const localIdentity = joinSourceIdentity([
        item.type,
        String(item.storeId),
        operationalWorkMetadataString(metadata, "terminalId"),
        operationalWorkMetadataString(metadata, "localRegisterSessionId"),
        "pendingCheckoutItem",
        operationalWorkMetadataString(metadata, "localPendingCheckoutItemId") ??
          operationalWorkMetadataString(metadata, "localId") ??
          operationalWorkMetadataString(metadata, "localItemId"),
      ]);
      if (localIdentity !== item.type) return localIdentity;
      break;
    }
    case "purchase_order": {
      const purchaseOrderId = operationalWorkMetadataString(
        metadata,
        "purchaseOrderId",
      );
      if (purchaseOrderId) return joinSourceIdentity([item.type, purchaseOrderId]);
      break;
    }
    case "service_appointment": {
      const appointmentId = item.appointmentId
        ? String(item.appointmentId)
        : operationalWorkMetadataString(metadata, "appointmentId");
      if (appointmentId) return joinSourceIdentity([item.type, appointmentId]);
      break;
    }
    case "service_case": {
      const serviceCaseId =
        operationalWorkMetadataString(metadata, "serviceCaseId") ??
        operationalWorkMetadataString(metadata, "sourceId");
      if (serviceCaseId) return joinSourceIdentity([item.type, serviceCaseId]);
      break;
    }
    case "stock_adjustment_review": {
      const batchId = operationalWorkMetadataString(
        metadata,
        "stockAdjustmentBatchId",
      );
      if (item.approvalRequestId || batchId) {
        return joinSourceIdentity([
          item.type,
          item.approvalRequestId ? String(item.approvalRequestId) : null,
          batchId,
        ]);
      }
      break;
    }
    case "synced_sale_inventory_review": {
      const localTransactionId = operationalWorkMetadataString(
        metadata,
        "localTransactionId",
      );
      const localRegisterSessionId = operationalWorkMetadataString(
        metadata,
        "localRegisterSessionId",
      );
      const localSaleDiscriminator =
        localTransactionId ??
        operationalWorkMetadataString(metadata, "localEventId") ??
        operationalWorkMetadataString(metadata, "receiptNumber");
      if (localSaleDiscriminator) {
        return joinSourceIdentity([
          item.type,
          String(item.storeId),
          operationalWorkMetadataString(metadata, "terminalId"),
          localRegisterSessionId,
          localSaleDiscriminator,
        ]);
      }
      break;
    }
  }

  const sourceType = operationalWorkMetadataString(metadata, "sourceType");
  const sourceId = operationalWorkMetadataString(metadata, "sourceId");
  if (sourceType || sourceId) {
    return joinSourceIdentity([
      item.type,
      sourceType,
      sourceId ?? String(item._id),
    ]);
  }
  return joinSourceIdentity([item.type, String(item._id)]);
}

export function canonicalSyncedSaleInventoryReviewSkuId(
  item: Doc<"operationalWorkItem">,
) {
  if (item.type !== "synced_sale_inventory_review") return null;
  return (
    item.productSkuId ??
    (operationalWorkMetadataString(
      item.metadata,
      "primaryProductSkuId",
    ) as Id<"productSku"> | null)
  );
}

function priorityBucket(item: Doc<"operationalWorkItem">) {
  if (
    item.type === "catalog_taxonomy_setup" ||
    item.approvalRequestId ||
    item.approvalState === "pending" ||
    item.type === "stock_adjustment_review"
  ) {
    return 0;
  }
  if (
    item.type === "daily_close_carry_forward" ||
    item.type === "pos_pending_checkout_item_review" ||
    item.type === "synced_sale_inventory_review"
  ) {
    return 1;
  }
  if (
    item.type === "purchase_order" ||
    item.type === "service_appointment" ||
    item.type === "service_case"
  ) {
    return 2;
  }
  return 3;
}

function statusUrgency(item: Doc<"operationalWorkItem">) {
  return item.status === "in_progress" ? 0 : item.status === "open" ? 1 : 2;
}

function operationalPriorityUrgency(priority: string) {
  return priority === "high" ? 0 : priority === "normal" ? 1 : 2;
}

function strongestOperationalPriority(
  items: Array<Doc<"operationalWorkItem">>,
) {
  return items.reduce(
    (strongest, item) =>
      operationalPriorityUrgency(item.priority) <
      operationalPriorityUrgency(strongest)
        ? item.priority
        : strongest,
    items[0]?.priority ?? "normal",
  );
}

function aggregateOperationalStatus(items: Array<Doc<"operationalWorkItem">>) {
  return items.some((item) => item.status === "in_progress")
    ? "in_progress"
    : items.some((item) => item.status === "open")
      ? "open"
      : (items[0]?.status ?? "open");
}

export function operationalWorkActionableTimestamp(
  item: Doc<"operationalWorkItem">,
) {
  return item.dueAt ?? item.startedAt ?? item.createdAt ?? 0;
}

function resolverCompletenessBucket(item: Doc<"operationalWorkItem">) {
  return item.type === "synced_sale_inventory_review" &&
    !canonicalSyncedSaleInventoryReviewSkuId(item)
    ? 1
    : 0;
}

function compareStrings(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function compareOperationalWorkItems(
  left: Doc<"operationalWorkItem">,
  right: Doc<"operationalWorkItem">,
) {
  return (
    priorityBucket(left) - priorityBucket(right) ||
    statusUrgency(left) - statusUrgency(right) ||
    resolverCompletenessBucket(left) - resolverCompletenessBucket(right) ||
    operationalWorkActionableTimestamp(left) -
      operationalWorkActionableTimestamp(right) ||
    compareStrings(
      stableOperationalWorkItemSourceIdentity(left),
      stableOperationalWorkItemSourceIdentity(right),
    ) ||
    compareStrings(String(left._id), String(right._id))
  );
}

function groupKey(item: Doc<"operationalWorkItem">) {
  const productSkuId = canonicalSyncedSaleInventoryReviewSkuId(item);
  if (productSkuId) {
    return `synced_sale_inventory_review:${item.storeId}:${productSkuId}`;
  }
  return item.type === "synced_sale_inventory_review"
    ? stableOperationalWorkItemSourceIdentity(item)
    : `${item.type}:${item._id}`;
}

export function projectLogicalOperationalWork(args: {
  incompleteTypes?: ReadonlySet<string>;
  items: Array<Doc<"operationalWorkItem">>;
  remediationSourceIdentitiesByGroupKey?: ReadonlyMap<
    string,
    ReadonlySet<string>
  >;
  sourceCompleteness: LogicalWorkSourceCompleteness;
}): LogicalOperationalWorkProjection {
  const sortedItems = [...args.items].sort(compareOperationalWorkItems);
  const itemsBySource = new Map<string, Array<Doc<"operationalWorkItem">>>();

  for (const item of sortedItems) {
    const sourceIdentity =
      item.type === "synced_sale_inventory_review"
        ? stableOperationalWorkItemSourceIdentity(item)
        : `${item.type}:${item._id}`;
    const items = itemsBySource.get(sourceIdentity);
    if (items) items.push(item);
    else itemsBySource.set(sourceIdentity, [item]);
  }

  const groupSourcesByKey = new Map<
    string,
    Array<{
      items: Array<Doc<"operationalWorkItem">>;
      representative: Doc<"operationalWorkItem">;
      sourceIdentity: string;
    }>
  >();
  for (const [sourceIdentity, sourceItems] of itemsBySource) {
    const representative = sourceItems[0];
    const baseKey = groupKey(representative);
    const remediationSourceIdentities =
      args.remediationSourceIdentitiesByGroupKey?.get(baseKey);
    const key =
      remediationSourceIdentities &&
      !remediationSourceIdentities.has(sourceIdentity)
        ? `${baseKey}:post_repair`
        : baseKey;
    const sources = groupSourcesByKey.get(key);
    const source = { items: sourceItems, representative, sourceIdentity };
    if (sources) sources.push(source);
    else groupSourcesByKey.set(key, [source]);
  }

  const groups = Array.from(groupSourcesByKey.entries()).map(
    ([key, sources]) => {
      const items = sources.flatMap((source) => source.items);
      const representatives = sources.map((source) => source.representative);
      const oldestActionableAt = Math.min(
        ...items.map(operationalWorkActionableTimestamp),
      );
      const priority = strongestOperationalPriority(items);
      const status = aggregateOperationalStatus(items);
      const completeness =
        args.sourceCompleteness === "incomplete" &&
        (!args.incompleteTypes ||
          args.incompleteTypes.has(representatives[0].type))
          ? "incomplete"
          : "complete";
      const resolutionAvailability =
        completeness === "incomplete"
          ? "source_incomplete"
          : args.remediationSourceIdentitiesByGroupKey?.has(key)
            ? "remediation_in_progress"
            : items.length > MAX_ATOMIC_SYNCED_SALE_REVIEW_GROUP_SIZE
              ? "budget_exceeded"
              : "available";

      return {
        completeness,
        items,
        key,
        oldestActionableAt,
        priority,
        productSkuId: canonicalSyncedSaleInventoryReviewSkuId(
          representatives[0],
        ),
        representative: representatives[0],
        representatives,
        resolutionAvailability,
        sourceIdentities: sources.map((source) => source.sourceIdentity),
        status,
      } satisfies LogicalOperationalWorkGroup;
    }
  );

  groups.sort(
    (left, right) =>
      priorityBucket(left.representative) -
        priorityBucket(right.representative) ||
      resolverCompletenessBucket(left.representative) -
        resolverCompletenessBucket(right.representative) ||
      operationalPriorityUrgency(left.priority) -
        operationalPriorityUrgency(right.priority) ||
      (left.status === "in_progress" ? 0 : 1) -
        (right.status === "in_progress" ? 0 : 1) ||
      left.oldestActionableAt - right.oldestActionableAt ||
      compareStrings(left.key, right.key),
  );

  return {
    completeness: args.sourceCompleteness,
    groups,
    observedCount: groups.length,
  };
}
