import { useEffect, useMemo, useState } from "react";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import {
  ArrowRight,
  CheckCircle2,
  CircleDollarSign,
  FileSpreadsheet,
  History,
  LoaderCircle,
  RotateCcw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { toast } from "sonner";

import { api } from "~/convex/_generated/api";
import type { Doc, Id } from "~/convex/_generated/dataModel";
import type { InventoryImportSourceColumn } from "~/shared/inventoryImportSource";
import { useProtectedAdminPageState } from "@/hooks/useProtectedAdminPageState";
import { useAppActionBlocker } from "@/lib/app-messages";
import { APP_UPDATE_APPLY_ACTION_ID } from "@/lib/app-update";
import { formatStoredCurrencyAmount } from "@/lib/pos/displayAmounts";
import {
  PageLevelHeader,
  PageWorkspace,
  PageWorkspaceGrid,
  PageWorkspaceMain,
  PageWorkspaceRail,
} from "../common/PageLevelHeader";
import { EmptyState } from "../states/empty/empty-state";
import { NoPermissionView } from "../states/no-permission/NoPermissionView";
import { ProtectedAdminSignInView } from "../states/signed-out/ProtectedAdminSignInView";
import View from "../View";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Label } from "../ui/label";
import { Input } from "../ui/input";
import { LoadingButton } from "../ui/loading-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { OperationsSummaryMetric } from "./OperationsSummaryMetric";

type CostOverlayStatus = Doc<"inventoryImportCostOverlayRun">["status"];

type CostOverlayDecision = Doc<"inventoryImportCostOverlayRow">["decision"];
type UserCostOverlayDecision = Exclude<CostOverlayDecision, "ineligible">;

export type InventoryCostOverlayRun = Pick<
  Doc<"inventoryImportCostOverlayRun">,
  | "_id"
  | "bulkDecisionStatus"
  | "decisionRevision"
  | "eligibleRowCount"
  | "appliedRowCount"
  | "applyExceptionCount"
  | "currencyCode"
  | "constructionFailureReason"
  | "manifestDigest"
  | "impactAfterMinor"
  | "impactBeforeMinor"
  | "largestImpacts"
  | "reviewVersionNumber"
  | "selectedColumn"
  | "selectedRowCount"
  | "status"
  | "totalRowCount"
  | "undoneRowCount"
  | "undoExceptionCount"
> & {
  retryableWork?:
    | "bulk decision"
    | "construction"
    | "preparation"
    | "apply"
    | "undo"
    | null;
};

export type InventoryCostOverlayRow = Pick<
  Doc<"inventoryImportCostOverlayRow">,
  | "_id"
  | "barcode"
  | "costOutcome"
  | "currentUnitCostMinor"
  | "decision"
  | "eligibility"
  | "eligibilityReason"
  | "lifecycle"
  | "normalizedCostMinor"
  | "productName"
  | "productSkuId"
  | "rowOrdinal"
  | "sku"
  | "sourceRawValue"
  | "sourceRowKey"
  | "workStatus"
>;

type SavedReviewVersion = {
  columns: Array<
    InventoryImportSourceColumn & {
      sampleValidity: { valid: number; invalid: number };
    }
  >;
  descriptorStatus: "available" | "unavailable";
  fileName?: string;
  reviewVersionId: Id<"inventoryImportReviewVersion">;
  rowCount: number;
  sourceFormat: "csv" | "json";
  sourceProjectionVersion: number;
  versionNumber: number;
};

type OverlayRowFilter = "all" | "eligible" | "selected" | "exceptions";

const STATUS_COPY: Record<
  CostOverlayStatus,
  { label: string; description: string }
> = {
  draft: {
    label: "Building",
    description: "Athena is matching the saved source to anchored SKUs.",
  },
  ready: {
    label: "Review",
    description: "Review eligible rows and choose any known-cost overwrites.",
  },
  preparing: {
    label: "Preparing",
    description: "Athena is sealing the selected rows and valuation impact.",
  },
  prepared: {
    label: "Prepared",
    description: "The selected rows and valuation impact are ready to apply.",
  },
  applying: {
    label: "Applying",
    description: "Cost changes are being recorded in bounded batches.",
  },
  applied: {
    label: "Applied",
    description: "All selected costs were applied.",
  },
  applied_with_exceptions: {
    label: "Applied with exceptions",
    description: "Safe rows were applied. Review the rows Athena skipped.",
  },
  undoing: {
    label: "Undoing",
    description:
      "Athena is restoring rows that still match their applied state.",
  },
  undone: {
    label: "Undone",
    description: "All still-safe rows were restored.",
  },
  undone_with_exceptions: {
    label: "Undone with exceptions",
    description: "Safe rows were restored. Changed rows were left in place.",
  },
  abandoned: {
    label: "Abandoned",
    description: "This cost overlay was closed without applying changes.",
  },
};

const COST_OUTCOME_COPY: Record<
  InventoryCostOverlayRow["costOutcome"],
  string
> = {
  valid: "Valid source cost",
  missing: "Source cost missing",
  invalid_syntax: "Source cost not recognized",
  negative: "Negative source cost",
  excess_precision: "Too many decimal places",
  out_of_range: "Source cost outside supported range",
};

const INVENTORY_COST_OVERLAY_PAGE_SIZE = 50;
const INVENTORY_COST_OVERLAY_MAX_RESTORED_PAGE = 10;

function getCostOverlayRunDescription(run: InventoryCostOverlayRun) {
  if (
    run.status === "abandoned" &&
    run.constructionFailureReason === "construction_prefix_changed"
  ) {
    return "The saved source changed during recovery. Start a new overlay from the current review.";
  }
  if (
    run.status === "abandoned" &&
    run.constructionFailureReason === "construction_scope_too_large"
  ) {
    return "This saved review is too large for one cost overlay. Narrow the import and start a new overlay.";
  }
  return STATUS_COPY[run.status].description;
}

function formatCost(currencyCode: string, amount?: number) {
  return amount === undefined
    ? "Missing"
    : formatStoredCurrencyAmount(currencyCode, amount, {
        revealMinorUnits: true,
      });
}

function formatSignedCost(currencyCode: string, amount: number) {
  if (amount === 0) return formatCost(currencyCode, 0);
  return `${amount > 0 ? "+" : "−"}${formatCost(currencyCode, Math.abs(amount))}`;
}

function getColumnLabel(column: InventoryCostOverlayRun["selectedColumn"]) {
  return column.kind === "csv" ? column.label : column.path;
}

function normalizeCostOverlayFailure(
  action:
    | "abandon"
    | "apply"
    | "create"
    | "prepare"
    | "reopen"
    | "retry"
    | "save"
    | "undo",
) {
  if (action === "create") {
    return "Cost overlay could not be created. Check the saved source and try again.";
  }
  if (action === "save") {
    return "Decision could not be saved. Refresh the workspace and try again.";
  }
  if (action === "prepare") {
    return "Cost overlay could not be prepared. Review the current selections and try again.";
  }
  if (action === "apply") {
    return "Cost overlay could not be started. Refresh the prepared impact and try again.";
  }
  if (action === "undo") {
    return "Compensating undo could not be started. Refresh the run and try again.";
  }
  if (action === "abandon") {
    return "Cost overlay could not be abandoned. Refresh the run and try again.";
  }
  if (action === "reopen") {
    return "Cost overlay decisions could not be reopened. Refresh the run and try again.";
  }
  return "Cost overlay work could not be resumed. Refresh the run and try again.";
}

function createRequestIdentity() {
  const requestKey =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return {
    requestKey: `inventory-cost-overlay:${requestKey}`,
  };
}

function SourceConfirmation({
  acknowledged,
  columnId,
  columns,
  reviewVersion,
  onAcknowledgedChange,
  onColumnChange,
  onCreate,
  submitting,
}: {
  acknowledged: boolean;
  columnId: string;
  columns: SavedReviewVersion["columns"];
  reviewVersion: SavedReviewVersion;
  onAcknowledgedChange: (checked: boolean) => void;
  onColumnChange: (columnId: string) => void;
  onCreate: () => void;
  submitting: boolean;
}) {
  const selectedColumn = columns.find((column) => column.id === columnId);
  return (
    <section className="space-y-4 rounded-md border border-border bg-background p-4">
      <div>
        <h2 className="text-lg font-semibold">Choose the source cost</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Version {reviewVersion.versionNumber} is the fixed source for this
          overlay. Choose the legacy column that contains unit cost.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(240px,0.7fr)]">
        <div className="space-y-2">
          <Label htmlFor="inventory-cost-overlay-column">Cost column</Label>
          <Select value={columnId} onValueChange={onColumnChange}>
            <SelectTrigger id="inventory-cost-overlay-column">
              <SelectValue placeholder="Choose a source column" />
            </SelectTrigger>
            <SelectContent>
              {columns.map((column) => (
                <SelectItem key={column.id} value={column.id}>
                  {column.label}
                  {column.ordinal > 1 ? ` (${column.ordinal})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs leading-5 text-muted-foreground">
            Values are read as store-currency unit costs. Athena preserves zero
            and flags missing or invalid values for review.
          </p>
        </div>

        <div className="rounded-md border border-border bg-surface/60 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Saved source
          </p>
          <p className="mt-2 truncate text-sm font-medium">
            {reviewVersion.fileName || "Saved inventory review"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {reviewVersion.rowCount} row
            {reviewVersion.rowCount === 1 ? "" : "s"} ·{" "}
            {reviewVersion.sourceFormat.toUpperCase()}
          </p>
        </div>
      </div>

      {selectedColumn ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-md border border-border bg-surface/60 p-3 sm:col-span-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Representative source values
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {selectedColumn.sampleValues.length > 0 ? (
                selectedColumn.sampleValues.map((sample, index) => (
                  <Badge key={`${String(sample)}-${index}`} variant="secondary">
                    {sample === null || sample === ""
                      ? "blank"
                      : String(sample)}
                  </Badge>
                ))
              ) : (
                <span className="text-sm text-muted-foreground">
                  No non-blank samples were saved.
                </span>
              )}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Source values: {selectedColumn.sampleValidity.valid} valid ·{" "}
              {selectedColumn.sampleValidity.invalid} needs review
            </p>
          </div>
          <div className="rounded-md border border-border bg-surface/60 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Eligible scope
            </p>
            <p className="mt-2 text-lg font-semibold">
              {reviewVersion.rowCount}
            </p>
            <p className="text-xs text-muted-foreground">
              anchored source rows will be evaluated
            </p>
          </div>
        </div>
      ) : null}

      <div className="flex items-start gap-3 rounded-md border border-border bg-surface/60 p-3">
        <Checkbox
          checked={acknowledged}
          id="inventory-cost-overlay-acknowledgement"
          onCheckedChange={(checked) => onAcknowledgedChange(checked === true)}
        />
        <Label
          className="font-normal leading-5"
          htmlFor="inventory-cost-overlay-acknowledgement"
        >
          I confirm this column represents unit cost in the store currency.
        </Label>
      </div>

      <div className="flex justify-end">
        <LoadingButton
          disabled={!columnId || !acknowledged || submitting}
          isLoading={submitting}
          onClick={onCreate}
        >
          Build cost overlay
          <ArrowRight className="ml-2 h-4 w-4" />
        </LoadingButton>
      </div>
    </section>
  );
}

function CostOverlayRows({
  canEdit,
  currencyCode,
  onDecisionChange,
  rows,
  savingRowId,
}: {
  canEdit: boolean;
  currencyCode: string;
  onDecisionChange: (
    row: InventoryCostOverlayRow,
    decision: UserCostOverlayDecision,
  ) => void;
  rows: InventoryCostOverlayRow[];
  savingRowId?: string;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<FileSpreadsheet className="h-10 w-10" />}
        title="No overlay rows yet"
        description="Athena is still matching the saved source to anchored SKUs."
      />
    );
  }

  return (
    <>
      <div
        className="space-y-3 md:hidden"
        data-testid="cost-overlay-mobile-cards"
      >
        {rows.map((row) => (
          <article
            className="space-y-3 rounded-md border border-border bg-background p-3"
            key={row._id}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {row.productName ||
                    row.sku ||
                    row.barcode ||
                    `Source row ${row.rowOrdinal + 1}`}
                </p>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {row.sku ||
                    row.barcode ||
                    row.productSkuId ||
                    row.sourceRowKey}
                </p>
              </div>
              <Badge className="shrink-0" variant="secondary">
                {row.lifecycle === "provisional" ? "Provisional" : "Trusted"}
              </Badge>
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Legacy cost</dt>
                <dd className="mt-1 font-medium">
                  {formatCost(currencyCode, row.normalizedCostMinor)}
                </dd>
                {row.sourceRawValue !== undefined ? (
                  <dd className="mt-1 text-xs text-muted-foreground">
                    Source: {row.sourceRawValue || "blank"}
                  </dd>
                ) : null}
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Athena cost</dt>
                <dd className="mt-1">
                  {formatCost(currencyCode, row.currentUnitCostMinor)}
                </dd>
              </div>
            </dl>
            <div className="text-sm">
              <p>{COST_OUTCOME_COPY[row.costOutcome]}</p>
              {row.eligibilityReason ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {row.eligibilityReason}
                </p>
              ) : null}
            </div>
            {savingRowId === row._id ? (
              <span
                aria-live="polite"
                className="inline-flex items-center gap-2 text-sm text-muted-foreground"
              >
                <LoaderCircle className="h-4 w-4 animate-spin" />
                Saving
              </span>
            ) : (
              <Select
                disabled={!canEdit || row.eligibility === "ineligible"}
                onValueChange={(decision) =>
                  onDecisionChange(row, decision as UserCostOverlayDecision)
                }
                value={row.decision}
              >
                <SelectTrigger
                  aria-label={`Mobile decision for ${row.productName || row.sku || row.sourceRowKey}`}
                  size="sm"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {row.currentUnitCostMinor === undefined ? (
                    <SelectItem value="selected_missing_cost">
                      Apply missing cost
                    </SelectItem>
                  ) : (
                    <SelectItem value="overwrite_selected">
                      Overwrite Athena cost
                    </SelectItem>
                  )}
                  <SelectItem value="not_selected">Do not apply</SelectItem>
                  {row.eligibility === "ineligible" ? (
                    <SelectItem value="ineligible">Ineligible</SelectItem>
                  ) : null}
                </SelectContent>
              </Select>
            )}
          </article>
        ))}
      </div>
      <div
        className="hidden overflow-hidden rounded-md border border-border md:block"
        data-testid="cost-overlay-desktop-table"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[840px] text-left text-sm">
            <thead className="border-b bg-surface text-xs uppercase text-muted-foreground">
              <tr>
                <th className="py-2 pl-3 pr-3">SKU</th>
                <th className="py-2 pr-3">Lifecycle</th>
                <th className="py-2 pr-3 text-right">Legacy cost</th>
                <th className="py-2 pr-3 text-right">Athena cost</th>
                <th className="py-2 pr-3">Evidence</th>
                <th className="py-2 pr-3">Decision</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row) => (
                <tr key={row._id}>
                  <td className="py-3 pl-3 pr-3">
                    <p className="font-medium">
                      {row.productName ||
                        row.sku ||
                        row.barcode ||
                        `Source row ${row.rowOrdinal + 1}`}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {row.sku ||
                        row.barcode ||
                        row.productSkuId ||
                        row.sourceRowKey}
                    </p>
                  </td>
                  <td className="py-3 pr-3">
                    <Badge variant="secondary">
                      {row.lifecycle === "provisional"
                        ? "Provisional"
                        : "Trusted"}
                    </Badge>
                  </td>
                  <td className="py-3 pr-3 text-right font-medium">
                    {formatCost(currencyCode, row.normalizedCostMinor)}
                    {row.sourceRawValue !== undefined ? (
                      <p className="mt-1 text-xs font-normal text-muted-foreground">
                        Source: {row.sourceRawValue || "blank"}
                      </p>
                    ) : null}
                  </td>
                  <td className="py-3 pr-3 text-right">
                    {formatCost(currencyCode, row.currentUnitCostMinor)}
                  </td>
                  <td className="max-w-[220px] py-3 pr-3">
                    <p>{COST_OUTCOME_COPY[row.costOutcome]}</p>
                    {row.eligibilityReason ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {row.eligibilityReason}
                      </p>
                    ) : null}
                  </td>
                  <td className="w-[220px] py-3 pr-3">
                    {savingRowId === row._id ? (
                      <span
                        aria-live="polite"
                        className="inline-flex items-center gap-2 text-sm text-muted-foreground"
                      >
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                        Saving
                      </span>
                    ) : (
                      <Select
                        disabled={!canEdit || row.eligibility === "ineligible"}
                        onValueChange={(decision) =>
                          onDecisionChange(
                            row,
                            decision as UserCostOverlayDecision,
                          )
                        }
                        value={row.decision}
                      >
                        <SelectTrigger
                          aria-label={`Decision for ${row.productName || row.sku || row.sourceRowKey}`}
                          size="sm"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {row.currentUnitCostMinor === undefined ? (
                            <SelectItem value="selected_missing_cost">
                              Apply missing cost
                            </SelectItem>
                          ) : (
                            <SelectItem value="overwrite_selected">
                              Overwrite Athena cost
                            </SelectItem>
                          )}
                          <SelectItem value="not_selected">
                            Do not apply
                          </SelectItem>
                          {row.eligibility === "ineligible" ? (
                            <SelectItem value="ineligible">
                              Ineligible
                            </SelectItem>
                          ) : null}
                        </SelectContent>
                      </Select>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

const RESUMABLE_COST_OVERLAY_STATUSES = new Set<CostOverlayStatus>([
  "draft",
  "ready",
  "preparing",
  "prepared",
  "applying",
  "undoing",
]);

export function InventoryCostOverlayRecentRuns({
  onOpenRun,
  runs,
}: {
  onOpenRun: (runId: Id<"inventoryImportCostOverlayRun">) => void;
  runs: InventoryCostOverlayRun[];
}) {
  if (runs.length === 0) return null;
  return (
    <section className="space-y-3 rounded-md border border-border bg-background p-4">
      <div>
        <h2 className="text-lg font-semibold">Recent cost overlays</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Resume active work or inspect a completed run.
        </p>
      </div>
      <div className="divide-y rounded-md border border-border">
        {runs.map((run) => {
          const resumable = RESUMABLE_COST_OVERLAY_STATUSES.has(run.status);
          return (
            <div
              className="flex flex-wrap items-center justify-between gap-3 p-3"
              key={run._id}
            >
              <div>
                <p className="font-medium">
                  Review version {run.reviewVersionNumber} ·{" "}
                  {getColumnLabel(run.selectedColumn)}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {STATUS_COPY[run.status].label} · {run.selectedRowCount}{" "}
                  selected
                </p>
                {run.constructionFailureReason ===
                "construction_prefix_changed" ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    Saved source changed during recovery.
                  </p>
                ) : null}
              </div>
              <Button
                onClick={() => onOpenRun(run._id)}
                type="button"
                variant="outline"
              >
                {resumable ? "Resume run" : "Inspect run"}
              </Button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function InventoryCostOverlayRunLifecycleControls({
  bulkDecisionStatus,
  isAbandoning,
  isReopening,
  onAbandon,
  onReopen,
  status,
}: {
  bulkDecisionStatus: InventoryCostOverlayRun["bulkDecisionStatus"];
  isAbandoning: boolean;
  isReopening: boolean;
  onAbandon: () => void;
  onReopen: () => void;
  status: CostOverlayStatus;
}) {
  const canAbandon =
    status === "draft" || status === "ready" || status === "prepared";
  const isBulkDecisionProcessing = bulkDecisionStatus === "processing";
  if (!canAbandon) return null;
  return (
    <>
      {status === "prepared" ? (
        <div className="mt-layout-md space-y-2 border-t border-border pt-layout-md">
          <LoadingButton
            className="w-full"
            isLoading={isReopening}
            onClick={onReopen}
            variant="outline"
          >
            Reopen decisions
          </LoadingButton>
        </div>
      ) : null}
      <div className="mt-layout-md border-t border-border pt-layout-md">
        <p className="text-sm font-medium">Close this run</p>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          {isBulkDecisionProcessing
            ? "Matching rows are still updating. Wait for the update to finish before abandoning this run."
            : "Abandon this unconfirmed overlay without applying changes."}
        </p>
        <LoadingButton
          className="mt-layout-sm w-full"
          disabled={isBulkDecisionProcessing}
          isLoading={isAbandoning}
          onClick={onAbandon}
          variant="outline"
        >
          <XCircle className="mr-2 h-4 w-4" />
          Abandon run
        </LoadingButton>
      </div>
    </>
  );
}

export function InventoryCostOverlayWorkspaceContent({
  filter = "all",
  isBulkUpdating = false,
  isLoadingRows,
  isPreparing,
  onBulkDecision,
  onDecisionChange,
  onFilterChange,
  onLoadMore,
  onPrepare,
  onQueryChange,
  query = "",
  rows,
  run,
  savingRowId,
  canLoadMore = false,
}: {
  canLoadMore?: boolean;
  filter?: OverlayRowFilter;
  isBulkUpdating?: boolean;
  isLoadingRows: boolean;
  isPreparing: boolean;
  onBulkDecision?: (decision: "selected_missing_cost" | "not_selected") => void;
  onDecisionChange: (
    row: InventoryCostOverlayRow,
    decision: UserCostOverlayDecision,
  ) => void;
  onLoadMore: () => void;
  onFilterChange?: (filter: OverlayRowFilter) => void;
  onPrepare: () => void;
  onQueryChange?: (query: string) => void;
  query?: string;
  rows: InventoryCostOverlayRow[];
  run: InventoryCostOverlayRun;
  savingRowId?: string;
}) {
  const status = STATUS_COPY[run.status];
  const impactDelta =
    run.impactBeforeMinor !== undefined && run.impactAfterMinor !== undefined
      ? run.impactAfterMinor - run.impactBeforeMinor
      : undefined;
  const exceptionCount =
    run.status === "undoing" ||
    run.status === "undone" ||
    run.status === "undone_with_exceptions"
      ? (run.undoExceptionCount ?? 0)
      : (run.applyExceptionCount ?? 0);

  return (
    <>
      <section
        aria-live="polite"
        className="space-y-4 rounded-md border border-border bg-background p-4"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">Cost overlay review</h2>
              <Badge
                variant={
                  run.status.includes("exceptions")
                    ? "destructive"
                    : "secondary"
                }
              >
                {status.label}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {getCostOverlayRunDescription(run)}
            </p>
          </div>
          <p className="text-sm text-muted-foreground">
            Review version {run.reviewVersionNumber} ·{" "}
            {getColumnLabel(run.selectedColumn)}
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <OperationsSummaryMetric
            label="Source rows"
            tone="quiet"
            value={run.totalRowCount}
          />
          <OperationsSummaryMetric
            label="Eligible"
            tone="quiet"
            value={run.eligibleRowCount}
          />
          <OperationsSummaryMetric
            label="Selected"
            tone="quiet"
            value={run.selectedRowCount}
          />
          <OperationsSummaryMetric
            label="Exceptions"
            tone="quiet"
            value={exceptionCount}
          />
        </div>

        {run.status === "prepared" &&
        run.impactBeforeMinor !== undefined &&
        run.impactAfterMinor !== undefined ? (
          <div className="grid gap-2 border-t border-border pt-4 sm:grid-cols-3">
            <OperationsSummaryMetric
              label="On-hand value before"
              tone="quiet"
              value={formatCost(run.currencyCode, run.impactBeforeMinor)}
            />
            <OperationsSummaryMetric
              label="On-hand value after"
              tone="quiet"
              value={formatCost(run.currencyCode, run.impactAfterMinor)}
            />
            <OperationsSummaryMetric
              label="Valuation change"
              tone="quiet"
              value={formatSignedCost(run.currencyCode, impactDelta ?? 0)}
            />
          </div>
        ) : null}
      </section>

      <section className="space-y-4 rounded-md border border-border bg-background p-4">
        <div>
          <h2 className="text-lg font-semibold">Anchored SKUs</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Missing costs are selected by default. A known Athena cost requires
            an explicit overwrite decision.
          </p>
        </div>
        <div className="grid gap-3 border-y border-border py-4 md:grid-cols-[minmax(220px,1fr)_180px_auto]">
          <div>
            <Label className="sr-only" htmlFor="cost-overlay-search">
              Search overlay rows
            </Label>
            <Input
              id="cost-overlay-search"
              onChange={(event) => onQueryChange?.(event.target.value)}
              placeholder="Search SKU, barcode, or product"
              value={query}
            />
          </div>
          <Select
            onValueChange={(value) =>
              onFilterChange?.(value as OverlayRowFilter)
            }
            value={filter}
          >
            <SelectTrigger aria-label="Filter overlay rows">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All rows</SelectItem>
              <SelectItem value="eligible">Eligible</SelectItem>
              <SelectItem value="selected">Selected</SelectItem>
              <SelectItem value="exceptions">Exceptions</SelectItem>
            </SelectContent>
          </Select>
          {run.status === "ready" ? (
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={
                  isBulkUpdating || run.bulkDecisionStatus === "processing"
                }
                onClick={() => onBulkDecision?.("selected_missing_cost")}
                type="button"
                variant="outline"
              >
                Select matching missing costs
              </Button>
              <Button
                disabled={
                  isBulkUpdating || run.bulkDecisionStatus === "processing"
                }
                onClick={() => onBulkDecision?.("not_selected")}
                type="button"
                variant="outline"
              >
                Clear matching
              </Button>
            </div>
          ) : null}
        </div>
        <CostOverlayRows
          canEdit={
            run.status === "ready" && run.bulkDecisionStatus !== "processing"
          }
          currencyCode={run.currencyCode}
          onDecisionChange={onDecisionChange}
          rows={rows}
          savingRowId={savingRowId}
        />
        {canLoadMore ? (
          <div className="flex justify-center">
            <Button
              disabled={isLoadingRows}
              onClick={onLoadMore}
              type="button"
              variant="outline"
            >
              {isLoadingRows ? "Loading rows" : "Load more rows"}
            </Button>
          </div>
        ) : null}
      </section>

      {run.status === "ready" ? (
        <section className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-border bg-surface/60 p-4">
          <div>
            <h2 className="text-sm font-semibold">Prepare selected rows</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Athena will seal the current decisions and calculate the on-hand
              valuation impact before anything is applied.
            </p>
          </div>
          <LoadingButton
            disabled={
              run.selectedRowCount === 0 ||
              run.bulkDecisionStatus === "processing" ||
              isPreparing
            }
            isLoading={isPreparing}
            onClick={onPrepare}
          >
            Prepare impact
          </LoadingButton>
        </section>
      ) : null}
    </>
  );
}

export function InventoryCostOverlayView() {
  const adminState = useProtectedAdminPageState({ surface: "full_admin" });
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as {
    run?: unknown;
    q?: unknown;
    filter?: unknown;
    page?: unknown;
  };
  const runIdFromUrl =
    typeof search.run === "string" && search.run.trim()
      ? search.run.trim()
      : undefined;
  const query = typeof search.q === "string" ? search.q : "";
  const filter: OverlayRowFilter =
    search.filter === "eligible" ||
    search.filter === "selected" ||
    search.filter === "exceptions"
      ? search.filter
      : "all";
  const page =
    typeof search.page === "number" && Number.isInteger(search.page)
      ? Math.min(
          INVENTORY_COST_OVERLAY_MAX_RESTORED_PAGE,
          Math.max(1, search.page),
        )
      : 1;
  const normalizedSearch = query.trim();
  const storeId = adminState.activeStore?._id as Id<"store"> | undefined;
  const canQuery =
    adminState.canQueryProtectedData &&
    adminState.hasFullAdminAccess &&
    Boolean(storeId);
  const latestReviewVersion = useQuery(
    api.inventory.inventoryImportCostOverlay
      .getLatestCostOverlaySourceDescriptor,
    canQuery ? { storeId: storeId! } : "skip",
  );
  const recentRuns = useQuery(
    api.inventory.inventoryImportCostOverlay.listRecentCostOverlayRuns,
    canQuery && !runIdFromUrl ? { storeId: storeId! } : "skip",
  );
  const run = useQuery(
    api.inventory.inventoryImportCostOverlay.resolveCostOverlayRunFromUrl,
    canQuery && runIdFromUrl
      ? { runId: runIdFromUrl, storeId: storeId! }
      : "skip",
  );
  const runId = run?._id;
  const undoPreview = useQuery(
    api.inventory.inventoryImportCostOverlay.getCostOverlayUndoPreview,
    canQuery &&
      runId &&
      (run?.status === "applied" || run?.status === "applied_with_exceptions")
      ? { runId, storeId: storeId! }
      : "skip",
  );
  const rowPage = usePaginatedQuery(
    api.inventory.inventoryImportCostOverlay.listCostOverlayRows,
    canQuery && runId
      ? {
          filter,
          runId,
          search: normalizedSearch || undefined,
          storeId: storeId!,
        }
      : "skip",
    { initialNumItems: INVENTORY_COST_OVERLAY_PAGE_SIZE },
  );
  const restoredRowTarget = page * INVENTORY_COST_OVERLAY_PAGE_SIZE;
  const loadMoreRows = rowPage.loadMore;
  const loadedRowCount = rowPage.results.length;
  const rowPageStatus = rowPage.status;
  const createRun = useMutation(
    api.inventory.inventoryImportCostOverlay.createCostOverlayRun,
  );
  const updateDecision = useMutation(
    api.inventory.inventoryImportCostOverlay.updateCostOverlayDecision,
  );
  const updateDecisionsBulk = useMutation(
    api.inventory.inventoryImportCostOverlay.updateCostOverlayDecisionsBulk,
  );
  const prepareRun = useMutation(
    api.inventory.inventoryImportCostOverlay.prepareCostOverlayRun,
  );
  const confirmApply = useMutation(
    api.inventory.inventoryImportCostOverlay.confirmCostOverlayApply,
  );
  const requestUndo = useMutation(
    api.inventory.inventoryImportCostOverlay.requestCostOverlayUndo,
  );
  const refreshUndoPreview = useMutation(
    api.inventory.inventoryImportCostOverlay.refreshCostOverlayUndoPreview,
  );
  const retryWork = useMutation(
    api.inventory.inventoryImportCostOverlay.retryCostOverlayWork,
  );
  const reopenRun = useMutation(
    api.inventory.inventoryImportCostOverlay.reopenCostOverlayRun,
  );
  const abandonRun = useMutation(
    api.inventory.inventoryImportCostOverlay.abandonCostOverlayRun,
  );
  const [selectedColumnId, setSelectedColumnId] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [isBulkUpdating, setIsBulkUpdating] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [isUndoing, setIsUndoing] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [isReopening, setIsReopening] = useState(false);
  const [isAbandoning, setIsAbandoning] = useState(false);
  const [impactAcknowledged, setImpactAcknowledged] = useState(false);
  const [undoAcknowledged, setUndoAcknowledged] = useState(false);
  const [undoPreviewRefreshState, setUndoPreviewRefreshState] = useState<
    "idle" | "waiting" | "ready"
  >("idle");
  const [observedUndoPreviewProcessing, setObservedUndoPreviewProcessing] =
    useState(false);
  const [savingRowId, setSavingRowId] = useState<string>();
  const [pendingDecisionCount, setPendingDecisionCount] = useState(0);
  const [draftDecisions, setDraftDecisions] = useState<
    Record<string, CostOverlayDecision>
  >({});

  useAppActionBlocker({
    actionId: APP_UPDATE_APPLY_ACTION_ID,
    active:
      pendingDecisionCount > 0 ||
      isBulkUpdating ||
      isPreparing ||
      isApplying ||
      isUndoing ||
      isReopening ||
      isAbandoning,
    blockerId: "operations.inventory-cost-overlay",
    guidance: "Wait for the current cost overlay change to finish saving.",
    label: "Inventory cost overlay",
    priority: "active-command",
  });

  const createRunIdentity = useMemo(() => {
    const column = latestReviewVersion?.columns.find(
      (candidate) => candidate.id === selectedColumnId,
    );
    return column && latestReviewVersion ? createRequestIdentity() : undefined;
  }, [latestReviewVersion, selectedColumnId]);
  const undoRequestIdentity = useMemo(
    () => (run ? createRequestIdentity() : undefined),
    [run],
  );
  const undoPreviewRequestIdentity = useMemo(
    () =>
      runId &&
      (run?.status === "applied" || run?.status === "applied_with_exceptions")
        ? createRequestIdentity()
        : undefined,
    [run?.status, runId],
  );

  useEffect(() => {
    if (!storeId || !runId || !undoPreviewRequestIdentity) {
      setUndoPreviewRefreshState("idle");
      setObservedUndoPreviewProcessing(false);
      return;
    }
    setUndoAcknowledged(false);
    setUndoPreviewRefreshState("waiting");
    setObservedUndoPreviewProcessing(false);
    void refreshUndoPreview({
      ...undoPreviewRequestIdentity,
      runId,
      storeId,
    })
      .then((result) => {
        if (result.status === "ready") {
          setUndoPreviewRefreshState("ready");
        }
      })
      .catch(() => {
        setUndoPreviewRefreshState("idle");
        toast.error(
          "Undo scope could not be refreshed. Refresh the run and try again.",
        );
      });
  }, [refreshUndoPreview, runId, storeId, undoPreviewRequestIdentity]);

  useEffect(() => {
    if (
      undoPreviewRefreshState === "waiting" &&
      undoPreview?.status === "processing"
    ) {
      setObservedUndoPreviewProcessing(true);
      return;
    }
    if (
      undoPreviewRefreshState === "waiting" &&
      observedUndoPreviewProcessing &&
      undoPreview?.status === "ready"
    ) {
      setUndoPreviewRefreshState("ready");
    }
  }, [
    observedUndoPreviewProcessing,
    undoPreview?.status,
    undoPreviewRefreshState,
  ]);

  useEffect(() => {
    if (
      !runId ||
      rowPageStatus !== "CanLoadMore" ||
      loadedRowCount >= restoredRowTarget
    ) {
      return;
    }
    loadMoreRows(
      Math.min(
        INVENTORY_COST_OVERLAY_PAGE_SIZE,
        restoredRowTarget - loadedRowCount,
      ),
    );
  }, [loadedRowCount, loadMoreRows, restoredRowTarget, rowPageStatus, runId]);

  const handleCreate = async () => {
    const column = latestReviewVersion?.columns.find(
      (candidate) => candidate.id === selectedColumnId,
    );
    if (!column || !latestReviewVersion || !createRunIdentity || !storeId)
      return;
    setIsCreating(true);
    try {
      const result = await createRun({
        ...createRunIdentity,
        reviewVersionId: latestReviewVersion.reviewVersionId,
        selectedColumn:
          latestReviewVersion.sourceFormat === "csv"
            ? {
                kind: "csv" as const,
                label: column.label,
                ordinal: column.ordinal,
              }
            : { kind: "json" as const, path: column.sourcePath },
        storeId,
      });
      void navigate({
        replace: true,
        search: ((current: Record<string, unknown>) => ({
          ...current,
          run: result.runId,
        })) as never,
      });
      toast.success("Cost overlay created.");
    } catch {
      toast.error(normalizeCostOverlayFailure("create"));
    } finally {
      setIsCreating(false);
    }
  };

  const handleDecisionChange = async (
    row: InventoryCostOverlayRow,
    decision: UserCostOverlayDecision,
  ) => {
    if (!runId || !storeId) return;
    setDraftDecisions((current) => ({ ...current, [row._id]: decision }));
    setPendingDecisionCount((count) => count + 1);
    setSavingRowId(row._id);
    try {
      await updateDecision({
        decision,
        rowId: row._id,
        runId,
        storeId,
      });
    } catch {
      toast.error(normalizeCostOverlayFailure("save"));
    } finally {
      setDraftDecisions((current) => {
        const next = { ...current };
        delete next[row._id];
        return next;
      });
      setPendingDecisionCount((count) => Math.max(0, count - 1));
      setSavingRowId(undefined);
    }
  };

  const handleBulkDecision = async (
    decision: "selected_missing_cost" | "not_selected",
  ) => {
    if (!runId || !storeId) return;
    setIsBulkUpdating(true);
    try {
      await updateDecisionsBulk({
        decision,
        filter,
        ...createRequestIdentity(),
        runId,
        search: normalizedSearch || undefined,
        storeId,
      });
      toast.success("Matching decisions are being updated.");
    } catch {
      toast.error(normalizeCostOverlayFailure("save"));
    } finally {
      setIsBulkUpdating(false);
    }
  };

  const handlePrepare = async () => {
    if (!run || !storeId) return;
    setIsPreparing(true);
    try {
      await prepareRun({
        expectedDecisionRevision: run.decisionRevision,
        runId: run._id,
        storeId,
      });
      toast.success("Cost overlay preparation started.");
    } catch {
      toast.error(normalizeCostOverlayFailure("prepare"));
    } finally {
      setIsPreparing(false);
    }
  };

  const handleApply = async () => {
    if (!run?.manifestDigest || !storeId) return;
    setIsApplying(true);
    try {
      await confirmApply({
        expectedManifestDigest: run.manifestDigest,
        runId: run._id,
        storeId,
      });
      toast.success("Cost overlay apply started.");
    } catch {
      toast.error(normalizeCostOverlayFailure("apply"));
    } finally {
      setIsApplying(false);
    }
  };

  const handleUndo = async () => {
    if (!run || !storeId) return;
    if (!undoRequestIdentity) return;
    setIsUndoing(true);
    try {
      await requestUndo({
        ...undoRequestIdentity,
        runId: run._id,
        storeId,
      });
      toast.success("Compensating undo started.");
    } catch {
      toast.error(normalizeCostOverlayFailure("undo"));
    } finally {
      setIsUndoing(false);
    }
  };

  const handleRetry = async () => {
    if (!run || !storeId) return;
    setIsRetrying(true);
    try {
      await retryWork({ runId: run._id, storeId });
      toast.success("Cost overlay work resumed.");
    } catch {
      toast.error(normalizeCostOverlayFailure("retry"));
    } finally {
      setIsRetrying(false);
    }
  };

  const handleReopen = async () => {
    if (!run || !storeId) return;
    setIsReopening(true);
    try {
      await reopenRun({ runId: run._id, storeId });
      toast.success("Cost overlay decisions reopened.");
    } catch {
      toast.error(normalizeCostOverlayFailure("reopen"));
    } finally {
      setIsReopening(false);
    }
  };

  const handleAbandon = async () => {
    if (!run || !storeId) return;
    setIsAbandoning(true);
    try {
      await abandonRun({ runId: run._id, storeId });
      void navigate({
        replace: true,
        search: ((current: Record<string, unknown>) => ({
          ...current,
          run: undefined,
        })) as never,
      });
      toast.success("Cost overlay abandoned.");
    } catch {
      toast.error(normalizeCostOverlayFailure("abandon"));
    } finally {
      setIsAbandoning(false);
    }
  };

  if (adminState.isLoadingAccess) {
    return (
      <View hideBorder hideHeaderBottomBorder>
        <PageWorkspace className="container mx-auto py-layout-2xl">
          <PageLevelHeader
            eyebrow="Operations"
            title="Inventory cost overlay"
            description="Loading protected store access."
            showBackButton
          />
        </PageWorkspace>
      </View>
    );
  }
  if (!adminState.isAuthenticated) {
    return (
      <ProtectedAdminSignInView description="Sign in again before reviewing inventory costs." />
    );
  }
  if (!adminState.hasFullAdminAccess) return <NoPermissionView />;
  if (!storeId) {
    return (
      <View hideBorder hideHeaderBottomBorder>
        <PageWorkspace className="container mx-auto py-layout-2xl">
          <EmptyState
            title="No active store"
            description="Select a store before opening a cost overlay."
          />
        </PageWorkspace>
      </View>
    );
  }

  const visibleRowStart = (page - 1) * INVENTORY_COST_OVERLAY_PAGE_SIZE;
  const rows = rowPage.results
    .slice(
      visibleRowStart,
      visibleRowStart + INVENTORY_COST_OVERLAY_PAGE_SIZE,
    )
    .map((row) => ({
      ...row,
      decision: draftDecisions[row._id] ?? row.decision,
    }));
  const updateRouteReviewState = (patch: {
    q?: string;
    filter?: OverlayRowFilter;
  }) =>
    void navigate({
      replace: true,
      search: ((current: Record<string, unknown>) => ({
        ...current,
        ...patch,
        page: 1,
      })) as never,
    });

  return (
    <View hideBorder hideHeaderBottomBorder>
      <PageWorkspace className="container mx-auto py-layout-2xl">
        <PageLevelHeader
          backButtonLabel="Back to inventory import"
          eyebrow="Operations"
          title="Inventory cost overlay"
          description="Apply legacy unit costs to anchored Athena SKUs without changing stock or historical sales."
          onNavigateBack={() =>
            void navigate({
              params: ((params: {
                orgUrlSlug?: string;
                storeUrlSlug?: string;
              }) => ({
                ...params,
                orgUrlSlug: params.orgUrlSlug!,
                storeUrlSlug: params.storeUrlSlug!,
              })) as never,
              to: "/$orgUrlSlug/store/$storeUrlSlug/operations/inventory-import",
            })
          }
          showBackButton
        />

        <PageWorkspaceGrid>
          <PageWorkspaceMain className="space-y-layout-md">
            {!runId ? (
              <div className="space-y-layout-md">
                {recentRuns === undefined ? null : (
                  <InventoryCostOverlayRecentRuns
                    onOpenRun={(selectedRunId) =>
                      void navigate({
                        search: ((current: Record<string, unknown>) => ({
                          ...current,
                          run: selectedRunId,
                        })) as never,
                      })
                    }
                    runs={recentRuns}
                  />
                )}
                {latestReviewVersion === undefined ? (
                  <EmptyState
                    icon={<LoaderCircle className="h-10 w-10 animate-spin" />}
                    title="Loading saved source"
                    description="Loading the latest inventory review version."
                  />
                ) : latestReviewVersion === null ? (
                  <EmptyState
                    icon={<FileSpreadsheet className="h-10 w-10" />}
                    title="No saved review version"
                    description="Save an inventory review version before creating a cost overlay."
                  />
                ) : latestReviewVersion.descriptorStatus === "unavailable" ? (
                  <EmptyState
                    icon={<FileSpreadsheet className="h-10 w-10" />}
                    title="Saved source needs review"
                    description="Return to Inventory Import and save a source that Athena can read."
                  />
                ) : (
                  <SourceConfirmation
                    acknowledged={acknowledged}
                    columnId={selectedColumnId}
                    columns={latestReviewVersion.columns}
                    onAcknowledgedChange={setAcknowledged}
                    onColumnChange={setSelectedColumnId}
                    onCreate={() => void handleCreate()}
                    reviewVersion={latestReviewVersion}
                    submitting={isCreating}
                  />
                )}
              </div>
            ) : run === undefined ? (
              <EmptyState
                icon={<LoaderCircle className="h-10 w-10 animate-spin" />}
                title="Loading cost overlay"
                description="Loading the saved decisions and progress."
              />
            ) : (
              <InventoryCostOverlayWorkspaceContent
                canLoadMore={
                  rowPage.status === "CanLoadMore" &&
                  page < INVENTORY_COST_OVERLAY_MAX_RESTORED_PAGE
                }
                filter={filter}
                isBulkUpdating={isBulkUpdating}
                isLoadingRows={rowPage.status === "LoadingMore"}
                isPreparing={isPreparing}
                onBulkDecision={(decision) => void handleBulkDecision(decision)}
                onDecisionChange={(row, decision) =>
                  void handleDecisionChange(row, decision)
                }
                onFilterChange={(nextFilter) =>
                  updateRouteReviewState({ filter: nextFilter })
                }
                onLoadMore={() => {
                  rowPage.loadMore(INVENTORY_COST_OVERLAY_PAGE_SIZE);
                  void navigate({
                    replace: true,
                    search: ((current: Record<string, unknown>) => ({
                      ...current,
                      page: Math.min(
                        INVENTORY_COST_OVERLAY_MAX_RESTORED_PAGE,
                        page + 1,
                      ),
                    })) as never,
                  });
                }}
                onPrepare={() => void handlePrepare()}
                onQueryChange={(nextQuery) =>
                  updateRouteReviewState({ q: nextQuery || undefined })
                }
                query={query}
                rows={rows}
                run={run}
                savingRowId={savingRowId}
              />
            )}
          </PageWorkspaceMain>

          <PageWorkspaceRail>
            <aside className="rounded-lg border border-border bg-surface-raised p-layout-md shadow-surface">
              <div className="flex items-start justify-between gap-layout-md">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                    Cost evidence
                  </p>
                  <h2 className="mt-1 text-lg font-semibold">
                    {run ? STATUS_COPY[run.status].label : "Choose source"}
                  </h2>
                </div>
                <ShieldCheck className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="mt-layout-sm text-sm leading-6 text-muted-foreground">
                This workflow updates current valuation and future cost
                accounting only. Stock, selling price, identity, and completed
                sale facts stay unchanged.
              </p>

              <div className="mt-layout-md space-y-3 border-t border-border pt-layout-md">
                <div className="flex items-start gap-3">
                  <CircleDollarSign className="mt-0.5 h-4 w-4 text-muted-foreground" />
                  <p className="text-sm">
                    Source values remain attached to their saved review version.
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 text-muted-foreground" />
                  <p className="text-sm">
                    Each known-cost overwrite requires an explicit decision.
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <History className="mt-0.5 h-4 w-4 text-muted-foreground" />
                  <p className="text-sm">
                    Undo restores only rows that are still safe to change.
                  </p>
                </div>
              </div>

              {run?.status === "prepared" ? (
                <div className="mt-layout-md border-t border-border pt-layout-md">
                  <p className="text-sm font-medium">Apply controls</p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    Confirm apply after reviewing the sealed valuation impact.
                  </p>
                  {run.largestImpacts?.length ? (
                    <div className="mt-layout-sm rounded-md border border-border bg-background p-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Largest SKU-level changes
                      </p>
                      <ul className="mt-2 space-y-2">
                        {run.largestImpacts.map((impact, index) => (
                          <li
                            className="flex items-start justify-between gap-3 text-sm"
                            key={`${impact.sku ?? impact.productName}-${index}`}
                          >
                            <span className="min-w-0 truncate">
                              {impact.productName}
                              {impact.sku ? ` · ${impact.sku}` : ""}
                            </span>
                            <span className="shrink-0 font-medium">
                              {formatSignedCost(
                                run.currencyCode,
                                impact.deltaMinor,
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <div className="mt-layout-sm flex items-start gap-3 rounded-md border border-border bg-background p-3">
                    <Checkbox
                      checked={impactAcknowledged}
                      id="inventory-cost-overlay-impact-acknowledgement"
                      onCheckedChange={(checked) =>
                        setImpactAcknowledged(checked === true)
                      }
                    />
                    <Label
                      className="font-normal leading-5"
                      htmlFor="inventory-cost-overlay-impact-acknowledgement"
                    >
                      I reviewed the sealed row count and valuation impact.
                    </Label>
                  </div>
                  <LoadingButton
                    className="mt-layout-sm w-full"
                    disabled={
                      !impactAcknowledged || !run.manifestDigest || isApplying
                    }
                    isLoading={isApplying}
                    onClick={() => void handleApply()}
                  >
                    Apply selected costs
                  </LoadingButton>
                </div>
              ) : null}

              {run &&
              (run.status === "applied" ||
                run.status === "applied_with_exceptions") ? (
                <div className="mt-layout-md border-t border-border pt-layout-md">
                  <p className="text-sm font-medium">Compensating undo</p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    Athena restores only rows that still match their applied
                    state. Changed rows are skipped and reported.
                  </p>
                  {undoPreviewRefreshState !== "ready" ||
                  undoPreview?.status !== "ready" ? (
                    <p
                      aria-live="polite"
                      className="mt-layout-sm text-sm text-muted-foreground"
                    >
                      Refreshing the current undo scope.
                    </p>
                  ) : null}
                  <div className="mt-layout-sm grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="rounded-md border border-border bg-background p-2">
                      <p className="font-semibold">
                        {undoPreviewRefreshState === "ready" &&
                        undoPreview?.status === "ready"
                          ? undoPreview.compensableCount
                          : "—"}
                      </p>
                      <p className="text-muted-foreground">Compensable</p>
                    </div>
                    <div className="rounded-md border border-border bg-background p-2">
                      <p className="font-semibold">
                        {undoPreviewRefreshState === "ready" &&
                        undoPreview?.status === "ready"
                          ? undoPreview.staleCount
                          : "—"}
                      </p>
                      <p className="text-muted-foreground">Stale</p>
                    </div>
                    <div className="rounded-md border border-border bg-background p-2">
                      <p className="font-semibold">
                        {undoPreviewRefreshState === "ready" &&
                        undoPreview?.status === "ready"
                          ? undoPreview.restoredCount
                          : "—"}
                      </p>
                      <p className="text-muted-foreground">Restored</p>
                    </div>
                  </div>
                  <div className="mt-layout-sm flex items-start gap-3 rounded-md border border-border bg-background p-3">
                    <Checkbox
                      checked={undoAcknowledged}
                      disabled={
                        undoPreviewRefreshState !== "ready" ||
                        undoPreview?.status !== "ready"
                      }
                      id="inventory-cost-overlay-undo-acknowledgement"
                      onCheckedChange={(checked) =>
                        setUndoAcknowledged(checked === true)
                      }
                    />
                    <Label
                      className="font-normal leading-5"
                      htmlFor="inventory-cost-overlay-undo-acknowledgement"
                    >
                      I understand normal activity can reduce the compensable
                      scope.
                    </Label>
                  </div>
                  <LoadingButton
                    className="mt-layout-sm w-full"
                    disabled={
                      !undoAcknowledged ||
                      undoPreviewRefreshState !== "ready" ||
                      undoPreview?.status !== "ready" ||
                      isUndoing
                    }
                    isLoading={isUndoing}
                    onClick={() => void handleUndo()}
                    variant="outline"
                  >
                    <RotateCcw className="mr-2 h-4 w-4" />
                    Undo safe rows
                  </LoadingButton>
                </div>
              ) : null}

              {run?.retryableWork ? (
                <div className="mt-layout-md border-t border-border pt-layout-md">
                  <p className="text-sm font-medium">Interrupted work</p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    Athena classified this {run.retryableWork} step as
                    interrupted. Retrying resumes from its durable checkpoint.
                  </p>
                  <LoadingButton
                    className="mt-layout-sm w-full"
                    isLoading={isRetrying}
                    onClick={() => void handleRetry()}
                    variant="outline"
                  >
                    Resume work
                  </LoadingButton>
                </div>
              ) : null}

              {run ? (
                <InventoryCostOverlayRunLifecycleControls
                  bulkDecisionStatus={run.bulkDecisionStatus}
                  isAbandoning={isAbandoning}
                  isReopening={isReopening}
                  onAbandon={() => void handleAbandon()}
                  onReopen={() => void handleReopen()}
                  status={run.status}
                />
              ) : null}
            </aside>
          </PageWorkspaceRail>
        </PageWorkspaceGrid>
      </PageWorkspace>
    </View>
  );
}
