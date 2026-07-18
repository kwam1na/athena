import {
  Check,
  PackageCheck,
  RotateCcw,
  XCircle,
  MessageSquare,
} from "lucide-react";
import View from "../View";
import { useOnlineOrder } from "~/src/contexts/OnlineOrderContext";
import { getProductName } from "~/src/lib/productUtils";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import {
  capitalizeFirstLetter,
  currencyFormatter,
  slugToWords,
} from "~/src/lib/utils";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "~/convex/_generated/api";
import { LoadingButton } from "../ui/loading-button";
import { getOrderState } from "./utils";
import { OrderSummary } from "./OrderSummary";
import { toast } from "sonner";
import { useAuth } from "~/src/hooks/useAuth";
import { LowStockStatus, OutOfStockStatus } from "../product/ProductStock";
import { toDisplayAmount } from "~/convex/lib/currency";
import { presentCommandToast } from "~/src/lib/errors/presentCommandToast";
import { runCommand } from "~/src/lib/errors/runCommand";
import { ok } from "~/shared/commandResult";
import type { OnlineOrder, OnlineOrderItem } from "~/types";

type DisplayOrderItem = NonNullable<OnlineOrder["items"]>[number] &
  Pick<OnlineOrderItem, "_id"> & {
  currentInventoryCount?: number;
  isLowStock?: boolean;
  isOutOfStock?: boolean;
  };

type FormattedOrderItem = Omit<DisplayOrderItem, "price"> & {
  price: string;
};

function OrderItem({
  item,
  order,
}: {
  item: FormattedOrderItem;
  order: OnlineOrder;
}) {
  const [isUpdatingOrderItem, setIsUpdatingOrderItem] = useState(false);
  const [isRequestingFeedback, setIsRequestingFeedback] = useState(false);
  const { user } = useAuth();

  const updateOrderItem = useMutation(api.storeFront.onlineOrderItem.update);
  const returnItemToStock = useMutation(
    api.storeFront.onlineOrder.returnItemsToStock,
  );
  const requestFeedback = useAction(api.storeFront.reviews.sendFeedbackRequest);

  const handleUpdateOrderItem = async (isReady: boolean) => {
    try {
      setIsUpdatingOrderItem(true);
      const result = await runCommand(async () => {
        await updateOrderItem({
          id: item._id,
          updates: { isReady },
        });

        return ok(null);
      });

      if (result.kind !== "ok") {
        presentCommandToast(result);
      }
    } finally {
      setIsUpdatingOrderItem(false);
    }
  };

  const handleReturnItemToStock = async () => {
    const externalTransactionId = order.externalTransactionId;
    if (!externalTransactionId) return;

    try {
      setIsUpdatingOrderItem(true);
      const result = await runCommand(async () => {
        await returnItemToStock({
          externalTransactionId,
          onlineOrderItemIds: [item._id],
        });

        return ok(null);
      });

      if (result.kind !== "ok") {
        presentCommandToast(result);
      }
    } finally {
      setIsUpdatingOrderItem(false);
    }
  };

  const handleRequestFeedback = async () => {
    const customerEmail = order.customerDetails.email;
    if (!customerEmail) return;

    try {
      setIsRequestingFeedback(true);
      const result = await runCommand(() =>
        requestFeedback({
          productSkuId: item.productSkuId,
          customerEmail,
          customerName: order.customerDetails.firstName,
          orderId: order._id,
          orderItemId: item._id,
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

      toast.success("Feedback request sent");
    } finally {
      setIsRequestingFeedback(false);
    }
  };

  const isPickup = order.deliveryMethod == "pickup";

  const readyText = isPickup ? "Ready for pickup" : "Ready for delivery";

  const {
    isOrderOpen,
    isOrderReady,
    isPartiallyRefunded,
    hasOrderTransitioned,
    isOrderCompleted,
  } = getOrderState(order);

  return (
    <article className="grid gap-layout-md py-layout-lg last:pb-0 sm:grid-cols-[auto_minmax(0,1fr)]">
      <Link
        to="/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug"
        params={(prev) => ({
          ...prev,
          orgUrlSlug: prev.orgUrlSlug!,
          storeUrlSlug: prev.storeUrlSlug!,
          productSlug: item.productId,
        })}
        search={{
          o: encodeURIComponent(
            `${window.location.pathname}${window.location.search}`,
          ),
          variant: item.productSku,
        }}
      >
        {item.productImage ? (
          <div className="flex flex-col items-center gap-2">
            <div className="relative">
              <img
                src={item.productImage}
                alt={item.productName || "product image"}
                className="h-20 w-20 aspect-square rounded-lg border border-border object-cover sm:h-24 sm:w-24"
              />
              <div className="absolute -top-2 -right-2 bg-muted text-primary-background text-xs w-4 h-4 rounded-full flex items-center justify-center">
                {item.quantity}
              </div>
            </div>
          </div>
        ) : (
          <div className="h-20 w-20 rounded-lg border border-border bg-muted sm:h-24 sm:w-24" />
        )}
      </Link>
      <div className="min-w-0 space-y-layout-md">
        <Link
          to="/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug"
          params={(prev) => ({
            ...prev,
            orgUrlSlug: prev.orgUrlSlug!,
            storeUrlSlug: prev.storeUrlSlug!,
            productSlug: item.productId,
          })}
          search={{
            o: encodeURIComponent(
              `${window.location.pathname}${window.location.search}`,
            ),
            variant: item.productSku,
          }}
          className="block space-y-2 rounded-md outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <p className="text-sm">{getProductName(item)}</p>
          <p className="text-xs text-muted-foreground">{item.productSku}</p>
          <p className="text-xs text-muted-foreground">{item.price}</p>
          {!item.isRefunded && (
            <>
              {item.isOutOfStock && <OutOfStockStatus />}
              {!item.isOutOfStock && item.isLowStock && <LowStockStatus />}
            </>
          )}
        </Link>

        <div className="flex flex-wrap items-center gap-x-layout-md gap-y-layout-xs">
          {/* Stock Status Warnings */}

          {hasOrderTransitioned && !item.isRefunded && (
            <div className="flex ml-auto items-center gap-2 text-muted-foreground">
              <Check className="h-3 w-3" />
              <p className="text-xs">
                {capitalizeFirstLetter(slugToWords(order.status))}
              </p>
            </div>
          )}

          {isOrderReady && !item.isRefunded && (
            <div className="flex ml-auto items-center gap-2 text-muted-foreground">
              <Check className="h-3 w-3" />
              <p className="text-xs">{readyText}</p>
            </div>
          )}

          {item.isRefunded && (
            <div className="flex ml-auto items-center gap-2 text-muted-foreground">
              <RotateCcw className="h-3 w-3" />
              <p className="text-xs">Refunded</p>
            </div>
          )}

          {item.isRestocked && (
            <div className="flex ml-auto items-center gap-2 text-muted-foreground">
              <PackageCheck className="h-3 w-3" />
              <p className="text-xs">Restocked</p>
            </div>
          )}

          {item.feedbackRequested && (
            <div className="flex ml-auto items-center gap-2 text-muted-foreground">
              <MessageSquare className="h-3 w-3" />
              <p className="text-xs">Review requested</p>
            </div>
          )}
        </div>

        {!item.isRefunded &&
          (isOrderOpen || isPartiallyRefunded) &&
          !isOrderReady &&
          !hasOrderTransitioned && (
            <div className="flex items-center gap-4">
              {!item?.isReady && (
                <LoadingButton
                  isLoading={isUpdatingOrderItem}
                  onClick={() => handleUpdateOrderItem(true)}
                  variant="outline"
                  className="border-success/20 bg-success/10 text-success hover:bg-success/15 hover:text-success"
                  disabled={
                    item.currentInventoryCount !== undefined &&
                    item.quantity > item.currentInventoryCount
                  }
                >
                  <Check className="h-4 w-4 mr-2 text-success" />
                  Ready
                </LoadingButton>
              )}

              {item?.isReady && (
                <LoadingButton
                  isLoading={isUpdatingOrderItem}
                  onClick={() => handleUpdateOrderItem(false)}
                  variant="outline"
                  className="border-danger/20 bg-danger/10 text-danger hover:bg-danger/15 hover:text-danger"
                >
                  <XCircle className="h-4 w-4 mr-2 text-danger" />
                  Not ready
                </LoadingButton>
              )}
            </div>
          )}

        {isOrderCompleted && !item.feedbackRequested && (
          <LoadingButton
            isLoading={isRequestingFeedback}
            onClick={handleRequestFeedback}
            variant="outline"
          >
            <MessageSquare className="h-4 w-4 mr-2" />
            Request review
          </LoadingButton>
        )}
      </div>

      {item?.isRefunded && !item?.isRestocked && (
        <LoadingButton
          isLoading={isUpdatingOrderItem}
          onClick={handleReturnItemToStock}
          variant="ghost"
          className="text-muted-foreground"
        >
          <PackageCheck className="h-4 w-4 mr-2" />
          <p className="text-xs">Restock to inventory</p>
        </LoadingButton>
      )}
    </article>
  );
}

export function OrderItemsView() {
  const { order } = useOnlineOrder();

  const { activeStore } = useGetActiveStore();

  const [isUpdatingOrderItems, setIsUpdatingOrderItems] = useState(false);

  const restockAllItems = useMutation(
    api.storeFront.onlineOrder.returnAllItemsToStock,
  );

  const handleRestockAll = async () => {
    if (!order) return;

    try {
      setIsUpdatingOrderItems(true);
      const result = await runCommand(async () => {
        await restockAllItems({
          orderId: order._id,
        });

        return ok(null);
      });

      if (result.kind !== "ok") {
        presentCommandToast(result);
      }
    } finally {
      setIsUpdatingOrderItems(false);
    }
  };

  if (!order || !activeStore) return null;

  const formatter = currencyFormatter(activeStore.currency);

  const displayItems = (order.items ?? []) as DisplayOrderItem[];
  const itemsFormatted = displayItems.map((item) => {
    return {
      ...item,
      price:
        item.price == 0
          ? "Free"
          : formatter.format(toDisplayAmount(item.price)),
    };
  });

  const itemsCount =
    order.items?.reduce((acc, item) => acc + item.quantity, 0) || 0;

  const isFullyRestocked = order.items?.every((item) => item.isRestocked);

  const isFullyRefunded = order.items?.every((item) => item.isRefunded);

  const elementsCount = order.items?.length || 0;

  return (
    <View
      fullHeight={false}
      lockDocumentScroll={false}
      className="w-full bg-transparent"
      contentClassName="bg-surface-raised shadow-surface"
      headerClassName="px-layout-lg py-layout-md md:px-layout-xl"
      header={
        <div className="flex items-center gap-layout-md">
          <div>
            <p className="text-base font-medium text-foreground">
              Purchased items
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {itemsCount > 1 ? `${itemsCount} items` : `${itemsCount} item`}
            </p>
          </div>

          {elementsCount > 1 && !isFullyRestocked && isFullyRefunded && (
            <LoadingButton
              isLoading={isUpdatingOrderItems}
              onClick={handleRestockAll}
              variant="ghost"
              className="text-muted-foreground ml-auto"
            >
              <PackageCheck className="h-4 w-4 mr-2" />
              <p className="text-xs">Restock all to inventory</p>
            </LoadingButton>
          )}
        </div>
      }
    >
      <div className="divide-y divide-border px-layout-lg md:px-layout-xl">
        {itemsFormatted?.map((item) => (
          <OrderItem key={item._id} item={item} order={order} />
        ))}

        <div className="py-layout-lg">
          <OrderSummary />
        </div>
      </div>
    </View>
  );
}
