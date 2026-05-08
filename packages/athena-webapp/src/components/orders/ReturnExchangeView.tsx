import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { CheckCircle2, RotateCcw } from "lucide-react";
import { CheckCircledIcon } from "@radix-ui/react-icons";
import { toast } from "sonner";

import View from "../View";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { LoadingButton } from "../ui/loading-button";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group";
import { Switch } from "../ui/switch";
import { useOnlineOrder } from "~/src/contexts/OnlineOrderContext";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { useAuth } from "~/src/hooks/useAuth";
import { api } from "~/convex/_generated/api";
import { presentCommandToast } from "~/src/lib/errors/presentCommandToast";
import { parseDisplayAmountInput } from "~/src/lib/pos/displayAmounts";
import { runCommand } from "~/src/lib/errors/runCommand";
import { currencyFormatter, getRelativeTime } from "~/src/lib/utils";
import { formatStoredAmount } from "~/src/lib/pos/displayAmounts";
import type { Id } from "~/convex/_generated/dataModel";

export type ReturnExchangePayload = {
  operationType: "exchange" | "return";
  replacementItems: Array<{
    productId?: string;
    productName?: string;
    productSkuId: string;
    quantity: number;
    unitPrice: number;
  }>;
  restockReturnedItems: boolean;
  returnItemIds: string[];
};

type ReturnExchangeOverview = {
  balanceCollectedTotal: number;
  pendingApprovalCount: number;
  recentEvents: Array<{
    _id: string;
    createdAt: number;
    eventType: string;
    message: string;
  }>;
  refundTotal: number;
};

type ReturnExchangeOrderItem = {
  _id?: string;
  isRefunded?: boolean;
  price: number;
  productName?: string;
  productSku?: string;
  quantity: number;
};

type ReturnExchangeOrder = {
  items?: ReturnExchangeOrderItem[];
};

type ReturnExchangeViewContentProps = {
  activity?: ReturnExchangeOverview["recentEvents"];
  balanceCollectedTotal?: number;
  currency?: string;
  isSubmitting: boolean;
  onSubmit: (payload: ReturnExchangePayload) => Promise<void>;
  order: ReturnExchangeOrder;
  pendingApprovalCount: number;
  refundTotal?: number;
};

export function ReturnExchangeViewContent({
  activity = [],
  balanceCollectedTotal = 0,
  currency = "GHS",
  isSubmitting,
  onSubmit,
  order,
  pendingApprovalCount,
  refundTotal = 0,
}: ReturnExchangeViewContentProps) {
  const [operationType, setOperationType] = useState<"exchange" | "return">(
    "return",
  );
  const [replacementProductId, setReplacementProductId] = useState("");
  const [replacementProductName, setReplacementProductName] = useState("");
  const [replacementProductSkuId, setReplacementProductSkuId] = useState("");
  const [replacementQuantity, setReplacementQuantity] = useState("1");
  const [replacementUnitPrice, setReplacementUnitPrice] = useState("");
  const [restockReturnedItems, setRestockReturnedItems] = useState(true);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [validationError, setValidationError] = useState<string | null>(null);

  const formatter = currencyFormatter(currency);
  const availableItems =
    order?.items?.filter(
      (item): item is ReturnExchangeOrderItem & { _id: string } =>
        Boolean(item._id) && !item.isRefunded,
    ) ?? [];

  const toggleItem = (itemId: string) => {
    setSelectedItemIds((previous) => {
      const next = new Set(previous);

      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }

      return next;
    });
  };

  const resetReplacementFields = () => {
    setReplacementProductId("");
    setReplacementProductName("");
    setReplacementProductSkuId("");
    setReplacementQuantity("1");
    setReplacementUnitPrice("");
  };

  const handleSubmit = async () => {
    if (selectedItemIds.size === 0) {
      setValidationError("Select at least one line item");
      return;
    }

    const payload: ReturnExchangePayload = {
      operationType,
      replacementItems: [],
      restockReturnedItems,
      returnItemIds: Array.from(selectedItemIds),
    };

    if (operationType === "exchange") {
      const quantity = Number(replacementQuantity);
      const unitPrice = parseDisplayAmountInput(replacementUnitPrice);

      if (!replacementProductSkuId || !replacementProductName || !replacementUnitPrice) {
        setValidationError("Provide the replacement item details");
        return;
      }

      if (!Number.isFinite(quantity) || quantity <= 0) {
        setValidationError("Replacement quantity must be greater than zero");
        return;
      }

      if (unitPrice === undefined || unitPrice <= 0) {
        setValidationError("Replacement price must be greater than zero");
        return;
      }

      payload.replacementItems = [
        {
          productId: replacementProductId || undefined,
          productName: replacementProductName,
          productSkuId: replacementProductSkuId,
          quantity,
          unitPrice,
        },
      ];
    }

    setValidationError(null);
    await onSubmit(payload);
    setSelectedItemIds(new Set());
    resetReplacementFields();
    setOperationType("return");
    setRestockReturnedItems(true);
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="text-base font-medium">Return & Exchange</h3>
        <p className="text-sm text-muted-foreground">
          Record completed storefront returns and exchange-to-new-item flows.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-md border p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Refunds recorded
          </p>
          <p className="mt-2 text-lg font-medium">
            {formatStoredAmount(formatter, refundTotal)}
          </p>
        </div>
        <div className="rounded-md border p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Exchange balance collected
          </p>
          <p className="mt-2 text-lg font-medium">
            {formatStoredAmount(formatter, balanceCollectedTotal)}
          </p>
        </div>
        <div className="rounded-md border p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Pending approvals
          </p>
          <p className="mt-2 text-lg font-medium">
            {pendingApprovalCount} approval pending
            {pendingApprovalCount === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      {availableItems.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No eligible order lines remain for returns or exchanges.
        </p>
      ) : (
        <div className="space-y-3 rounded-md border p-4">
          <div>
            <p className="text-sm font-medium">Select order lines</p>
            <p className="text-sm text-muted-foreground">
              Choose the purchased items being returned or exchanged.
            </p>
          </div>
          {availableItems.map((item) => {
            const checkboxId = `return-item-${item._id}`;

            return (
              <div
                className="flex items-center justify-between gap-4 rounded-md border p-3"
                key={item._id}
              >
                <div className="flex items-center gap-3">
                  <Checkbox
                    checked={selectedItemIds.has(item._id)}
                    id={checkboxId}
                    onCheckedChange={() => toggleItem(item._id)}
                  />
                  <Label className="cursor-pointer" htmlFor={checkboxId}>
                    {item.productName ?? item.productSku}
                  </Label>
                </div>
                <p className="text-sm text-muted-foreground">
                  {item.quantity} x {formatStoredAmount(formatter, item.price)}
                </p>
              </div>
            );
          })}
        </div>
      )}

      <div className="space-y-4 rounded-md border p-4">
        <div>
          <p className="text-sm font-medium">Flow</p>
          <p className="text-sm text-muted-foreground">
            Choose whether staff are completing a straight return or an exchange.
          </p>
        </div>
        <RadioGroup
          className="gap-3"
          onValueChange={(value) => setOperationType(value as "exchange" | "return")}
          value={operationType}
        >
          <div className="flex items-center gap-3">
            <RadioGroupItem id="return-operation" value="return" />
            <Label htmlFor="return-operation">Return selected items</Label>
          </div>
          <div className="flex items-center gap-3">
            <RadioGroupItem id="exchange-operation" value="exchange" />
            <Label htmlFor="exchange-operation">Exchange for a new item</Label>
          </div>
        </RadioGroup>
      </div>

      {operationType === "exchange" && (
        <div className="grid gap-4 rounded-md border p-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="replacement-sku-id">Replacement SKU ID</Label>
            <Input
              id="replacement-sku-id"
              onChange={(event) => setReplacementProductSkuId(event.target.value)}
              value={replacementProductSkuId}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="replacement-product-id">Replacement product ID</Label>
            <Input
              id="replacement-product-id"
              onChange={(event) => setReplacementProductId(event.target.value)}
              value={replacementProductId}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="replacement-product-name">Replacement product name</Label>
            <Input
              id="replacement-product-name"
              onChange={(event) => setReplacementProductName(event.target.value)}
              value={replacementProductName}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="replacement-quantity">Replacement quantity</Label>
            <Input
              id="replacement-quantity"
              onChange={(event) => setReplacementQuantity(event.target.value)}
              type="number"
              value={replacementQuantity}
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="replacement-unit-price">Replacement unit price</Label>
            <Input
              id="replacement-unit-price"
              onChange={(event) => setReplacementUnitPrice(event.target.value)}
              placeholder="75"
              type="number"
              value={replacementUnitPrice}
            />
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 rounded-md border p-4">
        <Switch
          checked={restockReturnedItems}
          id="restock-returned-items"
          onCheckedChange={setRestockReturnedItems}
        />
        <Label className="cursor-pointer" htmlFor="restock-returned-items">
          Return accepted items back into stock
        </Label>
      </div>

      {validationError && (
        <p className="text-sm text-red-600">{validationError}</p>
      )}

      <LoadingButton
        disabled={isSubmitting || availableItems.length === 0}
        isLoading={isSubmitting}
        onClick={handleSubmit}
        variant="outline"
      >
        {operationType === "exchange" ? "Process exchange" : "Process return"}
      </LoadingButton>

      {activity.length > 0 && (
        <div className="space-y-3 rounded-md border p-4">
          <div>
            <p className="text-sm font-medium">Recent return activity</p>
            <p className="text-sm text-muted-foreground">
              Operational milestones recorded for this order.
            </p>
          </div>
          {activity.map((event) => (
            <div
              className="flex items-start justify-between gap-3 rounded-md border p-3"
              key={event._id}
            >
              <div className="flex items-start gap-3">
                {event.eventType.includes("exchange") ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
                ) : (
                  <RotateCcw className="mt-0.5 h-4 w-4 text-amber-700" />
                )}
                <div>
                  <p className="text-sm font-medium">{event.message}</p>
                  <p className="text-xs text-muted-foreground">
                    {getRelativeTime(event.createdAt)}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ReturnExchangeView() {
  const { order } = useOnlineOrder();
  const { activeStore } = useGetActiveStore();
  const { user } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const overview = useQuery(
    api.storeFront.onlineOrder.getReturnExchangeOverview,
    order?._id ? { orderId: order._id } : "skip",
  ) as ReturnExchangeOverview | undefined;
  const processReturnExchange = useMutation(
    api.storeFront.onlineOrder.processReturnExchange,
  );

  if (!order || !activeStore) return null;

  const handleSubmit = async (payload: ReturnExchangePayload) => {
    try {
      setIsSubmitting(true);
      const result = await runCommand(() =>
        processReturnExchange({
            orderId: order._id,
            operationType: payload.operationType,
            replacementItems: payload.replacementItems.map((item) => ({
            productId: item.productId as Id<"product"> | undefined,
            productName: item.productName,
            productSkuId: item.productSkuId as Id<"productSku">,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
          })),
          restockReturnedItems: payload.restockReturnedItems,
          returnItemIds: payload.returnItemIds.map(
            (itemId) => itemId as Id<"onlineOrderItem">,
          ),
          signedInAthenaUser: user
            ? {
                id: user._id,
                email: user.email,
              }
            : undefined,
        }),
      );

      if (result.kind !== "ok") {
        presentCommandToast(result);
        return;
      }

      toast(
        result.data.requiresApproval
          ? "Approval requested"
          : "Return flow recorded",
        {
          icon: <CheckCircledIcon className="w-4 h-4" />,
          description: result.data.message,
        },
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      fullHeight={false}
      lockDocumentScroll={false}
      className="w-full"
      header={<p className="text-sm text-muted-foreground">Return & Exchange</p>}
    >
      <div className="py-4">
        <ReturnExchangeViewContent
          activity={overview?.recentEvents ?? []}
          balanceCollectedTotal={overview?.balanceCollectedTotal ?? 0}
          currency={activeStore.currency}
          isSubmitting={isSubmitting}
          onSubmit={handleSubmit}
          order={order}
          pendingApprovalCount={overview?.pendingApprovalCount ?? 0}
          refundTotal={overview?.refundTotal ?? 0}
        />
      </div>
    </View>
  );
}
