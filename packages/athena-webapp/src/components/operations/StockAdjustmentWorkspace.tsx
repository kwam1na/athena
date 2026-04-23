import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  CYCLE_COUNT_REASON_CODE,
  MANUAL_STOCK_ADJUSTMENT_REASON_CODES,
  STOCK_ADJUSTMENT_APPROVAL_THRESHOLD,
  requiresStockAdjustmentApproval,
  summarizeStockAdjustmentLineItems,
} from "~/shared/stockAdjustment";
import type { Id } from "~/convex/_generated/dataModel";
import type { NormalizedCommandResult } from "../../lib/errors/runCommand";
import { presentCommandToast } from "../../lib/errors/presentCommandToast";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { LoadingButton } from "../ui/loading-button";
import { Textarea } from "../ui/textarea";

export type InventorySnapshotItem = {
  _id: Id<"productSku">;
  inventoryCount: number;
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
    args: SubmitStockAdjustmentArgs
  ) => Promise<NormalizedCommandResult<unknown>>;
  storeId?: Id<"store">;
};

type StockAdjustmentType = "manual" | "cycle_count";

const MANUAL_REASON_LABELS: Record<
  (typeof MANUAL_STOCK_ADJUSTMENT_REASON_CODES)[number],
  string
> = {
  correction: "Correction",
  damage: "Damage",
  shrinkage: "Shrinkage",
  vendor_return: "Vendor return",
};

function buildManualDrafts(inventoryItems: InventorySnapshotItem[]) {
  return Object.fromEntries(inventoryItems.map((item) => [item._id, ""]));
}

function buildCycleCountDrafts(inventoryItems: InventorySnapshotItem[]) {
  return Object.fromEntries(
    inventoryItems.map((item) => [item._id, String(item.inventoryCount)])
  );
}

function buildStockAdjustmentSubmissionKey(adjustmentType: StockAdjustmentType) {
  return `stock-adjustment-${adjustmentType}-${Date.now().toString(36)}`;
}

function trimOptional(value?: string | null) {
  const nextValue = value?.trim();
  return nextValue ? nextValue : undefined;
}

export function StockAdjustmentWorkspaceContent({
  inventoryItems,
  isSubmitting,
  onSubmitBatch,
  storeId,
}: StockAdjustmentWorkspaceContentProps) {
  const [adjustmentType, setAdjustmentType] = useState<StockAdjustmentType>("manual");
  const [submissionKey, setSubmissionKey] = useState(() =>
    buildStockAdjustmentSubmissionKey("manual")
  );
  const [reasonCode, setReasonCode] = useState<
    (typeof MANUAL_STOCK_ADJUSTMENT_REASON_CODES)[number]
  >(MANUAL_STOCK_ADJUSTMENT_REASON_CODES[0]);
  const [notes, setNotes] = useState("");
  const [manualDeltas, setManualDeltas] = useState<Record<string, string>>(() =>
    buildManualDrafts(inventoryItems)
  );
  const [cycleCounts, setCycleCounts] = useState<Record<string, string>>(() =>
    buildCycleCountDrafts(inventoryItems)
  );

  useEffect(() => {
    setManualDeltas(buildManualDrafts(inventoryItems));
    setCycleCounts(buildCycleCountDrafts(inventoryItems));
  }, [inventoryItems]);

  const rows = inventoryItems.map((item) => {
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
    const parsedCount = rawCount.trim() === "" ? Number.NaN : Number(rawCount);
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
  });

  const changedRows = rows.filter((row) => row.submittedLineItem);
  const summary = summarizeStockAdjustmentLineItems(
    changedRows.map((row) => ({
      quantityDelta: row.quantityDelta,
    }))
  );
  const approvalRequired =
    changedRows.length > 0 && requiresStockAdjustmentApproval(summary);

  const handleModeChange = (nextType: StockAdjustmentType) => {
    setAdjustmentType(nextType);
    setSubmissionKey(buildStockAdjustmentSubmissionKey(nextType));
  };

  const handleSubmit = async () => {
    if (!storeId) {
      toast.error("Select a store before submitting a stock adjustment.");
      return;
    }

    if (changedRows.length === 0) {
      toast.error(
        adjustmentType === "manual"
          ? "Add at least one non-zero stock delta."
          : "Enter at least one counted quantity that differs from the system stock."
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
        ? "Stock batch submitted for review"
        : adjustmentType === "manual"
          ? "Stock adjustment applied"
          : "Cycle count reconciled"
    );
    setNotes("");
    setManualDeltas(buildManualDrafts(inventoryItems));
    setCycleCounts(buildCycleCountDrafts(inventoryItems));
    setSubmissionKey(buildStockAdjustmentSubmissionKey(adjustmentType));
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <section className="overflow-hidden rounded-2xl border border-border/80 bg-background">
        <div className="border-b border-border/80 bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.18),_transparent_38%),linear-gradient(180deg,rgba(250,250,249,0.95),rgba(255,255,255,0.9))] px-5 py-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-2xl space-y-2">
              <p className="text-xs uppercase tracking-[0.24em] text-amber-700/80">
                Stock Ops
              </p>
              <div className="space-y-1">
                <h2 className="text-2xl font-semibold tracking-tight">
                  Adjust stock without losing the audit trail.
                </h2>
                <p className="text-sm text-muted-foreground">
                  Use manual deltas for corrections and shrinkage. Switch to cycle
                  count when you need to reconcile the floor count back through
                  inventory movements.
                </p>
              </div>
            </div>

            <div className="inline-flex rounded-full border border-amber-200/80 bg-white/90 p-1 shadow-sm">
              <button
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                  adjustmentType === "manual"
                    ? "bg-amber-500 text-amber-950"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => handleModeChange("manual")}
                type="button"
              >
                Manual adjustment
              </button>
              <button
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                  adjustmentType === "cycle_count"
                    ? "bg-amber-500 text-amber-950"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => handleModeChange("cycle_count")}
                type="button"
              >
                Cycle count
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-5 px-5 py-5">
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px_220px]">
            <div className="space-y-2">
              <Label htmlFor="submission-key">Submission key</Label>
              <Input
                id="submission-key"
                onChange={(event) => setSubmissionKey(event.target.value)}
                value={submissionKey}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="review-threshold">Review threshold</Label>
              <Input
                disabled
                id="review-threshold"
                value={`${STOCK_ADJUSTMENT_APPROVAL_THRESHOLD} units`}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="reason-code">Reason code</Label>
              {adjustmentType === "manual" ? (
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  id="reason-code"
                  onChange={(event) =>
                    setReasonCode(
                      event.target.value as (typeof MANUAL_STOCK_ADJUSTMENT_REASON_CODES)[number]
                    )
                  }
                  value={reasonCode}
                >
                  {MANUAL_STOCK_ADJUSTMENT_REASON_CODES.map((option) => (
                    <option key={option} value={option}>
                      {MANUAL_REASON_LABELS[option]}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  disabled
                  id="reason-code"
                  value="Cycle count reconciliation"
                />
              )}
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-border/80">
            <div className="grid grid-cols-[minmax(0,1.5fr)_repeat(4,minmax(0,0.7fr))] gap-3 border-b border-border/80 px-4 py-3 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              <p>SKU</p>
              <p className="text-right">On hand</p>
              <p className="text-right">Available</p>
              <p className="text-right">
                {adjustmentType === "manual" ? "Delta" : "Counted"}
              </p>
              <p className="text-right">Impact</p>
            </div>

            {inventoryItems.length === 0 ? (
              <div className="px-4 py-8 text-sm text-muted-foreground">
                Inventory items will appear here once the store has SKUs to count.
              </div>
            ) : (
              rows.map((row) => (
                <div
                  className={`grid grid-cols-[minmax(0,1.5fr)_repeat(4,minmax(0,0.7fr))] gap-3 border-b border-border/60 px-4 py-4 transition-colors last:border-b-0 ${
                    row.isEdited ? "bg-amber-50/70" : "bg-background"
                  }`}
                  key={row.inventoryItem._id}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {row.inventoryItem.productName}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {row.inventoryItem.sku ?? row.inventoryItem._id}
                    </p>
                  </div>
                  <p className="text-right text-sm font-medium">
                    {row.inventoryItem.inventoryCount}
                  </p>
                  <p className="text-right text-sm text-muted-foreground">
                    {row.inventoryItem.quantityAvailable}
                  </p>
                  <Input
                    aria-label={`${
                      adjustmentType === "manual"
                        ? "Adjustment delta"
                        : "Counted quantity"
                    } for ${row.inventoryItem.productName}`}
                    className="h-10 text-right"
                    inputMode="numeric"
                    min={adjustmentType === "manual" ? undefined : 0}
                    onChange={(event) =>
                      adjustmentType === "manual"
                        ? setManualDeltas((current) => ({
                            ...current,
                            [row.inventoryItem._id]: event.target.value,
                          }))
                        : setCycleCounts((current) => ({
                            ...current,
                            [row.inventoryItem._id]: event.target.value,
                          }))
                    }
                    type="number"
                    value={row.inputValue}
                  />
                  <p
                    className={`text-right text-sm font-medium ${
                      row.quantityDelta > 0
                        ? "text-emerald-700"
                        : row.quantityDelta < 0
                          ? "text-amber-700"
                          : "text-muted-foreground"
                    }`}
                  >
                    {row.quantityDelta > 0 ? `+${row.quantityDelta}` : row.quantityDelta}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <aside className="space-y-4">
        <section className="rounded-2xl border border-border/80 bg-background px-4 py-4">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Batch summary
          </p>
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-muted-foreground">Changed rows</p>
                <p className="text-2xl font-semibold">{summary.lineItemCount}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Net delta</p>
                <p className="text-2xl font-semibold">
                  {summary.netQuantityDelta > 0
                    ? `+${summary.netQuantityDelta}`
                    : summary.netQuantityDelta}
                </p>
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Largest variance</p>
              <p className="text-lg font-medium">{summary.largestAbsoluteDelta} units</p>
            </div>
            <div
              className={`rounded-xl border px-3 py-3 text-sm ${
                approvalRequired
                  ? "border-amber-200 bg-amber-50 text-amber-900"
                  : "border-emerald-200 bg-emerald-50 text-emerald-900"
              }`}
            >
              {approvalRequired
                ? "This batch will open an approval request before inventory changes are applied."
                : "This batch can apply immediately and will still write inventory movements."}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-border/80 bg-background px-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="stock-adjustment-notes">Notes</Label>
            <Textarea
              id="stock-adjustment-notes"
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Add operator notes, count context, or exception details."
              value={notes}
            />
          </div>

          <div className="mt-4 space-y-3 text-sm text-muted-foreground">
            <p>
              Manual adjustments require a reason code. Cycle counts always reconcile
              with the cycle-count reason code.
            </p>
            <p>
              Variances at or above {STOCK_ADJUSTMENT_APPROVAL_THRESHOLD} units move
              into the operations queue for review.
            </p>
          </div>

          <LoadingButton
            className="mt-6 w-full"
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
