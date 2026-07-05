export type SkuActivityUntrustedSalesReviewStatus = "open" | "reviewed" | "all";

export type SkuActivityUntrustedSalesSourceFilter =
  | "all"
  | "legacy_import"
  | "pending_checkout";

export type SkuActivityUntrustedSalesSourceType =
  | "inventoryImportProvisionalSku"
  | "posPendingCheckoutItem";

export type SkuActivityUntrustedSalesQueryResult = {
  hasMoreSources: boolean;
  reviewStatus: SkuActivityUntrustedSalesReviewStatus;
  selected: {
    source: SkuActivityUntrustedSalesSourceResult;
    transactionHistory: {
      isTruncated: boolean;
      rows: SkuActivityUntrustedSalesTransactionResult[];
    };
  } | null;
  sourceFilter: SkuActivityUntrustedSalesSourceFilter;
  sourceLimit: number;
  sources: SkuActivityUntrustedSalesSourceResult[];
  totalSourceCount: number;
} | null;

export type SkuActivityUntrustedSalesSourceResult = {
  evidence: {
    lastPosTransactionId?: string | null;
    lastSoldAt: number | null;
    observedLookupCodes?: string[];
    observedPrices?: number[];
    offlineSaleCount?: number;
    saleCount: number;
    totalQuantitySold: number;
  };
  id: string;
  importKey?: string;
  lastActivityAt: number;
  lookupCode?: string | null;
  operationalWorkItemId?: string | null;
  productId?: string | null;
  productSkuId?: string | null;
  reviewPriority?: string;
  reviewState: "open" | "reviewed";
  reviewVersionNumber?: number;
  rowNumber?: number;
  sku?: string | null;
  sourceType: SkuActivityUntrustedSalesSourceType;
  status: string;
  title: string;
  unitPrice?: number;
  updatedAt: number;
};

export type SkuActivityUntrustedSalesTransactionResult = {
  adjustments: {
    appliedQuantityDelta: number;
    count: number;
    isTruncated: boolean;
    latestAppliedAt: number | null;
    latestStatus: string | null;
  };
  completedAt: number;
  id: string;
  isRefunded: boolean;
  netQuantity: number;
  productId: string;
  productName: string;
  productSku: string;
  productSkuId: string;
  quantity: number;
  refundedAt: number | null;
  refundedQuantity: number;
  registerNumber?: string | null;
  totalPrice: number;
  transactionId: string;
  transactionNumber: string;
  transactionStatus: string;
  unitPrice: number;
};

export type SkuActivityUntrustedSalesSourceRow = {
  evidenceLabel: string;
  id: string;
  isSelected: boolean;
  lastActivityAt: number;
  lookupLabel: string | null;
  productId?: string | null;
  productSkuId?: string | null;
  reviewLabel: string;
  reviewState: "open" | "reviewed";
  saleCount: number;
  sourceType: SkuActivityUntrustedSalesSourceType;
  sourceTypeLabel: string;
  statusLabel: string;
  title: string;
  totalQuantitySold: number;
};

export type SkuActivityUntrustedSalesTransactionRow = {
  adjustmentLabel: string | null;
  completedAt: number;
  grossQuantity: number;
  id: string;
  netQuantity: number;
  productLabel: string;
  receiptLabel: string;
  refundedQuantity: number;
  statusLabel: string;
  transactionId: string;
};

export type SkuActivityUntrustedSalesViewModel = {
  emptyMessage: string;
  hasMoreSources: boolean;
  reviewStatus: SkuActivityUntrustedSalesReviewStatus;
  selected: {
    source: SkuActivityUntrustedSalesSourceRow;
    transactionsAreTruncated: boolean;
    transactionRows: SkuActivityUntrustedSalesTransactionRow[];
  } | null;
  sourceFilter: SkuActivityUntrustedSalesSourceFilter;
  sourceLimit: number;
  sourceRows: SkuActivityUntrustedSalesSourceRow[];
  summary: {
    openCount: number;
    reviewedCount: number;
    totalQuantitySold: number;
    totalSourceCount: number;
    visibleSourceCount: number;
  };
};

function capitalizeWords(value: string) {
  return value
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return count === 1 ? singular : plural;
}

function formatEvidenceLabel(source: SkuActivityUntrustedSalesSourceResult) {
  const saleCount = source.evidence.saleCount;
  const quantity = source.evidence.totalQuantitySold;

  return `${quantity.toLocaleString()} ${pluralize(
    quantity,
    "unit",
  )} across ${saleCount.toLocaleString()} ${pluralize(saleCount, "sale")}`;
}

function sourceMatchesFilter(
  source: SkuActivityUntrustedSalesSourceResult,
  filter: SkuActivityUntrustedSalesSourceFilter,
) {
  if (filter === "all") {
    return true;
  }

  if (filter === "legacy_import") {
    return source.sourceType === "inventoryImportProvisionalSku";
  }

  return source.sourceType === "posPendingCheckoutItem";
}

export function getUntrustedSourceTypeLabel(
  sourceType: SkuActivityUntrustedSalesSourceType,
) {
  return sourceType === "inventoryImportProvisionalSku"
    ? "Legacy import"
    : "POS pending checkout";
}

function getLookupLabel(source: SkuActivityUntrustedSalesSourceResult) {
  if (source.lookupCode && source.sku && source.lookupCode !== source.sku) {
    return `${source.lookupCode} / ${source.sku}`;
  }

  return source.lookupCode ?? source.sku ?? null;
}

function buildSourceRow(
  source: SkuActivityUntrustedSalesSourceResult,
  selectedSourceId?: string,
): SkuActivityUntrustedSalesSourceRow {
  return {
    evidenceLabel: formatEvidenceLabel(source),
    id: source.id,
    isSelected: source.id === selectedSourceId,
    lastActivityAt: source.lastActivityAt,
    lookupLabel: getLookupLabel(source),
    productId: source.productId,
    productSkuId: source.productSkuId,
    reviewLabel: source.reviewState === "open" ? "Needs review" : "Reviewed",
    reviewState: source.reviewState,
    saleCount: source.evidence.saleCount,
    sourceType: source.sourceType,
    sourceTypeLabel: getUntrustedSourceTypeLabel(source.sourceType),
    statusLabel: capitalizeWords(source.status),
    title: source.title,
    totalQuantitySold: source.evidence.totalQuantitySold,
  };
}

function buildTransactionRow(
  transaction: SkuActivityUntrustedSalesTransactionResult,
): SkuActivityUntrustedSalesTransactionRow {
  const adjustmentLabel =
    transaction.adjustments.count > 0
      ? `${transaction.adjustments.appliedQuantityDelta >= 0 ? "+" : ""}${
          transaction.adjustments.appliedQuantityDelta
        } applied adjustment`
      : null;

  return {
    adjustmentLabel,
    completedAt: transaction.completedAt,
    grossQuantity: transaction.quantity,
    id: transaction.id,
    netQuantity: transaction.netQuantity,
    productLabel: transaction.productSku
      ? `${transaction.productName} (${transaction.productSku})`
      : transaction.productName,
    receiptLabel: transaction.transactionNumber
      ? `#${transaction.transactionNumber}`
      : String(transaction.transactionId),
    refundedQuantity: transaction.refundedQuantity,
    statusLabel: capitalizeWords(transaction.transactionStatus),
    transactionId: transaction.transactionId,
  };
}

function getEmptyMessage(filter: SkuActivityUntrustedSalesSourceFilter) {
  switch (filter) {
    case "legacy_import":
      return "No legacy import SKUs with sale evidence match this view.";
    case "pending_checkout":
      return "No POS pending checkout items with sale evidence match this view.";
    default:
      return "No untrusted SKU sale evidence matches this view.";
  }
}

export function buildSkuActivityUntrustedSalesViewModel(
  result: SkuActivityUntrustedSalesQueryResult,
  options: {
    sourceFilter?: SkuActivityUntrustedSalesSourceFilter;
    selectedSourceId?: string;
  } = {},
): SkuActivityUntrustedSalesViewModel | null {
  if (!result) {
    return null;
  }

  const sourceFilter = options.sourceFilter ?? result.sourceFilter ?? "all";
  const selectedSourceId =
    options.selectedSourceId ?? result.selected?.source.id;
  const visibleSources = result.sources.filter((source) =>
    sourceMatchesFilter(source, sourceFilter),
  );
  const sourceRows = visibleSources.map((source) =>
    buildSourceRow(source, selectedSourceId),
  );
  const selectedSource =
    result.selected && sourceMatchesFilter(result.selected.source, sourceFilter)
      ? result.selected
      : null;

  return {
    emptyMessage: getEmptyMessage(sourceFilter),
    hasMoreSources: result.hasMoreSources,
    reviewStatus: result.reviewStatus,
    selected: selectedSource
      ? {
          source: buildSourceRow(
            selectedSource.source,
            selectedSource.source.id,
          ),
          transactionsAreTruncated:
            selectedSource.transactionHistory.isTruncated,
          transactionRows:
            selectedSource.transactionHistory.rows.map(buildTransactionRow),
        }
      : null,
    sourceFilter,
    sourceLimit: result.sourceLimit,
    sourceRows,
    summary: {
      openCount: visibleSources.filter(
        (source) => source.reviewState === "open",
      ).length,
      reviewedCount: visibleSources.filter(
        (source) => source.reviewState === "reviewed",
      ).length,
      totalQuantitySold: visibleSources.reduce(
        (total, source) => total + source.evidence.totalQuantitySold,
        0,
      ),
      totalSourceCount: result.totalSourceCount,
      visibleSourceCount: visibleSources.length,
    },
  };
}
