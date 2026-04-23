import { useEffect, useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";

import View from "../View";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
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

function buildDefaultReceivedQuantities(lineItems: ReceivingViewLineItem[]) {
  return Object.fromEntries(
    lineItems.map((lineItem) => [
      lineItem._id,
      String(Math.max(0, lineItem.orderedQuantity - lineItem.receivedQuantity)),
    ])
  );
}

function buildReceivedQuantitiesAfterSubmission(
  lineItems: ReceivingViewLineItem[],
  batchLineItems: ReceivingBatchLineItem[]
) {
  const receivedByLineItemId = new Map(
    batchLineItems.map((lineItem) => [
      lineItem.purchaseOrderLineItemId,
      lineItem.receivedQuantity,
    ])
  );

  return Object.fromEntries(
    lineItems.map((lineItem) => [
      lineItem._id,
      String(
        Math.max(
          0,
          lineItem.orderedQuantity -
            lineItem.receivedQuantity -
            (receivedByLineItemId.get(lineItem._id) ?? 0)
        )
      ),
    ])
  );
}

export function ReceivingView({
  lineItems,
  purchaseOrderId,
  storeId,
}: ReceivingViewProps) {
  const receivePurchaseOrderBatch = useMutation(
    api.stockOps.receiving.receivePurchaseOrderBatch
  );
  const [submissionKey, setSubmissionKey] = useState(() =>
    buildSubmissionKey(purchaseOrderId)
  );
  const [receivedQuantities, setReceivedQuantities] = useState<Record<string, string>>(
    () => buildDefaultReceivedQuantities(lineItems)
  );
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
        0
      ),
    [lineItems]
  );

  const handleSubmit = async () => {
    const batchLineItems = lineItems
      .map((lineItem) => ({
        purchaseOrderLineItemId: lineItem._id,
        receivedQuantity: Number(receivedQuantities[lineItem._id] ?? "0"),
      }))
      .filter((lineItem) => lineItem.receivedQuantity > 0);

    if (batchLineItems.length === 0) {
      toast.error("Add at least one received quantity greater than zero.");
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
        })
      );

      if (result.kind !== "ok") {
        presentCommandToast(result);
        return;
      }

      toast.success("Receiving batch recorded");
      setReceivedQuantities(
        buildReceivedQuantitiesAfterSubmission(lineItems, batchLineItems)
      );
      setSubmissionKey(buildSubmissionKey(purchaseOrderId));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      header={
        <div className="container mx-auto flex h-[40px] items-center">
          <p className="text-xl font-medium">Receiving</p>
        </div>
      }
    >
      <div className="container mx-auto space-y-6 py-8">
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Record a purchase-order receipt without bypassing inventory
            movements.
          </p>
          <p className="text-sm text-muted-foreground">
            Remaining units on this order: {remainingTotal}
          </p>
        </div>

        <div className="space-y-4 rounded-md border p-4">
          <div className="space-y-2">
            <Label htmlFor="submission-key">Submission key</Label>
            <Input
              id="submission-key"
              onChange={(event) => setSubmissionKey(event.target.value)}
              value={submissionKey}
            />
          </div>

          <div className="space-y-4">
            {lineItems.map((lineItem) => (
              <div className="grid gap-2 rounded-md border p-3" key={lineItem._id}>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium">
                      {lineItem.description ?? lineItem.productSkuId}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Ordered {lineItem.orderedQuantity} · Received{" "}
                      {lineItem.receivedQuantity}
                    </p>
                  </div>
                  <Input
                    className="max-w-28"
                    min={0}
                    aria-label={`Received quantity for ${
                      lineItem.description ?? lineItem.productSkuId
                    }`}
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
            ))}
          </div>

          <LoadingButton isLoading={isSubmitting} onClick={handleSubmit}>
            Record receiving batch
          </LoadingButton>
        </div>
      </div>
    </View>
  );
}
