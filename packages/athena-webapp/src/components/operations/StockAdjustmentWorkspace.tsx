import { useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Link } from "@tanstack/react-router";
import { CheckCircle2, ExternalLink, Package, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import {
  CYCLE_COUNT_REASON_CODE,
  MANUAL_STOCK_ADJUSTMENT_REASON_CODES,
  STOCK_ADJUSTMENT_APPROVAL_THRESHOLD,
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
  colorName?: string | null;
  imageUrl?: string | null;
  inventoryCount: number;
  length?: number | null;
  productCategory?: string | null;
  productId?: Id<"product"> | null;
  productName: string;
  quantityAvailable: number;
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

type StockAdjustmentWorkspaceContentProps = {
  inventoryItems: InventorySnapshotItem[];
  isSubmitting: boolean;
  onSubmitBatch: (
    args: SubmitStockAdjustmentArgs,
  ) => Promise<NormalizedCommandResult<unknown>>;
  storeId?: Id<"store">;
};

type StockAdjustmentType = "manual" | "cycle_count";
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

function getCountScopeKey(item: InventorySnapshotItem) {
  return item.productCategory?.trim() || UNCATEGORIZED_SCOPE_KEY;
}

function getCountScopeLabel(key: string) {
  return key === UNCATEGORIZED_SCOPE_KEY ? "Uncategorized" : key;
}

function buildManualDrafts(inventoryItems: InventorySnapshotItem[]) {
  return Object.fromEntries(inventoryItems.map((item) => [item._id, ""]));
}

function buildCycleCountDrafts(inventoryItems: InventorySnapshotItem[]) {
  return Object.fromEntries(
    inventoryItems.map((item) => [item._id, String(item.inventoryCount)]),
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

function getInventoryItemDisplayName(item: InventorySnapshotItem) {
  return getProductName(item) || item.sku || String(item._id);
}

export function StockAdjustmentWorkspaceContent({
  inventoryItems,
  isSubmitting,
  onSubmitBatch,
  storeId,
}: StockAdjustmentWorkspaceContentProps) {
  const [adjustmentType, setAdjustmentType] =
    useState<StockAdjustmentType>("cycle_count");
  const [submissionKey, setSubmissionKey] = useState(() =>
    buildStockAdjustmentSubmissionKey("cycle_count"),
  );
  const [reasonCode, setReasonCode] = useState<
    (typeof MANUAL_STOCK_ADJUSTMENT_REASON_CODES)[number]
  >(MANUAL_STOCK_ADJUSTMENT_REASON_CODES[0]);
  const [notes, setNotes] = useState("");
  const [manualDeltas, setManualDeltas] = useState<Record<string, string>>(() =>
    buildManualDrafts(inventoryItems),
  );
  const [cycleCounts, setCycleCounts] = useState<Record<string, string>>(() =>
    buildCycleCountDrafts(inventoryItems),
  );
  const [activeInventoryItemId, setActiveInventoryItemId] =
    useState<Id<"productSku"> | null>(inventoryItems[0]?._id ?? null);
  const [selectedCountScopeKey, setSelectedCountScopeKey] = useState<
    string | null
  >(null);
  const [cycleCountSubmissionOutcome, setCycleCountSubmissionOutcome] =
    useState<CycleCountSubmissionOutcome>(null);

  useEffect(() => {
    setManualDeltas(buildManualDrafts(inventoryItems));
    setCycleCounts(buildCycleCountDrafts(inventoryItems));
  }, [inventoryItems]);

  useEffect(() => {
    if (
      activeInventoryItemId &&
      inventoryItems.some((item) => item._id === activeInventoryItemId)
    ) {
      return;
    }

    setActiveInventoryItemId(inventoryItems[0]?._id ?? null);
  }, [activeInventoryItemId, inventoryItems]);

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

        const rawCount = cycleCounts[item._id] ?? String(item.inventoryCount);
        const parsedCount =
          rawCount.trim() === "" ? Number.NaN : Number(rawCount);
        const quantityDelta = Number.isInteger(parsedCount)
          ? parsedCount - item.inventoryCount
          : 0;
        const isEdited =
          Number.isInteger(parsedCount) &&
          parsedCount >= 0 &&
          parsedCount !== item.inventoryCount;

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
    [adjustmentType, cycleCounts, inventoryItems, manualDeltas],
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
  const selectedCountScope =
    countScopeOptions.find((scope) => scope.key === selectedCountScopeKey) ??
    countScopeOptions[0] ??
    null;
  const scopedRows = useMemo(
    () =>
      adjustmentType === "cycle_count" && selectedCountScope
        ? rows.filter(
            (row) =>
              getCountScopeKey(row.inventoryItem) === selectedCountScope.key,
          )
        : rows,
    [adjustmentType, rows, selectedCountScope],
  );
  const summary = summarizeStockAdjustmentLineItems(
    changedRows.map((row) => ({
      quantityDelta: row.quantityDelta,
    })),
  );
  const approvalRequired =
    changedRows.length > 0 && requiresStockAdjustmentApproval(summary);
  const displayedReasonCode =
    adjustmentType === "manual" ? reasonCode : CYCLE_COUNT_REASON_CODE;
  const activeInventoryItem =
    inventoryItems.find((item) => item._id === activeInventoryItemId) ??
    inventoryItems[0] ??
    null;
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
          "Submit the selected category count when the physical counts are recorded.",
        label: "Count in progress",
        tone: "border-border bg-muted/40 text-foreground" as const,
      };

  useEffect(() => {
    if (adjustmentType !== "cycle_count") return;

    if (
      selectedCountScopeKey &&
      countScopeOptions.some((scope) => scope.key === selectedCountScopeKey)
    ) {
      return;
    }

    setSelectedCountScopeKey(countScopeOptions[0]?.key ?? null);
  }, [adjustmentType, countScopeOptions, selectedCountScopeKey]);

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
          const primaryLabel = getInventoryItemDisplayName(
            row.original.inventoryItem,
          );
          const secondaryLabel =
            row.original.inventoryItem.sku ?? row.original.inventoryItem._id;
          const showSecondaryLabel = secondaryLabel !== primaryLabel;

          return (
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{primaryLabel}</p>
              {showSecondaryLabel ? (
                <p className="truncate text-xs text-muted-foreground">
                  {secondaryLabel}
                </p>
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
            title="On hand"
          />
        ),
        cell: ({ row }) => (
          <p className="text-right text-sm font-medium">
            {row.original.inventoryItem.inventoryCount}
          </p>
        ),
      },
      {
        accessorKey: "inventoryItem.quantityAvailable",
        enableHiding: false,
        enableSorting: false,
        header: ({ column }) => (
          <DataTableColumnHeader
            className="justify-end"
            column={column}
            title="Available"
          />
        ),
        cell: ({ row }) => (
          <p className="text-right text-sm text-muted-foreground">
            {row.original.inventoryItem.quantityAvailable}
          </p>
        ),
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
            adjustmentType === "manual" ? "" : String(item.inventoryCount);

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
              setCycleCountSubmissionOutcome(null);
            }
          };

          return (
            <div className="ml-auto flex max-w-56 items-center justify-end gap-2">
              <Input
                aria-label={`${inputLabel} for ${displayName}`}
                className="h-10 w-36 text-right"
                inputMode="numeric"
                min={adjustmentType === "manual" ? undefined : 0}
                onFocus={() => setActiveInventoryItemId(item._id)}
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
                  setActiveInventoryItemId(item._id);
                  setDraftValue(resetValue);
                  if (adjustmentType === "cycle_count") {
                    setCycleCountSubmissionOutcome(null);
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
    [adjustmentType],
  );

  const handleModeChange = (nextType: StockAdjustmentType) => {
    setAdjustmentType(nextType);
    setSubmissionKey(buildStockAdjustmentSubmissionKey(nextType));
    if (nextType === "manual") {
      setCycleCountSubmissionOutcome(null);
    }
  };

  const handleSubmit = async () => {
    if (!storeId) {
      toast.error("Select a store before submitting a stock adjustment");
      return;
    }

    if (changedRows.length === 0) {
      toast.error(
        adjustmentType === "manual"
          ? "Add at least one non-zero stock delta"
          : "Enter at least one counted quantity that differs from the system stock",
      );
      return;
    }

    const result = await onSubmitBatch({
      adjustmentType,
      lineItems: changedRows.map((row) => row.submittedLineItem!),
      notes: trimOptional(notes),
      reasonCode:
        adjustmentType === "manual" ? reasonCode : CYCLE_COUNT_REASON_CODE,
      storeId,
      submissionKey,
    });

    if (result.kind !== "ok") {
      presentCommandToast(result);
      return;
    }

    toast.success(
      approvalRequired
        ? adjustmentType === "cycle_count"
          ? "Count submitted for review"
          : "Stock batch submitted for review"
        : adjustmentType === "manual"
          ? "Stock adjustment applied"
          : "Count applied",
    );
    if (adjustmentType === "cycle_count") {
      setCycleCountSubmissionOutcome(
        approvalRequired ? "review_required" : "applied",
      );
    }
    setNotes("");
    setManualDeltas(buildManualDrafts(inventoryItems));
    setCycleCounts(buildCycleCountDrafts(inventoryItems));
    setSubmissionKey(buildStockAdjustmentSubmissionKey(adjustmentType));
  };

  return (
    <div className="grid gap-layout-xl xl:grid-cols-[minmax(0,1fr)_320px]">
      <section className="min-w-0 space-y-layout-2xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl space-y-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Stock Ops
            </p>
            <div className="space-y-1">
              <h2 className="font-display text-2xl font-semibold tracking-tight text-foreground">
                {adjustmentType === "cycle_count"
                  ? "Choose a count scope."
                  : "Record stock adjustments."}
              </h2>
              <p className="text-sm text-muted-foreground">
                {adjustmentType === "cycle_count"
                  ? "Start with a category, then record physical counts for the SKUs in that group."
                  : "Enter known stock deltas. Athena applies the variance as an inventory movement, or routes larger changes for review."}
              </p>
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

        {adjustmentType === "cycle_count" ? (
          <section
            aria-labelledby="count-scope-heading"
            className="space-y-layout-md"
          >
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {countScopeOptions.map((scope) => {
                const isSelected = scope.key === selectedCountScope?.key;

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
                      setSelectedCountScopeKey(scope.key);
                      setCycleCountSubmissionOutcome(null);
                      const firstScopedItem = rows.find(
                        (row) =>
                          getCountScopeKey(row.inventoryItem) === scope.key,
                      )?.inventoryItem;

                      setActiveInventoryItemId(firstScopedItem?._id ?? null);
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
        ) : null}

        <div className="flex min-h-0 flex-col">
          <GenericDataTable
            columns={columns}
            data={scopedRows}
            getRowClassName={(row) =>
              row.original.inventoryItem._id === activeInventoryItemId
                ? "bg-muted/60 hover:bg-muted/70"
                : undefined
            }
            onRowClick={(row) =>
              setActiveInventoryItemId(row.original.inventoryItem._id)
            }
            paginationRangeItemLabel="SKU"
            paginationRangeItemPluralLabel="SKUs"
            tableId={`stock-adjustments-${adjustmentType}-${selectedCountScope?.key ?? "all"}`}
          />
        </div>
      </section>

      <aside className="space-y-layout-md">
        <section className="rounded-lg border border-border bg-surface-raised px-layout-md py-layout-lg shadow-surface">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Batch summary
          </p>
          <div className="mt-layout-lg space-y-layout-lg">
            {adjustmentType === "cycle_count" ? (
              <div
                className={`space-y-2 rounded-md border px-layout-md py-layout-sm ${cycleCountStatus.tone}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-medium text-muted-foreground">
                    Count status
                  </p>
                  <Badge
                    className="rounded-md border-border bg-background text-foreground"
                    variant="outline"
                  >
                    {cycleCountStatus.label}
                  </Badge>
                </div>
                <p className="text-sm leading-6">
                  {cycleCountStatus.description}
                </p>
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-layout-md">
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">
                  Changed rows
                </p>
                <p className="font-display text-4xl font-semibold tabular-nums tracking-tight text-foreground">
                  {summary.lineItemCount}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">
                  Net delta
                </p>
                <p className="font-display text-4xl font-semibold tabular-nums tracking-tight text-foreground">
                  {summary.netQuantityDelta > 0
                    ? `+${summary.netQuantityDelta}`
                    : summary.netQuantityDelta}
                </p>
              </div>
            </div>
            <div className="space-y-1 border-t border-border pt-layout-md">
              <p className="text-xs font-medium text-muted-foreground">
                Largest variance
              </p>
              <p className="font-display text-3xl font-semibold tabular-nums tracking-tight text-foreground">
                {summary.largestAbsoluteDelta} units
              </p>
            </div>
            <div
              className={`rounded-md border px-layout-md py-layout-sm text-sm leading-6 ${
                approvalRequired
                  ? "border-warning/30 bg-warning/10 text-foreground"
                  : "border-success/30 bg-success/10 text-foreground"
              }`}
            >
              {approvalRequired
                ? adjustmentType === "cycle_count"
                  ? "Submitting this count will open a review before inventory changes apply"
                  : "This batch will open an approval request before inventory changes are applied"
                : adjustmentType === "cycle_count"
                  ? "Submitting this count will apply inventory movements immediately"
                  : "This batch can apply immediately and will still write inventory movements"}
            </div>
          </div>
        </section>

        <section className="space-y-layout-md rounded-lg border border-border bg-surface-raised px-layout-md py-layout-md shadow-surface">
          <div className="space-y-layout-sm">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              SKU detail
            </p>
            <div className="overflow-hidden rounded-md border border-none bg-muted/30">
              {activeInventoryItem?.imageUrl ? (
                <img
                  alt={getInventoryItemDisplayName(activeInventoryItem)}
                  className="aspect-square w-full object-cover"
                  src={activeInventoryItem.imageUrl}
                />
              ) : (
                <div className="flex aspect-square w-full items-center justify-center bg-muted">
                  <Package className="h-8 w-8 text-muted-foreground" />
                </div>
              )}
            </div>
            <div className="space-y-1">
              <div className="flex items-start justify-between gap-3">
                <p className="line-clamp-2 text-sm font-medium text-foreground">
                  {activeInventoryItem
                    ? getInventoryItemDisplayName(activeInventoryItem)
                    : "No SKU selected"}
                </p>
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
              {activeInventoryItem?.sku ? (
                <p className="text-xs text-muted-foreground">
                  {activeInventoryItem.sku}
                </p>
              ) : null}
            </div>
          </div>

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
              placeholder="Add operator notes, count context, or exception details."
              value={notes}
            />
          </div>

          <div className="space-y-layout-sm text-sm text-muted-foreground">
            <p>
              Variances of {STOCK_ADJUSTMENT_APPROVAL_THRESHOLD}+ units go to
              review.
            </p>
          </div>

          <LoadingButton
            className="w-full"
            isLoading={isSubmitting}
            onClick={handleSubmit}
          >
            {adjustmentType === "manual" ? "Submit adjustment" : "Submit count"}
          </LoadingButton>
        </section>
      </aside>
    </div>
  );
}
