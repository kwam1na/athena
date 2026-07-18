import { useEffect, useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";

import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { LoadingButton } from "../ui/loading-button";
import { WorkflowTraceRouteLink } from "../traces/WorkflowTraceRouteLink";
import type { Id } from "~/convex/_generated/dataModel";
import { api } from "~/convex/_generated/api";
import { presentCommandToast } from "@/lib/errors/presentCommandToast";
import { runCommand } from "@/lib/errors/runCommand";
import { toDisplayAmount } from "~/convex/lib/currency";
import { parseDisplayAmountInput } from "@/lib/pos/displayAmounts";
import type { CommandResult } from "~/shared/commandResult";
import type { FunctionReference } from "convex/server";

type ReceivingViewLineItem = {
  _id: Id<"purchaseOrderLineItem">;
  description?: string;
  orderedQuantity: number;
  productSkuId: Id<"productSku">;
  receivedQuantity: number;
  unitCost?: number;
};

type ReceivingViewProps = {
  currency?: string;
  lineItems: ReceivingViewLineItem[];
  onReceived?: () => void;
  purchaseOrderId: Id<"purchaseOrder">;
  storeId: Id<"store">;
  workflowTraceId?: string;
};

type ReceivingBatchLineItem = {
  confirmedCurrency?: string;
  confirmedUnitCost?: number;
  purchaseOrderLineItemId: Id<"purchaseOrderLineItem">;
  receivedQuantity: number;
};

type ReceivePurchaseOrderBatchArgs = {
  lineItems: ReceivingBatchLineItem[];
  purchaseOrderId: Id<"purchaseOrder">;
  receivedByUserId?: Id<"athenaUser">;
  storeId: Id<"store">;
  submissionKey: string;
};

type ReceivePurchaseOrderBatchMutation = FunctionReference<
  "mutation",
  "public",
  ReceivePurchaseOrderBatchArgs,
  CommandResult<unknown>
>;

const receivingApi = api.stockOps.receiving as unknown as {
  receivePurchaseOrderBatch: ReceivePurchaseOrderBatchMutation;
};

function buildSubmissionKey(purchaseOrderId: Id<"purchaseOrder">) {
  return `receive-${purchaseOrderId}-${Date.now().toString(36)}`;
}

function parseLineItemDescription(lineItem: ReceivingViewLineItem) {
  const label = lineItem.description ?? lineItem.productSkuId;
  const skuMatch = label.match(/^(?<name>.+) \((?<sku>[^)]+)\)$/);

  if (!skuMatch?.groups) {
    return { name: label, sku: undefined };
  }

  return {
    name: skuMatch.groups.name,
    sku: skuMatch.groups.sku,
  };
}

function buildDefaultReceivedQuantities(lineItems: ReceivingViewLineItem[]) {
  return Object.fromEntries(
    lineItems.map((lineItem) => [
      lineItem._id,
      String(Math.max(0, lineItem.orderedQuantity - lineItem.receivedQuantity)),
    ]),
  );
}

function buildDefaultConfirmedUnitCosts(lineItems: ReceivingViewLineItem[]) {
  return Object.fromEntries(
    lineItems.map((lineItem) => [
      lineItem._id,
      lineItem.unitCost === undefined
        ? ""
        : String(toDisplayAmount(lineItem.unitCost)),
    ]),
  );
}

function buildReceivedQuantitiesAfterSubmission(
  lineItems: ReceivingViewLineItem[],
  batchLineItems: ReceivingBatchLineItem[],
) {
  const receivedByLineItemId = new Map(
    batchLineItems.map((lineItem) => [
      lineItem.purchaseOrderLineItemId,
      lineItem.receivedQuantity,
    ]),
  );

  return Object.fromEntries(
    lineItems.map((lineItem) => [
      lineItem._id,
      String(
        Math.max(
          0,
          lineItem.orderedQuantity -
            lineItem.receivedQuantity -
            (receivedByLineItemId.get(lineItem._id) ?? 0),
        ),
      ),
    ]),
  );
}

export function ReceivingView({
  currency,
  lineItems,
  onReceived,
  purchaseOrderId,
  storeId,
  workflowTraceId,
}: ReceivingViewProps) {
  const receivePurchaseOrderBatch = useMutation(
    receivingApi.receivePurchaseOrderBatch,
  );
  const [submissionKey, setSubmissionKey] = useState(() =>
    buildSubmissionKey(purchaseOrderId),
  );
  const [receivedQuantities, setReceivedQuantities] = useState<
    Record<string, string>
  >(() => buildDefaultReceivedQuantities(lineItems));
  const [confirmedUnitCosts, setConfirmedUnitCosts] = useState<
    Record<string, string>
  >(() => buildDefaultConfirmedUnitCosts(lineItems));
  const [confirmedCurrency, setConfirmedCurrency] = useState(
    () => currency?.trim().toUpperCase() ?? "",
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setReceivedQuantities(buildDefaultReceivedQuantities(lineItems));
    setConfirmedUnitCosts(buildDefaultConfirmedUnitCosts(lineItems));
  }, [lineItems]);

  useEffect(() => {
    setConfirmedCurrency(currency?.trim().toUpperCase() ?? "");
  }, [currency]);

  const remainingTotal = useMemo(
    () =>
      lineItems.reduce(
        (total, lineItem) =>
          total +
          Math.max(0, lineItem.orderedQuantity - lineItem.receivedQuantity),
        0,
      ),
    [lineItems],
  );

  const handleSubmit = async () => {
    const normalizedCurrency =
      confirmedCurrency.trim().toUpperCase() || undefined;
    const batchLineItems: ReceivingBatchLineItem[] = [];

    for (const lineItem of lineItems) {
      const receivedQuantity = Number(
        receivedQuantities[lineItem._id] ?? "0",
      );
      if (receivedQuantity <= 0) continue;

      const rawUnitCost = confirmedUnitCosts[lineItem._id] ?? "";
      const confirmedUnitCost = parseDisplayAmountInput(rawUnitCost);
      if (rawUnitCost.trim().length > 0 && confirmedUnitCost === undefined) {
        toast.error("Enter a valid unit cost or leave it blank.");
        return;
      }

      batchLineItems.push({
        confirmedCurrency: normalizedCurrency,
        confirmedUnitCost,
        purchaseOrderLineItemId: lineItem._id,
        receivedQuantity,
      });
    }

    if (batchLineItems.length === 0) {
      toast.error("Add at least one received quantity greater than zero");
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await runCommand(() =>
        receivePurchaseOrderBatch({
          lineItems: batchLineItems,
          purchaseOrderId,
          receivedByUserId: undefined,
          storeId,
          submissionKey,
        }),
      );

      if (result.kind !== "ok") {
        presentCommandToast(result);
        return;
      }

      toast.success("Receiving batch recorded");
      setReceivedQuantities(
        buildReceivedQuantitiesAfterSubmission(lineItems, batchLineItems),
      );
      setSubmissionKey(buildSubmissionKey(purchaseOrderId));
      onReceived?.();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-layout-md">
      <div className="flex flex-wrap items-center justify-between gap-layout-sm">
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{remainingTotal}</span>{" "}
          units remaining
        </p>
        {workflowTraceId ? (
          <WorkflowTraceRouteLink
            className="text-xs font-medium text-primary"
            traceId={workflowTraceId}
          >
            View trace
          </WorkflowTraceRouteLink>
        ) : null}
      </div>

      <div className="space-y-layout-md">
        <div className="flex flex-col gap-layout-sm rounded-md border border-border bg-surface px-3 py-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 space-y-1">
            <Label htmlFor="receiving-currency">Receipt currency</Label>
            <p className="text-xs text-muted-foreground">
              Confirm the currency used for this delivery.
            </p>
          </div>
          <Input
            aria-label="Receipt currency"
            className="h-9 max-w-32 uppercase"
            id="receiving-currency"
            onChange={(event) => setConfirmedCurrency(event.target.value)}
            placeholder="Unknown"
            value={confirmedCurrency}
          />
        </div>

        <div className="space-y-2">
          {lineItems.map((lineItem) => {
            const displayItem = parseLineItemDescription(lineItem);

            return (
              <div
                className="space-y-3 rounded-md border border-border bg-surface px-3 py-3"
                key={lineItem._id}
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium capitalize text-foreground">
                      {displayItem.name}
                    </p>
                    {displayItem.sku ? (
                      <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                        {displayItem.sku}
                      </span>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Ordered {lineItem.orderedQuantity} · Received{" "}
                    {lineItem.receivedQuantity}
                  </p>
                </div>

                <div className="grid gap-layout-sm border-t border-border/70 pt-3 sm:grid-cols-[minmax(0,1fr)_6rem_9rem] sm:items-end">
                  <div className="min-w-0 space-y-1">
                    <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                      Receive now
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Enter units from this delivery.
                    </p>
                  </div>
                  <div className="space-y-1">
                    <Label
                      className="text-xs text-muted-foreground"
                      htmlFor={`received-quantity-${lineItem._id}`}
                    >
                      Quantity
                    </Label>
                    <Input
                      aria-label={`Received quantity for ${
                        lineItem.description ?? lineItem.productSkuId
                      }`}
                      className="h-9 text-right"
                      id={`received-quantity-${lineItem._id}`}
                      min={0}
                      onChange={(event) =>
                        setReceivedQuantities((current) => ({
                          ...current,
                          [lineItem._id]: event.target.value,
                        }))
                      }
                      type="number"
                      value={receivedQuantities[lineItem._id] ?? "0"}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label
                      className="text-xs text-muted-foreground"
                      htmlFor={`confirmed-unit-cost-${lineItem._id}`}
                    >
                      Unit cost{confirmedCurrency ? ` (${confirmedCurrency})` : ""}
                    </Label>
                    <Input
                      aria-label={`Confirmed unit cost for ${
                        lineItem.description ?? lineItem.productSkuId
                      }`}
                      className="h-9 text-right font-numeric"
                      id={`confirmed-unit-cost-${lineItem._id}`}
                      min={0}
                      onChange={(event) =>
                        setConfirmedUnitCosts((current) => ({
                          ...current,
                          [lineItem._id]: event.target.value,
                        }))
                      }
                      placeholder="Unknown"
                      step="0.01"
                      type="number"
                      value={confirmedUnitCosts[lineItem._id] ?? ""}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <LoadingButton
          className="w-full"
          isLoading={isSubmitting}
          onClick={handleSubmit}
          variant="default"
        >
          Record receiving batch
        </LoadingButton>
      </div>
    </div>
  );
}
