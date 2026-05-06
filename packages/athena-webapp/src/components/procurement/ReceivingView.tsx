import { useEffect, useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";

import { Input } from "../ui/input";
import { LoadingButton } from "../ui/loading-button";
import type { Id } from "~/convex/_generated/dataModel";
import { api } from "~/convex/_generated/api";
import { presentCommandToast } from "@/lib/errors/presentCommandToast";
import { runCommand } from "@/lib/errors/runCommand";

type ReceivingViewLineItem = {
  _id: Id<"purchaseOrderLineItem">;
  description?: string;
  orderedQuantity: number;
  productSkuId: Id<"productSku">;
  receivedQuantity: number;
};

type ReceivingViewProps = {
  lineItems: ReceivingViewLineItem[];
  onReceived?: () => void;
  purchaseOrderId: Id<"purchaseOrder">;
  storeId: Id<"store">;
};

type ReceivingBatchLineItem = {
  purchaseOrderLineItemId: Id<"purchaseOrderLineItem">;
  receivedQuantity: number;
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
  lineItems,
  onReceived,
  purchaseOrderId,
  storeId,
}: ReceivingViewProps) {
  const receivePurchaseOrderBatch = useMutation(
    api.stockOps.receiving.receivePurchaseOrderBatch,
  );
  const [submissionKey, setSubmissionKey] = useState(() =>
    buildSubmissionKey(purchaseOrderId),
  );
  const [receivedQuantities, setReceivedQuantities] = useState<
    Record<string, string>
  >(() => buildDefaultReceivedQuantities(lineItems));
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setReceivedQuantities(buildDefaultReceivedQuantities(lineItems));
  }, [lineItems]);

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
    const batchLineItems = lineItems
      .map((lineItem) => ({
        purchaseOrderLineItemId: lineItem._id,
        receivedQuantity: Number(receivedQuantities[lineItem._id] ?? "0"),
      }))
      .filter((lineItem) => lineItem.receivedQuantity > 0);

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
      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{remainingTotal}</span>{" "}
        units remaining
      </p>

      <div className="space-y-layout-md">
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

                <div className="flex items-end justify-between gap-layout-md border-t border-border/70 pt-3">
                  <div className="min-w-0 space-y-1">
                    <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                      Receive now
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Enter units from this delivery.
                    </p>
                  </div>
                  <Input
                    aria-label={`Received quantity for ${
                      lineItem.description ?? lineItem.productSkuId
                    }`}
                    className="h-9 max-w-24 text-right"
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
              </div>
            );
          })}
        </div>

        <LoadingButton
          className="w-full"
          isLoading={isSubmitting}
          onClick={handleSubmit}
          variant="workflow"
        >
          Record receiving batch
        </LoadingButton>
      </div>
    </div>
  );
}
