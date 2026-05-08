import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Link } from "@tanstack/react-router";
import {
  CheckCircle2,
  ExternalLink,
  Package,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  CYCLE_COUNT_REASON_CODE,
  MANUAL_STOCK_ADJUSTMENT_REASON_CODES,
  STOCK_ADJUSTMENT_APPROVAL_THRESHOLD,
  hasHighStockAdjustmentVariance,
  requiresStockAdjustmentApproval,
  summarizeStockAdjustmentLineItems,
} from "~/shared/stockAdjustment";
import type { Id } from "~/convex/_generated/dataModel";
import { getProductName } from "~/src/lib/productUtils";
import { getOrigin } from "~/src/lib/navigationUtils";
import type { NormalizedCommandResult } from "../../lib/errors/runCommand";
import { presentCommandToast } from "../../lib/errors/presentCommandToast";
import { DataTableColumnHeader } from "../base/table/data-table-column-header";
import { GenericDataTable } from "../base/table/data-table";
import {
  PageLevelHeader,
  PageWorkspace,
  PageWorkspaceGrid,
  PageWorkspaceMain,
  PageWorkspaceRail,
} from "../common/PageLevelHeader";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { LoadingButton } from "../ui/loading-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import { Textarea } from "../ui/textarea";

export type InventorySnapshotItem = {
  _id: Id<"productSku">;
  barcode?: string | null;
  colorName?: string | null;
  checkoutReservedQuantity?: number;
  durableQuantityAvailable?: number;
  imageUrl?: string | null;
  inventoryCount: number;
  length?: number | null;
  posReservedQuantity?: number;
  productCategory?: string | null;
  productId?: Id<"product"> | null;
  productName: string;
  quantityAvailable: number;
  reservedQuantity?: number;
  sku?: string | null;
};

export type SubmitStockAdjustmentArgs = {
  adjustmentType: "manual" | "cycle_count";
  lineItems: Array<
    | {
        productSkuId: Id<"productSku">;
        quantityDelta: number;
      }
    | {
        countedQuantity: number;
        productSkuId: Id<"productSku">;
      }
  >;
  notes?: string;
  reasonCode: string;
  storeId: Id<"store">;
  submissionKey: string;
};

export type StockAdjustmentType = "manual" | "cycle_count";
export type StockAdjustmentAvailabilityFilter =
  | "all"
  | "all_available"
  | "changed"
  | "unavailable";

export type StockAdjustmentSearchState = {
  availability?: StockAdjustmentAvailabilityFilter;
  mode?: StockAdjustmentType;
  page?: number;
  query?: string;
  scope?: string;
  sku?: string;
};

export type StockAdjustmentSearchPatch = Partial<StockAdjustmentSearchState>;

export type CycleCountDraftLine = {
  productSkuId: Id<"productSku">;
  baselineInventoryCount: number;
  baselineAvailableCount: number;
  countedQuantity: number;
  isDirty: boolean;
  staleStatus?: "current" | "stale";
  currentInventoryCount?: number;
  currentAvailableCount?: number;
};

export type CycleCountDraftState = {
  _id: Id<"cycleCountDraft">;
  status: "open" | "submitted" | "discarded";
  scopeKey: string;
  changedLineCount: number;
  staleLineCount: number;
  lastSavedAt?: number;
  lines: CycleCountDraftLine[];
};

export type CycleCountDraftSummary = {
  changedLineCount: number;
  draftCount: number;
  largestAbsoluteDelta: number;
  lastSavedAt?: number;
  netQuantityDelta: number;
  scopeKeys: string[];
  scopeCount: number;
  staleLineCount: number;
};

type SaveCycleCountDraftLineArgs = {
  countedQuantity: number;
  productSkuId: Id<"productSku">;
};

type StockAdjustmentWorkspaceContentProps = {
  cycleCountDraft?: CycleCountDraftState | null;
  cycleCountDraftSummary?: CycleCountDraftSummary | null;
  inventoryItems: InventorySnapshotItem[];
  isCycleCountDraftSaving?: boolean;
  isSubmitting: boolean;
  onDiscardCycleCountDraft?: () => Promise<NormalizedCommandResult<unknown>>;
  onSearchStateChange?: (patch: StockAdjustmentSearchPatch) => void;
  onSaveCycleCountDraftLine?: (
    args: SaveCycleCountDraftLineArgs,
  ) => Promise<NormalizedCommandResult<unknown>>;
  onRefreshCycleCountDraftLineBaseline?: (args: {
    productSkuId: Id<"productSku">;
  }) => Promise<NormalizedCommandResult<unknown>>;
  onSubmitBatch: (
    args: SubmitStockAdjustmentArgs,
  ) => Promise<NormalizedCommandResult<unknown>>;
  onSubmitCycleCountDraft?: (args: {
    notes?: string;
  }) => Promise<NormalizedCommandResult<unknown>>;
  searchState?: StockAdjustmentSearchState;
  storeId?: Id<"store">;
};

type StockAdjustmentRow = {
  inputValue: string;
  inventoryItem: InventorySnapshotItem;
  isEdited: boolean;
  quantityDelta: number;
  submittedLineItem: SubmitStockAdjustmentArgs["lineItems"][number] | null;
};

type CountScopeOption = {
  changedCount: number;
  itemCount: number;
  key: string;
  label: string;
};
type CycleCountSubmissionOutcome = "applied" | "review_required" | null;
type StockAdjustmentFilterState = {
  availability: StockAdjustmentAvailabilityFilter;
  query: string;
};

const MANUAL_REASON_LABELS: Record<
  (typeof MANUAL_STOCK_ADJUSTMENT_REASON_CODES)[number],
  string
> = {
  correction: "Correction",
  damage: "Damage",
  shrinkage: "Shrinkage",
  vendor_return: "Vendor return",
};

const UNCATEGORIZED_SCOPE_KEY = "__uncategorized";
const INVENTORY_NUMBER_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  notation: "compact",
});
const STOCK_ADJUSTMENT_AVAILABILITY_FILTER_LABELS: Record<
  StockAdjustmentAvailabilityFilter,
  string
> = {
  all: "All SKUs",
  all_available: "All available",
  changed: "Changed SKUs",
  unavailable: "Reserved",
};

function getCountScopeKey(item: InventorySnapshotItem) {
  return item.productCategory?.trim() || UNCATEGORIZED_SCOPE_KEY;
}

function getCountScopeLabel(key: string) {
  return key === UNCATEGORIZED_SCOPE_KEY ? "Uncategorized" : key;
}

function buildManualDrafts(inventoryItems: InventorySnapshotItem[]) {
  return Object.fromEntries(inventoryItems.map((item) => [item._id, ""]));
}

function buildCycleCountDrafts(
  inventoryItems: InventorySnapshotItem[],
  draftLines: CycleCountDraftLine[] = [],
) {
  const draftLineMap = new Map(
    draftLines.map((line) => [line.productSkuId, line]),
  );

  return Object.fromEntries(
    inventoryItems.map((item) => [
      item._id,
      String(
        draftLineMap.get(item._id)?.countedQuantity ?? item.inventoryCount,
      ),
    ]),
  );
}

function buildStockAdjustmentSubmissionKey(
  adjustmentType: StockAdjustmentType,
) {
  return `stock-adjustment-${adjustmentType}-${Date.now().toString(36)}`;
}

function trimOptional(value?: string | null) {
  const nextValue = value?.trim();
  return nextValue ? nextValue : undefined;
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return count === 1 ? singular : plural;
}

function formatInventoryNumber(value: number) {
  return INVENTORY_NUMBER_FORMATTER.format(value).toLowerCase();
}

function getInventoryItemDisplayName(item: InventorySnapshotItem) {
  return getProductName(item) || item.sku || String(item._id);
}

function getReservationLabels(item: InventorySnapshotItem) {
  const checkoutReservedQuantity = item.checkoutReservedQuantity ?? 0;
  const posReservedQuantity = item.posReservedQuantity ?? 0;
  const knownReservedQuantity =
    checkoutReservedQuantity + posReservedQuantity;
  const fallbackReservedQuantity = Math.max(
    0,
    (item.reservedQuantity ?? 0) - knownReservedQuantity,
  );

  return [
    checkoutReservedQuantity > 0
      ? {
          title: `${formatInventoryNumber(checkoutReservedQuantity)} reserved in active checkout sessions`,
          value: `${formatInventoryNumber(checkoutReservedQuantity)} checkout`,
        }
      : null,
    posReservedQuantity > 0
      ? {
          title: `${formatInventoryNumber(posReservedQuantity)} reserved in POS sessions`,
          value: `${formatInventoryNumber(posReservedQuantity)} POS`,
        }
      : null,
    fallbackReservedQuantity > 0
      ? {
          title: `${formatInventoryNumber(fallbackReservedQuantity)} reserved`,
          value: `${formatInventoryNumber(fallbackReservedQuantity)} reserved`,
        }
      : null,
  ].filter(
    (label): label is { title: string; value: string } => label !== null,
  );
}

function formatReservationSourceSummary(args: {
  checkoutReservedUnits: number;
  fallbackReservedUnits: number;
  posReservedUnits: number;
}) {
  return [
    args.checkoutReservedUnits > 0
      ? `${formatInventoryNumber(
          args.checkoutReservedUnits,
        )} reserved in active checkout sessions.`
      : null,
    args.posReservedUnits > 0
      ? `${formatInventoryNumber(args.posReservedUnits)} reserved in POS sessions.`
      : null,
    args.fallbackReservedUnits > 0
      ? `${formatInventoryNumber(args.fallbackReservedUnits)} reserved.`
      : null,
  ]
    .filter(Boolean)
    .join(" ");
}

function getSkuDetailEntries(item: InventorySnapshotItem) {
  const reservationLabels = getReservationLabels(item);

  return [
    item.sku ? { label: "SKU", value: item.sku } : null,
    item.barcode ? { label: "Barcode", value: item.barcode } : null,
    item.productCategory
      ? { label: "Category", value: item.productCategory }
      : null,
    item.length !== null && item.length !== undefined
      ? { label: "Length", value: `${item.length}"` }
      : null,
    item.colorName ? { label: "Color", value: item.colorName } : null,
    reservationLabels.length > 0
      ? {
          label: "Reserved",
          value: reservationLabels.map((entry) => entry.title).join(", "),
        }
      : null,
  ].filter(
    (entry): entry is { label: string; value: string } =>
      entry !== null && entry.value.trim().length > 0,
  );
}

function normalizeStockAdjustmentSearch(value?: string | null) {
  return value?.trim().toLowerCase() ?? "";
}

function parseCountScopeKeys(value?: string | null) {
  return (
    value
      ?.split(",")
      .map((scope) => scope.trim())
      .filter(Boolean) ?? []
  );
}

function serializeCountScopeKeys(keys: string[]) {
  return keys.length > 0 ? keys.join(",") : undefined;
}

function rowMatchesStockAdjustmentSearch(
  row: StockAdjustmentRow,
  query: string,
) {
  if (!query) return true;

  const item = row.inventoryItem;
  const searchableText = [
    getInventoryItemDisplayName(item),
    item.sku,
    item.barcode,
    item.colorName,
    item.productCategory,
    item.length === null || item.length === undefined
      ? undefined
      : String(item.length),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return searchableText.includes(query);
}

function rowMatchesAvailabilityFilter(
  row: StockAdjustmentRow,
  availability: StockAdjustmentAvailabilityFilter,
) {
  if (availability === "all") return true;
  if (availability === "changed") return row.isEdited;

  const item = row.inventoryItem;
  const isAllAvailable = item.inventoryCount === item.quantityAvailable;

  return availability === "all_available" ? isAllAvailable : !isAllAvailable;
}

export function SkuDetailPanel({
  activeInventoryItem,
}: {
  activeInventoryItem: InventorySnapshotItem | null;
}) {
  const activeInventoryItemDetails = activeInventoryItem
    ? getSkuDetailEntries(activeInventoryItem)
    : [];

  return (
    <div className="space-y-layout-sm">
      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        SKU detail
      </p>
      <div className="overflow-hidden rounded-md bg-muted/30">
        {activeInventoryItem?.imageUrl ? (
          <img
            alt={getInventoryItemDisplayName(activeInventoryItem)}
            className="aspect-square w-full object-cover"
            src={activeInventoryItem.imageUrl}
          />
        ) : (
          <div className="flex aspect-square w-full items-center justify-center bg-muted">
            <Package
              aria-label="SKU image unavailable"
              className="h-8 w-8 text-muted-foreground"
            />
          </div>
        )}
      </div>
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          {activeInventoryItem ? (
            <p className="line-clamp-2 text-sm font-medium text-foreground">
              {getInventoryItemDisplayName(activeInventoryItem)}
            </p>
          ) : null}
          {activeInventoryItem?.productId ? (
            <Link
              aria-label={`View product detail for ${getInventoryItemDisplayName(
                activeInventoryItem,
              )}`}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              params={(prev) => ({
                ...prev,
                orgUrlSlug: prev.orgUrlSlug!,
                productSlug: activeInventoryItem.productId!,
                storeUrlSlug: prev.storeUrlSlug!,
              })}
              search={{
                o: getOrigin(),
                variant: activeInventoryItem?.sku || undefined,
              }}
              to="/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug"
            >
              View
              <ExternalLink className="h-3 w-3" />
            </Link>
          ) : null}
        </div>
        {activeInventoryItemDetails.length > 0 ? (
          <dl className="grid grid-cols-2 gap-x-layout-md gap-y-layout-md pt-layout-xs text-xs">
            {activeInventoryItemDetails.map((entry) => (
              <div className="min-w-0" key={entry.label}>
                <dt className="font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  {entry.label}
                </dt>
                <dd className="mt-0.5 truncate text-foreground capitalize">
                  {entry.value}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
    </div>
  );
}

export function StockAdjustmentWorkspaceContent({
  cycleCountDraft,
  cycleCountDraftSummary,
  inventoryItems,
  isCycleCountDraftSaving = false,
  isSubmitting,
  onDiscardCycleCountDraft,
  onRefreshCycleCountDraftLineBaseline,
  onSearchStateChange,
  onSaveCycleCountDraftLine,
  onSubmitBatch,
  onSubmitCycleCountDraft,
  searchState,
  storeId,
}: StockAdjustmentWorkspaceContentProps) {
  const [adjustmentType, setAdjustmentType] = useState<StockAdjustmentType>(
    searchState?.mode ?? "cycle_count",
  );
  const [submissionKey, setSubmissionKey] = useState(() =>
    buildStockAdjustmentSubmissionKey(searchState?.mode ?? "cycle_count"),
  );
  const [reasonCode, setReasonCode] = useState<
    (typeof MANUAL_STOCK_ADJUSTMENT_REASON_CODES)[number]
  >(MANUAL_STOCK_ADJUSTMENT_REASON_CODES[0]);
  const [notes, setNotes] = useState("");
  const [manualDeltas, setManualDeltas] = useState<Record<string, string>>(() =>
    buildManualDrafts(inventoryItems),
  );
  const [cycleCounts, setCycleCounts] = useState<Record<string, string>>(() =>
    buildCycleCountDrafts(inventoryItems, cycleCountDraft?.lines),
  );
  const [activeInventoryItemId, setActiveInventoryItemId] =
    useState<Id<"productSku"> | null>(
      (searchState?.sku as Id<"productSku"> | undefined) ??
        inventoryItems[0]?._id ??
        null,
    );
  const [selectedCountScopeKeys, setSelectedCountScopeKeys] = useState<
    string[]
  >(() => parseCountScopeKeys(searchState?.scope));
  const [filters, setFilters] = useState<StockAdjustmentFilterState>({
    availability: searchState?.availability ?? "all",
    query: searchState?.query ?? "",
  });
  const [cycleCountSubmissionOutcome, setCycleCountSubmissionOutcome] =
    useState<CycleCountSubmissionOutcome>(null);
  const [pendingCycleCountSaveCount, setPendingCycleCountSaveCount] =
    useState(0);
  const pendingCycleCountSavePromisesRef = useRef<Promise<void>[]>([]);
  const locallyEditedCycleCountItemIdsRef = useRef(new Set<Id<"productSku">>());
  const [staleDraftLines, setStaleDraftLines] = useState<
    Array<{
      productSkuId: Id<"productSku">;
      productName?: string | null;
      sku?: string | null;
      currentInventoryCount: number;
      baselineInventoryCount: number;
    }>
  >([]);

  useEffect(() => {
    if (!searchState?.mode || searchState.mode === adjustmentType) return;

    setAdjustmentType(searchState.mode);
    setSubmissionKey(buildStockAdjustmentSubmissionKey(searchState.mode));
    if (searchState.mode === "manual") {
      setCycleCountSubmissionOutcome(null);
    }
  }, [adjustmentType, searchState?.mode]);

  useEffect(() => {
    if (searchState?.scope === undefined) return;

    setSelectedCountScopeKeys(parseCountScopeKeys(searchState.scope));
  }, [searchState?.scope]);

  useEffect(() => {
    if (searchState?.sku === undefined) return;

    setActiveInventoryItemId(
      searchState.sku
        ? (searchState.sku as Id<"productSku">)
        : (inventoryItems[0]?._id ?? null),
    );
  }, [inventoryItems, searchState?.sku]);

  useEffect(() => {
    setFilters((current) => ({
      availability: searchState?.availability ?? current.availability,
      query:
        searchState?.query === undefined ? current.query : searchState.query,
    }));
  }, [searchState?.availability, searchState?.query]);

  const handleSelectInventoryItem = useCallback(
    (itemId: Id<"productSku"> | null) => {
      setActiveInventoryItemId(itemId);
      onSearchStateChange?.({ sku: itemId ?? undefined });
    },
    [onSearchStateChange],
  );

  useEffect(() => {
    setManualDeltas(buildManualDrafts(inventoryItems));
    setCycleCounts((current) => {
      const serverCounts = buildCycleCountDrafts(
        inventoryItems,
        cycleCountDraft?.lines,
      );

      return Object.fromEntries(
        inventoryItems.map((item) => [
          item._id,
          locallyEditedCycleCountItemIdsRef.current.has(item._id)
            ? (current[item._id] ?? serverCounts[item._id])
            : serverCounts[item._id],
        ]),
      );
    });
  }, [cycleCountDraft?.lines, inventoryItems]);

  useEffect(() => {
    if (
      activeInventoryItemId &&
      inventoryItems.some((item) => item._id === activeInventoryItemId)
    ) {
      return;
    }

    setActiveInventoryItemId(inventoryItems[0]?._id ?? null);
  }, [activeInventoryItemId, inventoryItems]);

  const cycleCountDraftLineMap = useMemo(
    () =>
      new Map(
        (cycleCountDraft?.lines ?? []).map((line) => [line.productSkuId, line]),
      ),
    [cycleCountDraft?.lines],
  );
  const saveCycleCountDraftValue = useCallback(
    async (productSkuId: Id<"productSku">, value: string) => {
      if (adjustmentType !== "cycle_count" || !onSaveCycleCountDraftLine) {
        return;
      }

      const parsedCount = value.trim() === "" ? Number.NaN : Number(value);
      if (!Number.isInteger(parsedCount) || parsedCount < 0) {
        return;
      }

      const savePromise = onSaveCycleCountDraftLine({
        countedQuantity: parsedCount,
        productSkuId,
      })
        .then((result) => {
          if (result.kind !== "ok") {
            presentCommandToast(result);
            return;
          }

          locallyEditedCycleCountItemIdsRef.current.delete(productSkuId);
        })
        .finally(() => {
          pendingCycleCountSavePromisesRef.current =
            pendingCycleCountSavePromisesRef.current.filter(
              (pendingSave) => pendingSave !== savePromise,
            );
          setPendingCycleCountSaveCount(
            pendingCycleCountSavePromisesRef.current.length,
          );
        });

      pendingCycleCountSavePromisesRef.current = [
        ...pendingCycleCountSavePromisesRef.current,
        savePromise,
      ];
      setPendingCycleCountSaveCount(
        pendingCycleCountSavePromisesRef.current.length,
      );

      await savePromise;
    },
    [adjustmentType, onSaveCycleCountDraftLine],
  );

  const rows: StockAdjustmentRow[] = useMemo(
    () =>
      inventoryItems.map((item) => {
        if (adjustmentType === "manual") {
          const rawDelta = manualDeltas[item._id] ?? "";
          const parsedDelta = rawDelta.trim() === "" ? 0 : Number(rawDelta);
          const isEdited = Number.isInteger(parsedDelta) && parsedDelta !== 0;

          return {
            inputValue: rawDelta,
            inventoryItem: item,
            isEdited,
            quantityDelta: isEdited ? parsedDelta : 0,
            submittedLineItem: isEdited
              ? ({
                  productSkuId: item._id,
                  quantityDelta: parsedDelta,
                } as const)
              : null,
          };
        }

        const draftLine = cycleCountDraftLineMap.get(item._id);
        const baselineInventoryCount =
          draftLine?.baselineInventoryCount ?? item.inventoryCount;
        const rawCount =
          cycleCounts[item._id] ??
          String(draftLine?.countedQuantity ?? item.inventoryCount);
        const parsedCount =
          rawCount.trim() === "" ? Number.NaN : Number(rawCount);
        const quantityDelta = Number.isInteger(parsedCount)
          ? parsedCount - baselineInventoryCount
          : 0;
        const isEdited =
          Number.isInteger(parsedCount) &&
          parsedCount >= 0 &&
          parsedCount !== baselineInventoryCount;

        return {
          countedQuantity: parsedCount,
          inputValue: rawCount,
          inventoryItem: item,
          isEdited,
          quantityDelta,
          submittedLineItem: isEdited
            ? ({
                countedQuantity: parsedCount,
                productSkuId: item._id,
              } as const)
            : null,
        };
      }),
    [
      adjustmentType,
      cycleCountDraftLineMap,
      cycleCounts,
      inventoryItems,
      manualDeltas,
    ],
  );

  const changedRows = rows.filter((row) => row.submittedLineItem);
  const countScopeOptions: CountScopeOption[] = useMemo(() => {
    const scopes = new Map<string, CountScopeOption>();

    for (const row of rows) {
      const key = getCountScopeKey(row.inventoryItem);
      const existing = scopes.get(key) ?? {
        changedCount: 0,
        itemCount: 0,
        key,
        label: getCountScopeLabel(key),
      };

      existing.itemCount += 1;
      if (row.submittedLineItem) {
        existing.changedCount += 1;
      }

      scopes.set(key, existing);
    }

    return Array.from(scopes.values()).sort((a, b) =>
      a.label.localeCompare(b.label),
    );
  }, [rows]);
  const selectedCountScopes = countScopeOptions.filter((scope) =>
    selectedCountScopeKeys.includes(scope.key),
  );
  const selectedCountScope = selectedCountScopes[0] ?? null;
  const selectedCountScopeKeySet = useMemo(
    () => new Set(selectedCountScopeKeys),
    [selectedCountScopeKeys],
  );
  const scopedRows = useMemo(
    () =>
      selectedCountScopeKeys.length > 0
        ? rows.filter((row) =>
            selectedCountScopeKeySet.has(getCountScopeKey(row.inventoryItem)),
          )
        : rows,
    [rows, selectedCountScopeKeySet, selectedCountScopeKeys],
  );
  const normalizedFilterQuery = normalizeStockAdjustmentSearch(filters.query);
  const filteredRows = useMemo(
    () =>
      scopedRows.filter(
        (row) =>
          rowMatchesStockAdjustmentSearch(row, normalizedFilterQuery) &&
          rowMatchesAvailabilityFilter(row, filters.availability),
      ),
    [filters.availability, normalizedFilterQuery, scopedRows],
  );
  const unavailableCountScopeKeys = useMemo(() => {
    const keys = new Set<string>();

    for (const row of rows) {
      const item = row.inventoryItem;

      if (item.inventoryCount > item.quantityAvailable) {
        keys.add(getCountScopeKey(item));
      }
    }

    return Array.from(keys).sort();
  }, [rows]);
  const isUnavailableScopeSelectionActive =
    filters.availability === "unavailable" &&
    unavailableCountScopeKeys.length > 0 &&
    (adjustmentType === "cycle_count"
      ? selectedCountScopeKeys.length === 1 &&
        selectedCountScopeKeys[0] === unavailableCountScopeKeys[0]
      : selectedCountScopeKeys.length === unavailableCountScopeKeys.length &&
        unavailableCountScopeKeys.every((key) =>
          selectedCountScopeKeySet.has(key),
        ));
  const summary = summarizeStockAdjustmentLineItems(
    changedRows.map((row) => ({
      quantityDelta: row.quantityDelta,
    })),
  );
  const overallSummary =
    adjustmentType === "cycle_count" && cycleCountDraftSummary
      ? {
          largestAbsoluteDelta: cycleCountDraftSummary.largestAbsoluteDelta,
          lineItemCount: cycleCountDraftSummary.changedLineCount,
          netQuantityDelta: cycleCountDraftSummary.netQuantityDelta,
        }
      : summary;
  const highVarianceFlag =
    overallSummary.lineItemCount > 0 &&
    hasHighStockAdjustmentVariance(overallSummary);
  const approvalRequired =
    adjustmentType === "manual" &&
    changedRows.length > 0 &&
    requiresStockAdjustmentApproval({
      adjustmentType,
      largestAbsoluteDelta: summary.largestAbsoluteDelta,
    });
  const displayedReasonCode =
    adjustmentType === "manual" ? reasonCode : CYCLE_COUNT_REASON_CODE;
  const activeInventoryItem =
    inventoryItems.find((item) => item._id === activeInventoryItemId) ??
    inventoryItems[0] ??
    null;
  const inventoryState = useMemo(() => {
    const totals = inventoryItems.reduce(
      (current, item) => {
        const unavailableUnits = Math.max(
          0,
          item.inventoryCount - item.quantityAvailable,
        );
        const reservedUnits = Math.max(0, item.reservedQuantity ?? 0);
        const checkoutReservedUnits = Math.max(
          0,
          item.checkoutReservedQuantity ?? 0,
        );
        const posReservedUnits = Math.max(0, item.posReservedQuantity ?? 0);
        const fallbackReservedUnits = Math.max(
          0,
          reservedUnits - checkoutReservedUnits - posReservedUnits,
        );

        return {
          availableUnits: current.availableUnits + item.quantityAvailable,
          checkoutReservedUnits:
            current.checkoutReservedUnits + checkoutReservedUnits,
          fallbackReservedUnits:
            current.fallbackReservedUnits + fallbackReservedUnits,
          onHandUnits: current.onHandUnits + item.inventoryCount,
          posReservedUnits: current.posReservedUnits + posReservedUnits,
          reservedUnits: current.reservedUnits + reservedUnits,
          unavailableSkuCount:
            current.unavailableSkuCount + (unavailableUnits > 0 ? 1 : 0),
          unavailableUnits: current.unavailableUnits + unavailableUnits,
        };
      },
      {
        availableUnits: 0,
        checkoutReservedUnits: 0,
        fallbackReservedUnits: 0,
        onHandUnits: 0,
        posReservedUnits: 0,
        reservedUnits: 0,
        unavailableSkuCount: 0,
        unavailableUnits: 0,
      },
    );

    const itemCount = inventoryItems.length;
    const hasUnavailableUnits = totals.unavailableUnits > 0;
    const reservationSummary = formatReservationSourceSummary(totals);

    return {
      ...totals,
      itemCount,
      description:
        itemCount === 0
          ? "Inventory appears here once SKUs are available for this store."
          : `${formatInventoryNumber(
              totals.availableUnits,
            )} of ${formatInventoryNumber(totals.onHandUnits)} ${pluralize(
              totals.onHandUnits,
              "unit",
            )} are available to sell.${
              totals.reservedUnits > 0
                ? ` ${reservationSummary}`
                : ""
            }`,
      title:
        itemCount === 0
          ? "No inventory loaded."
          : hasUnavailableUnits
            ? `${totals.unavailableSkuCount} ${pluralize(
                totals.unavailableSkuCount,
                "SKU",
              )} ${
                totals.unavailableSkuCount === 1 ? "has" : "have"
              } reserved units.`
            : "All inventory is available.",
    };
  }, [inventoryItems]);
  const totalDraftChangedLineCount =
    cycleCountDraftSummary?.changedLineCount ??
    cycleCountDraft?.changedLineCount ??
    0;
  const totalDraftScopeCount = cycleCountDraftSummary?.scopeCount ?? 0;
  const draftScopeNames = cycleCountDraftSummary?.scopeKeys ?? [];
  const scopeDraftChangedLineCount = cycleCountDraft?.changedLineCount ?? 0;
  const currentScopeLabel =
    cycleCountDraft?.scopeKey ??
    selectedCountScope?.label ??
    (selectedCountScopeKeys[0]
      ? getCountScopeLabel(selectedCountScopeKeys[0])
      : null);
  const cycleCountStatus = cycleCountSubmissionOutcome
    ? cycleCountSubmissionOutcome === "review_required"
      ? {
          description:
            "Operator count submitted. Review the queued request before inventory changes apply.",
          label: "Review required",
          tone: "border-warning/30 bg-warning/10 text-foreground" as const,
        }
      : {
          description:
            "Operator count submitted. Inventory movements have been written.",
          label: "Count applied",
          tone: "border-success/30 bg-success/10 text-foreground" as const,
        }
    : {
        description:
          totalDraftChangedLineCount > 0
            ? `Saved count: ${totalDraftChangedLineCount} ${pluralize(
                totalDraftChangedLineCount,
                "SKU",
              )} across ${totalDraftScopeCount || 1} ${pluralize(
                totalDraftScopeCount || 1,
                "scope",
              )}.`
            : "No saved counts yet.",
        label: isCycleCountDraftSaving
          ? "Saving draft"
          : cycleCountDraft?.lastSavedAt
            ? "Draft saved"
            : "Count in progress",
        tone: "border-border bg-muted/40 text-foreground" as const,
      };
  const draftLastSavedAt =
    cycleCountDraftSummary?.lastSavedAt ?? cycleCountDraft?.lastSavedAt;
  const draftLastSavedLabel = draftLastSavedAt
    ? new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(draftLastSavedAt))
    : null;
  const showDraftSavedTimestamp =
    cycleCountStatus.label === "Draft saved" && Boolean(draftLastSavedLabel);
  const canDiscardCycleCountDraft =
    !cycleCountSubmissionOutcome &&
    cycleCountDraft?.status === "open" &&
    totalDraftChangedLineCount > 0 &&
    Boolean(onDiscardCycleCountDraft);

  useEffect(() => {
    if (adjustmentType !== "cycle_count") return;
    if (selectedCountScopeKeys.length === 0) return;

    const validScopeKeys = selectedCountScopeKeys.filter((selectedKey) =>
      countScopeOptions.some((scope) => scope.key === selectedKey),
    );
    if (validScopeKeys.length === selectedCountScopeKeys.length) return;

    setSelectedCountScopeKeys(validScopeKeys);
    onSearchStateChange?.({
      page: 1,
      scope: serializeCountScopeKeys(validScopeKeys),
      sku: undefined,
    });
  }, [
    adjustmentType,
    countScopeOptions,
    onSearchStateChange,
    selectedCountScopeKeys,
  ]);

  useEffect(() => {
    if (adjustmentType !== "cycle_count" || !selectedCountScope) return;

    if (
      activeInventoryItemId &&
      scopedRows.some((row) => row.inventoryItem._id === activeInventoryItemId)
    ) {
      return;
    }

    setActiveInventoryItemId(scopedRows[0]?.inventoryItem._id ?? null);
  }, [activeInventoryItemId, adjustmentType, scopedRows, selectedCountScope]);
  useEffect(() => {
    if (
      activeInventoryItemId &&
      filteredRows.some(
        (row) => row.inventoryItem._id === activeInventoryItemId,
      )
    ) {
      return;
    }

    setActiveInventoryItemId(filteredRows[0]?.inventoryItem._id ?? null);
  }, [activeInventoryItemId, filteredRows]);
  const columns = useMemo<ColumnDef<StockAdjustmentRow>[]>(
    () => [
      {
        accessorKey: "inventoryItem.productName",
        enableHiding: false,
        enableSorting: false,
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="SKU" />
        ),
        cell: ({ row }) => {
          const item = row.original.inventoryItem;
          const primaryLabel = getInventoryItemDisplayName(item);
          const detailEntries = getSkuDetailEntries(item);

          return (
            <div className="min-w-0 space-y-1.5">
              <p className="truncate text-sm font-medium">{primaryLabel}</p>
              {detailEntries.length > 0 ? (
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {detailEntries.map((entry) => (
                    <span className="min-w-0" key={entry.label}>
                      <span className="sr-only">{entry.label}: </span>
                      {entry.value}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          );
        },
      },
      {
        accessorKey: "inventoryItem.inventoryCount",
        enableHiding: false,
        enableSorting: false,
        header: ({ column }) => (
          <DataTableColumnHeader
            className="justify-end"
            column={column}
            title={
              <span className="grid min-w-48 grid-cols-2 gap-2 text-right">
                <span>On hand</span>
                <span>Available</span>
              </span>
            }
          />
        ),
        cell: ({ row }) => {
          const item = row.original.inventoryItem;
          const reservationLabels = getReservationLabels(item);
          const availabilityMatchesOnHand =
            item.quantityAvailable === item.inventoryCount;

          if (availabilityMatchesOnHand) {
            const availabilityLabel =
              item.inventoryCount === 0 ? "None available" : "All available";

            return (
              <div className="flex min-w-48 justify-end">
                <span
                  className="inline-flex min-w-36 items-center justify-center gap-2 rounded-full border border-border bg-muted/50 px-3 py-1 text-sm font-medium tabular-nums text-muted-foreground"
                  title="All units are available"
                >
                  <span className="sr-only">On hand and available match</span>
                  {item.inventoryCount > 0 ? (
                    <span className="text-foreground">
                      {formatInventoryNumber(item.inventoryCount)}
                    </span>
                  ) : null}
                  <span className="text-[11px] font-medium uppercase tracking-[0.12em]">
                    {availabilityLabel}
                  </span>
                </span>
              </div>
            );
          }

          return (
            <div className="grid min-w-48 grid-cols-2 gap-2 text-right text-sm tabular-nums">
              <span className="font-medium text-foreground">
                {formatInventoryNumber(item.inventoryCount)}
              </span>
              <span className="space-y-0.5 text-muted-foreground">
                <span className="block">
                  {formatInventoryNumber(item.quantityAvailable)}
                </span>
                {reservationLabels.map((label) => (
                  <span
                    className="block text-[11px] font-medium uppercase tracking-[0.12em] text-warning"
                    key={label.value}
                    title={label.title}
                  >
                    {label.value}
                  </span>
                ))}
              </span>
            </div>
          );
        },
      },
      {
        accessorKey: "inputValue",
        enableHiding: false,
        enableSorting: false,
        header: ({ column }) => (
          <DataTableColumnHeader
            className="justify-end"
            column={column}
            title={adjustmentType === "manual" ? "Delta" : "Counted"}
          />
        ),
        cell: ({ row }) => {
          const item = row.original.inventoryItem;
          const displayName = getInventoryItemDisplayName(item);
          const inputLabel =
            adjustmentType === "manual"
              ? "Adjustment delta"
              : "Counted quantity";
          const resetValue =
            adjustmentType === "manual"
              ? ""
              : String(
                  cycleCountDraftLineMap.get(item._id)
                    ?.baselineInventoryCount ?? item.inventoryCount,
                );

          const setDraftValue = (value: string) =>
            adjustmentType === "manual"
              ? setManualDeltas((current) => ({
                  ...current,
                  [item._id]: value,
                }))
              : setCycleCounts((current) => ({
                  ...current,
                  [item._id]: value,
                }));
          const handleDraftChange = (value: string) => {
            setDraftValue(value);
            if (adjustmentType === "cycle_count") {
              locallyEditedCycleCountItemIdsRef.current.add(item._id);
              setCycleCountSubmissionOutcome(null);
              setStaleDraftLines([]);
            }
          };
          return (
            <div className="ml-auto flex max-w-56 items-center justify-end gap-2">
              <Input
                aria-label={`${inputLabel} for ${displayName}`}
                className="h-10 w-36 text-right"
                inputMode="numeric"
                min={adjustmentType === "manual" ? undefined : 0}
                onFocus={() => handleSelectInventoryItem(item._id)}
                onBlur={(event) =>
                  saveCycleCountDraftValue(item._id, event.currentTarget.value)
                }
                onChange={(event) => handleDraftChange(event.target.value)}
                type="number"
                value={row.original.inputValue}
              />
              <Button
                aria-label={`Restore original value for ${displayName}`}
                className="h-10 w-10 shrink-0 text-muted-foreground"
                disabled={!row.original.isEdited}
                onClick={(event) => {
                  event.stopPropagation();
                  handleSelectInventoryItem(item._id);
                  setDraftValue(resetValue);
                  if (adjustmentType === "cycle_count") {
                    setCycleCountSubmissionOutcome(null);
                    setStaleDraftLines([]);
                    void saveCycleCountDraftValue(item._id, resetValue);
                  }
                }}
                size="icon"
                type="button"
                variant="ghost"
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
            </div>
          );
        },
      },
      {
        accessorKey: "quantityDelta",
        enableHiding: false,
        enableSorting: false,
        header: ({ column }) => (
          <DataTableColumnHeader
            className="justify-end"
            column={column}
            title="Impact"
          />
        ),
        cell: ({ row }) => (
          <p
            className={`text-right text-sm font-medium ${
              row.original.quantityDelta > 0
                ? "text-success"
                : row.original.quantityDelta < 0
                  ? "text-warning"
                  : "text-muted-foreground"
            }`}
          >
            {row.original.quantityDelta > 0
              ? `+${row.original.quantityDelta}`
              : row.original.quantityDelta}
          </p>
        ),
      },
    ],
    [adjustmentType, handleSelectInventoryItem, saveCycleCountDraftValue],
  );

  const handleModeChange = (nextType: StockAdjustmentType) => {
    setAdjustmentType(nextType);
    setSubmissionKey(buildStockAdjustmentSubmissionKey(nextType));
    if (nextType === "manual") {
      setCycleCountSubmissionOutcome(null);
    }

    const currentScopeKeys =
      selectedCountScopeKeys.length > 0 ? selectedCountScopeKeys : [];
    const nextScope = serializeCountScopeKeys(currentScopeKeys);
    const nextActiveItem =
      currentScopeKeys.length > 0
        ? rows.find((row) =>
            currentScopeKeys.includes(getCountScopeKey(row.inventoryItem)),
          )?.inventoryItem
        : rows[0]?.inventoryItem;

    if (nextActiveItem) {
      setActiveInventoryItemId(nextActiveItem._id);
    }
    onSearchStateChange?.({
      mode: nextType,
      page: 1,
      scope: nextScope,
      sku: nextActiveItem?._id,
    });
  };

  const handleFilterChange = (patch: Partial<StockAdjustmentFilterState>) => {
    const nextFilters = {
      ...filters,
      ...patch,
    };

    setFilters(nextFilters);
    onSearchStateChange?.({
      availability:
        nextFilters.availability === "all"
          ? undefined
          : nextFilters.availability,
      page: 1,
      query: trimOptional(nextFilters.query),
      sku: undefined,
    });
  };

  const handleClearFilters = () => {
    setFilters({
      availability: "all",
      query: "",
    });
    onSearchStateChange?.({
      availability: undefined,
      page: 1,
      query: undefined,
      sku: undefined,
    });
  };

  const handleUnavailableMetricClick = () => {
    if (inventoryState.unavailableUnits === 0) return;

    if (isUnavailableScopeSelectionActive) {
      setSelectedCountScopeKeys([]);
      setFilters((current) => ({
        ...current,
        availability: "all",
      }));
      onSearchStateChange?.({
        availability: undefined,
        page: 1,
        scope: undefined,
        sku: undefined,
      });
      return;
    }

    if (adjustmentType === "cycle_count") {
      const nextScopeKey = unavailableCountScopeKeys[0];
      const firstScopedItem = rows.find(
        (row) => getCountScopeKey(row.inventoryItem) === nextScopeKey,
      )?.inventoryItem;

      setSelectedCountScopeKeys(nextScopeKey ? [nextScopeKey] : []);
      setFilters((current) => ({
        ...current,
        availability: "unavailable",
      }));
      onSearchStateChange?.({
        availability: "unavailable",
        page: 1,
        scope: nextScopeKey,
        sku: firstScopedItem?._id,
      });
      return;
    }

    setSelectedCountScopeKeys(unavailableCountScopeKeys);
    setFilters((current) => ({
      ...current,
      availability: "unavailable",
    }));
    onSearchStateChange?.({
      availability: "unavailable",
      page: 1,
      scope: serializeCountScopeKeys(unavailableCountScopeKeys),
      sku: undefined,
    });
  };

  const awaitPendingCycleCountSaves = async () => {
    const pendingSaves = pendingCycleCountSavePromisesRef.current;

    if (pendingSaves.length === 0) return;

    await Promise.allSettled(pendingSaves);
  };

  const flushLocallyEditedCycleCountDraftLines = async () => {
    await awaitPendingCycleCountSaves();

    const editedItemIds = Array.from(locallyEditedCycleCountItemIdsRef.current);
    if (editedItemIds.length === 0) return;

    await Promise.allSettled(
      editedItemIds.map((itemId) =>
        saveCycleCountDraftValue(itemId, cycleCounts[itemId] ?? ""),
      ),
    );
    await awaitPendingCycleCountSaves();
  };

  const handleSubmit = async () => {
    if (!storeId) {
      toast.error("Select a store before submitting a stock adjustment");
      return;
    }

    if (adjustmentType === "cycle_count") {
      await flushLocallyEditedCycleCountDraftLines();
    }

    if (
      adjustmentType === "manual"
        ? changedRows.length === 0
        : overallSummary.lineItemCount === 0 && changedRows.length === 0
    ) {
      toast.error(
        adjustmentType === "manual"
          ? "Add at least one non-zero stock delta"
          : "Enter at least one counted SKU that differs from the system stock",
      );
      return;
    }

    const result =
      adjustmentType === "cycle_count" && onSubmitCycleCountDraft
        ? await onSubmitCycleCountDraft({ notes: trimOptional(notes) })
        : await onSubmitBatch({
            adjustmentType,
            lineItems: changedRows.map((row) => row.submittedLineItem!),
            notes: trimOptional(notes),
            reasonCode:
              adjustmentType === "manual"
                ? reasonCode
                : CYCLE_COUNT_REASON_CODE,
            storeId,
            submissionKey,
          });

    if (result.kind !== "ok") {
      if (result.kind === "user_error") {
        const staleLines = result.error.metadata?.staleLines;
        if (Array.isArray(staleLines)) {
          setStaleDraftLines(
            staleLines.map((line) => ({
              baselineInventoryCount: Number(line.baselineInventoryCount ?? 0),
              currentInventoryCount: Number(line.currentInventoryCount ?? 0),
              productName:
                typeof line.productName === "string" ? line.productName : null,
              productSkuId: String(line.productSkuId) as Id<"productSku">,
              sku: typeof line.sku === "string" ? line.sku : null,
            })),
          );
        }
      }
      presentCommandToast(result);
      return;
    }

    toast.success(
      approvalRequired
        ? "Stock batch submitted for review"
        : adjustmentType === "manual"
          ? "Stock adjustment applied"
          : "Count applied",
    );
    if (adjustmentType === "cycle_count") {
      setCycleCountSubmissionOutcome(
        approvalRequired ? "review_required" : "applied",
      );
      setStaleDraftLines([]);
    }
    setNotes("");
    setManualDeltas(buildManualDrafts(inventoryItems));
    setCycleCounts(buildCycleCountDrafts(inventoryItems));
    setSubmissionKey(buildStockAdjustmentSubmissionKey(adjustmentType));
  };

  return (
    <PageWorkspace>
      <PageLevelHeader
        eyebrow="Store Ops"
        title={inventoryState.title}
        description={
          <>
            {inventoryState.description}{" "}
            {adjustmentType === "cycle_count"
              ? "Choose a scope, then record physical counts for that group."
              : "Record known deltas when physical stock needs correction."}
          </>
        }
      />

      <PageWorkspaceGrid>
        <PageWorkspaceMain>
          <div className="flex flex-wrap items-start justify-between gap-layout-xl">
            <div className="grid w-full max-w-2xl grid-cols-3 gap-layout-sm">
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  On hand
                </p>
                <p className="mt-1 text-sm font-medium tabular-nums text-foreground">
                  {formatInventoryNumber(inventoryState.onHandUnits)}
                </p>
              </div>
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Available
                </p>
                <p className="mt-1 text-sm font-medium tabular-nums text-foreground">
                  {formatInventoryNumber(inventoryState.availableUnits)}
                </p>
              </div>
              <div
                className={`overflow-hidden rounded-md border ${
                  inventoryState.unavailableUnits === 0
                    ? "border-border bg-muted/30"
                    : isUnavailableScopeSelectionActive
                      ? "border-action-workflow-border bg-action-workflow-soft"
                      : "border-border bg-muted/30 hover:bg-muted"
                }`}
              >
                <button
                  aria-pressed={isUnavailableScopeSelectionActive}
                  className="block w-full px-3 py-2 text-left disabled:cursor-default"
                  disabled={inventoryState.unavailableUnits === 0}
                  onClick={handleUnavailableMetricClick}
                  type="button"
                >
                  <span className="block text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    Reserved
                  </span>
                  <span className="mt-1 block text-sm font-medium tabular-nums text-foreground">
                    {formatInventoryNumber(inventoryState.unavailableUnits)}
                  </span>
                </button>
              </div>
            </div>

            <Tabs
              onValueChange={(value) =>
                handleModeChange(value as StockAdjustmentType)
              }
              value={adjustmentType}
            >
              <TabsList>
                <TabsTrigger value="cycle_count">Cycle count</TabsTrigger>
                <TabsTrigger value="manual">Manual adjustment</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <section
            aria-labelledby="count-scope-heading"
            className="space-y-layout-lg"
          >
            <h2 className="sr-only" id="count-scope-heading">
              Stock scopes
            </h2>
            <div className="flex justify-end">
              <Button
                className="h-8 px-2 text-xs"
                disabled={selectedCountScopeKeys.length === 0}
                onClick={() => {
                  setSelectedCountScopeKeys([]);
                  onSearchStateChange?.({
                    page: 1,
                    scope: undefined,
                    sku: rows[0]?.inventoryItem._id,
                  });
                }}
                type="button"
                variant="outline"
              >
                Show all scopes
              </Button>
            </div>
            <div className="grid gap-layout-md sm:grid-cols-2 xl:grid-cols-3">
              {countScopeOptions.map((scope) => {
                const isSelected = selectedCountScopeKeySet.has(scope.key);

                return (
                  <button
                    aria-pressed={isSelected}
                    className={`rounded-md border px-layout-md py-layout-sm text-left transition-colors ${
                      isSelected
                        ? "border-action-workflow-border bg-action-workflow-soft text-foreground"
                        : "border-border bg-background hover:bg-muted"
                    }`}
                    key={scope.key}
                    onClick={() => {
                      const nextScopeKeys =
                        adjustmentType === "cycle_count"
                          ? isSelected
                            ? []
                            : [scope.key]
                          : isSelected
                            ? selectedCountScopeKeys.filter(
                                (selectedKey) => selectedKey !== scope.key,
                              )
                            : [...selectedCountScopeKeys, scope.key];
                      const firstScopedItem =
                        nextScopeKeys.length > 0
                          ? rows.find((row) =>
                              nextScopeKeys.includes(
                                getCountScopeKey(row.inventoryItem),
                              ),
                            )?.inventoryItem
                          : rows[0]?.inventoryItem;

                      setSelectedCountScopeKeys(nextScopeKeys);
                      setCycleCountSubmissionOutcome(null);
                      setActiveInventoryItemId(firstScopedItem?._id ?? null);
                      onSearchStateChange?.({
                        page: 1,
                        scope: serializeCountScopeKeys(nextScopeKeys),
                        sku: firstScopedItem?._id,
                      });
                    }}
                    type="button"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {scope.label}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {scope.itemCount}{" "}
                          {scope.itemCount === 1 ? "SKU" : "SKUs"}
                        </p>
                      </div>
                      {isSelected ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-action-commit" />
                      ) : null}
                    </div>
                    <div className="mt-layout-sm flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">
                        {scope.changedCount}
                      </span>
                      <span>
                        {scope.changedCount === 1 ? "variance" : "variances"}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          <section
            aria-label="SKU search and filters"
            className="rounded-md border border-border bg-surface-raised px-layout-md py-layout-md"
          >
            <div className="flex flex-col gap-layout-md lg:flex-row lg:items-end lg:justify-between">
              <div className="min-w-0 flex-1">
                <Label
                  className="sr-only"
                  htmlFor="stock-adjustment-sku-search"
                >
                  Search products, SKUs, or barcodes
                </Label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="stock-adjustment-sku-search"
                    onChange={(event) =>
                      handleFilterChange({ query: event.target.value })
                    }
                    placeholder="Search product, SKU, or barcode"
                    value={filters.query}
                    className="pl-9"
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Label
                  className="sr-only"
                  htmlFor="stock-adjustment-availability-filter"
                >
                  Filter by availability
                </Label>
                <Select
                  onValueChange={(value) =>
                    handleFilterChange({
                      availability: value as StockAdjustmentAvailabilityFilter,
                    })
                  }
                  value={filters.availability}
                >
                  <SelectTrigger
                    className="w-[180px]"
                    id="stock-adjustment-availability-filter"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(
                      Object.keys(
                        STOCK_ADJUSTMENT_AVAILABILITY_FILTER_LABELS,
                      ) as StockAdjustmentAvailabilityFilter[]
                    ).map((option) => (
                      <SelectItem key={option} value={option}>
                        {STOCK_ADJUSTMENT_AVAILABILITY_FILTER_LABELS[option]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {filters.query || filters.availability !== "all" ? (
                  <Button
                    className="text-muted-foreground"
                    onClick={handleClearFilters}
                    type="button"
                    variant="outline"
                  >
                    <X className="h-4 w-4" />
                    Clear
                  </Button>
                ) : null}
              </div>
            </div>
            <p className="mt-layout-sm text-xs text-muted-foreground">
              Showing {formatInventoryNumber(filteredRows.length)} of{" "}
              {formatInventoryNumber(scopedRows.length)}{" "}
              {pluralize(scopedRows.length, "SKU")}.
            </p>
          </section>

          <div className="flex min-h-0 flex-col">
            <GenericDataTable
              autoResetPageIndex={false}
              columns={columns}
              data={filteredRows}
              getRowClassName={(row) =>
                row.original.inventoryItem._id === activeInventoryItemId
                  ? "bg-muted/60 hover:bg-muted/70"
                  : undefined
              }
              onPageIndexChange={(nextPageIndex) =>
                onSearchStateChange?.({ page: nextPageIndex + 1 })
              }
              onRowClick={(row) =>
                handleSelectInventoryItem(row.original.inventoryItem._id)
              }
              pageIndex={
                searchState?.page === undefined
                  ? undefined
                  : Math.max(searchState.page - 1, 0)
              }
              paginationRangeItemLabel="SKU"
              paginationRangeItemPluralLabel="SKUs"
              tableId={`stock-adjustments-${adjustmentType}-${selectedCountScopeKeys.join("_") || "all"}-${filters.availability}-${normalizedFilterQuery || "all"}`}
            />
          </div>
        </PageWorkspaceMain>

        <PageWorkspaceRail>
          <section className="rounded-lg border border-border bg-surface-raised px-layout-md py-layout-lg shadow-surface">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Batch summary
            </p>
            <div className="mt-layout-lg space-y-layout-lg">
              {adjustmentType === "cycle_count" ? (
                <div className="space-y-3">
                  <div
                    className={`space-y-layout-md rounded-md border px-layout-md py-layout-md ${cycleCountStatus.tone}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-medium text-muted-foreground">
                        Count status
                      </p>
                      <Badge
                        className="inline-flex items-center gap-1.5 rounded-md border-border bg-background text-foreground"
                        variant="outline"
                      >
                        <span>{cycleCountStatus.label}</span>
                        {showDraftSavedTimestamp ? (
                          <>
                            <span
                              aria-hidden="true"
                              className="h-3 w-px bg-border"
                            />
                            <span>{draftLastSavedLabel}</span>
                          </>
                        ) : null}
                      </Badge>
                    </div>
                    <p className="text-sm leading-6">
                      {cycleCountStatus.description}
                    </p>
                    <div className="space-y-1.5">
                      {cycleCountDraft && totalDraftChangedLineCount > 0 ? (
                        <p className="text-xs leading-5 text-muted-foreground">
                          Current:{" "}
                          {currentScopeLabel ? `${currentScopeLabel}, ` : ""}
                          {scopeDraftChangedLineCount}{" "}
                          {pluralize(scopeDraftChangedLineCount, "SKU")}.
                        </p>
                      ) : null}
                      {draftScopeNames.length > 0 ? (
                        <p className="text-xs leading-5 text-muted-foreground">
                          Scopes: {draftScopeNames.join(", ")}.
                        </p>
                      ) : null}
                    </div>
                    {canDiscardCycleCountDraft && onDiscardCycleCountDraft ? (
                      <Button
                        className="mt-layout-xs h-8 px-2 text-xs"
                        disabled={isCycleCountDraftSaving || isSubmitting}
                        onClick={async () => {
                          await awaitPendingCycleCountSaves();
                          const result = await onDiscardCycleCountDraft();

                          if (result.kind !== "ok") {
                            presentCommandToast(result);
                            return;
                          }

                          setCycleCounts(buildCycleCountDrafts(inventoryItems));
                          setCycleCountSubmissionOutcome(null);
                          setStaleDraftLines([]);
                          toast.success("Draft discarded");
                        }}
                        type="button"
                        variant="outline"
                      >
                        Discard draft
                      </Button>
                    ) : null}
                  </div>
                  {staleDraftLines.length > 0 ? (
                    <div className="rounded-md border border-warning/30 bg-warning/10 px-layout-md py-layout-sm">
                      <p className="text-sm font-medium text-foreground">
                        Inventory changed since this count started.
                      </p>
                      <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                        {staleDraftLines.map((line) => (
                          <li
                            className="flex items-center justify-between gap-2"
                            key={line.productSkuId}
                          >
                            <span>
                              {line.productName ??
                                line.sku ??
                                line.productSkuId}
                              : {line.baselineInventoryCount} to{" "}
                              {line.currentInventoryCount} on hand.
                            </span>
                            {onRefreshCycleCountDraftLineBaseline ? (
                              <Button
                                className="h-7 shrink-0 px-2 text-[11px]"
                                disabled={
                                  isCycleCountDraftSaving || isSubmitting
                                }
                                onClick={async () => {
                                  await awaitPendingCycleCountSaves();
                                  const result =
                                    await onRefreshCycleCountDraftLineBaseline({
                                      productSkuId: line.productSkuId,
                                    });

                                  if (result.kind !== "ok") {
                                    presentCommandToast(result);
                                    return;
                                  }

                                  setStaleDraftLines((currentLines) =>
                                    currentLines.filter(
                                      (currentLine) =>
                                        currentLine.productSkuId !==
                                        line.productSkuId,
                                    ),
                                  );
                                  setCycleCounts((currentCounts) => ({
                                    ...currentCounts,
                                    [line.productSkuId]: String(
                                      line.currentInventoryCount,
                                    ),
                                  }));
                                  toast.success("Baseline refreshed");
                                }}
                                type="button"
                                variant="outline"
                              >
                                Use latest stock
                              </Button>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {adjustmentType === "cycle_count" ? (
                <div className="space-y-3 border-t border-border pt-layout-md">
                  <p className="text-xs font-medium text-muted-foreground">
                    Count metrics
                  </p>
                  <div className="grid gap-2">
                    <div className="rounded-md border border-border bg-muted/30 px-3 py-3">
                      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                        All saved counts
                      </p>
                      <div className="mt-2 grid grid-cols-3 gap-2">
                        <div>
                          <p className="font-display text-3xl font-semibold tabular-nums tracking-tight text-foreground">
                            {overallSummary.lineItemCount}
                          </p>
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            SKUs
                          </p>
                        </div>
                        <div>
                          <p className="font-display text-3xl font-semibold tabular-nums tracking-tight text-foreground">
                            {overallSummary.netQuantityDelta > 0
                              ? `+${overallSummary.netQuantityDelta}`
                              : overallSummary.netQuantityDelta}
                          </p>
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            Net
                          </p>
                        </div>
                        <div>
                          <p className="font-display text-3xl font-semibold tabular-nums tracking-tight text-foreground">
                            {overallSummary.largestAbsoluteDelta}
                          </p>
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            Variance
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="rounded-md border border-border px-3 py-3">
                      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                        Selected scope
                      </p>
                      <div className="mt-2 grid grid-cols-3 gap-2">
                        <div>
                          <p className="font-display text-2xl font-semibold tabular-nums tracking-tight text-foreground">
                            {summary.lineItemCount}
                          </p>
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            SKUs
                          </p>
                        </div>
                        <div>
                          <p className="font-display text-2xl font-semibold tabular-nums tracking-tight text-foreground">
                            {summary.netQuantityDelta > 0
                              ? `+${summary.netQuantityDelta}`
                              : summary.netQuantityDelta}
                          </p>
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            Net
                          </p>
                        </div>
                        <div>
                          <p className="font-display text-2xl font-semibold tabular-nums tracking-tight text-foreground">
                            {summary.largestAbsoluteDelta}
                          </p>
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            Variance
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs font-medium text-muted-foreground">
                    Adjustment metrics
                  </p>
                  <div className="rounded-md border border-border bg-muted/30 px-3 py-3">
                    <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                      Manual batch
                    </p>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      <div>
                        <p className="font-display text-3xl font-semibold tabular-nums tracking-tight text-foreground">
                          {summary.lineItemCount}
                        </p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          SKUs
                        </p>
                      </div>
                      <div>
                        <p className="font-display text-3xl font-semibold tabular-nums tracking-tight text-foreground">
                          {summary.netQuantityDelta > 0
                            ? `+${summary.netQuantityDelta}`
                            : summary.netQuantityDelta}
                        </p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Net
                        </p>
                      </div>
                      <div>
                        <p className="font-display text-3xl font-semibold tabular-nums tracking-tight text-foreground">
                          {summary.largestAbsoluteDelta}
                        </p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Variance
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              <div
                className={`rounded-md border px-layout-md py-layout-sm text-sm leading-6 ${
                  approvalRequired
                    ? "border-warning/30 bg-warning/10 text-foreground"
                    : adjustmentType === "cycle_count" && highVarianceFlag
                      ? "border-warning/30 bg-warning/10 text-foreground"
                      : "border-success/30 bg-success/10 text-foreground"
                }`}
              >
                {approvalRequired
                  ? "This batch will open an approval request before inventory changes are applied"
                  : adjustmentType === "cycle_count" && highVarianceFlag
                    ? "Submitting this count will apply inventory movements immediately and flag the high variance"
                    : adjustmentType === "cycle_count"
                      ? "Submitting this count will apply inventory movements immediately"
                      : "This batch can apply immediately and will still write inventory movements"}
              </div>
            </div>
          </section>

          <section className="space-y-layout-xl rounded-lg border border-border bg-surface-raised px-layout-md py-layout-md shadow-surface">
            <SkuDetailPanel activeInventoryItem={activeInventoryItem} />

            <div className="space-y-2">
              <Label htmlFor="reason-code">Reason code</Label>
              <Select
                disabled={adjustmentType === "cycle_count"}
                onValueChange={(value) =>
                  setReasonCode(
                    value as (typeof MANUAL_STOCK_ADJUSTMENT_REASON_CODES)[number],
                  )
                }
                value={displayedReasonCode}
              >
                <SelectTrigger id="reason-code">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {adjustmentType === "cycle_count" ? (
                    <SelectItem value={CYCLE_COUNT_REASON_CODE}>
                      Cycle count reconciliation
                    </SelectItem>
                  ) : (
                    MANUAL_STOCK_ADJUSTMENT_REASON_CODES.map((option) => (
                      <SelectItem key={option} value={option}>
                        {MANUAL_REASON_LABELS[option]}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="stock-adjustment-notes">Notes</Label>
              <Textarea
                id="stock-adjustment-notes"
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Add notes, count context, or exception details."
                value={notes}
              />
            </div>

            <div className="space-y-layout-sm text-sm text-muted-foreground">
              <p>
                Variances of {STOCK_ADJUSTMENT_APPROVAL_THRESHOLD}+ units{" "}
                {adjustmentType === "cycle_count"
                  ? "are flagged after submission."
                  : "go to review."}
              </p>
            </div>

            <LoadingButton
              variant={"workflow"}
              className="w-full"
              disabled={
                adjustmentType === "cycle_count" &&
                (isCycleCountDraftSaving || pendingCycleCountSaveCount > 0)
              }
              isLoading={
                isSubmitting ||
                (adjustmentType === "cycle_count" &&
                  (isCycleCountDraftSaving || pendingCycleCountSaveCount > 0))
              }
              onClick={handleSubmit}
              onMouseDown={(event) => {
                if (adjustmentType === "cycle_count") {
                  event.preventDefault();
                }
              }}
            >
              {adjustmentType === "manual"
                ? "Submit adjustment"
                : "Submit count"}
            </LoadingButton>
          </section>
        </PageWorkspaceRail>
      </PageWorkspaceGrid>
    </PageWorkspace>
  );
}
