import {
  Ban,
  Check,
  Hand,
  PackageCheck,
  RotateCcw,
  StopCircle,
  XCircle,
  MessageSquare,
  AlertTriangle,
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
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import { LoadingButton } from "../ui/loading-button";
import { getOrderState } from "./utils";
import { Separator } from "../ui/separator";
import { OrderSummary } from "./OrderSummary";
import { toast } from "sonner";
import { CheckCircledIcon } from "@radix-ui/react-icons";
import { useAuth } from "~/src/hooks/useAuth";
import { Badge } from "../ui/badge";
import { LowStockStatus, OutOfStockStatus } from "../product/ProductStock";

function OrderItem({ item, order }: { item: any; order: any }) {
  const [isUpdatingOrderItem, setIsUpdatingOrderItem] = useState(false);
  const [isRequestingFeedback, setIsRequestingFeedback] = useState(false);
  const { user } = useAuth();

  const updateOrderItem = useMutation(api.storeFront.onlineOrderItem.update);
  const returnItemToStock = useMutation(
    api.storeFront.onlineOrder.returnItemsToStock
  );
  const requestFeedback = useAction(api.storeFront.reviews.sendFeedbackRequest);

  const handleUpdateOrderItem = async (isReady: boolean) => {
    try {
      setIsUpdatingOrderItem(true);
      await updateOrderItem({
        id: item._id,
        updates: { isReady },
      });
    } catch (error) {
      console.error(error);
    } finally {
      setIsUpdatingOrderItem(false);
    }
  };

  const handleReturnItemToStock = async () => {
    if (!order.externalTransactionId) return;

    try {
      setIsUpdatingOrderItem(true);
      await returnItemToStock({
        externalTransactionId: order.externalTransactionId,
        onlineOrderItemIds: [item._id],
      });
    } catch (error) {
      console.log(error);
    } finally {
      setIsUpdatingOrderItem(false);
    }
  };

  const handleRequestFeedback = async () => {
    try {
      setIsRequestingFeedback(true);
      const result = await requestFeedback({
        productSkuId: item.productSkuId,
        customerEmail: order.customerDetails.email,
        customerName: order.customerDetails.firstName,
        orderId: order._id,
        orderItemId: item._id,
        signedInAthenaUser: user
          ? {
              id: user._id,
              email: user.email,
            }
          : undefined,
      });

      if (!result.success) {
        toast.error(result.error);
        return;
      }

      toast.success("Feedback request sent");
    } catch (error) {
      console.error(error);
      toast.error("Failed to send feedback request", {
        description: (error as Error).message,
      });
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
    <div className="flex gap-8">
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
            `${window.location.pathname}${window.location.search}`
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
                className="w-24 h-24 aspect-square object-cover rounded-lg"
              />
              <div className="absolute -top-2 -right-2 bg-primary/70 text-primary-foreground text-xs w-4 h-4 rounded-full flex items-center justify-center">
                {item.quantity}
              </div>
            </div>
          </div>
        ) : (
          <div className="w-24 h-24 bg-gray-100 rounded-lg" />
        )}
      </Link>
      <div className="space-y-8">
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
              `${window.location.pathname}${window.location.search}`
            ),
            variant: item.productSku,
          }}
          className="space-y-2"
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

        <div className="space-y-2">
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
                  disabled={item.quantity > item.currentInventoryCount}
                >
                  <Check className="h-4 w-4 mr-2 text-green-700" />
                  Ready
                </LoadingButton>
              )}

              {item?.isReady && (
                <LoadingButton
                  isLoading={isUpdatingOrderItem}
                  onClick={() => handleUpdateOrderItem(false)}
                  variant="outline"
                >
                  <XCircle className="h-4 w-4 mr-2 text-red-700" />
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
    </div>
  );
}

export function OrderItemsView() {
  const { order } = useOnlineOrder();

  const { activeStore } = useGetActiveStore();

  const [isUpdatingOrderItems, setIsUpdatingOrderItems] = useState(false);

  const restockAllItems = useMutation(
    api.storeFront.onlineOrder.returnAllItemsToStock
  );

  const handleRestockAll = async () => {
    if (!order) return;

    try {
      setIsUpdatingOrderItems(true);
      await restockAllItems({
        orderId: order._id,
      });
    } catch (error) {
      console.error(error);
    } finally {
      setIsUpdatingOrderItems(false);
    }
  };

  if (!order || !activeStore) return null;

  const formatter = currencyFormatter(activeStore.currency);

  const itemsFormatted = order?.items?.map((item: any) => {
    return {
      ...item,
      price: item.price == 0 ? "Free" : formatter.format(item.price),
    };
  });

  const itemsCount =
    order?.items?.reduce((acc: number, item: any) => acc + item.quantity, 0) ||
    0;

  const isFullyRestocked = order?.items?.every((item: any) => item.isRestocked);

  const isFullyRefunded = order?.items?.every((item: any) => item.isRefunded);

  const elementsCount = order?.items?.length || 0;

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      className="h-auto w-full"
      header={
        <div className="flex items-center gap-8">
          <p className="text-sm text-sm text-muted-foreground">
            {itemsCount > 1 ? `${itemsCount} items` : `${itemsCount} item`}
          </p>

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
      <div className="py-4 space-y-16">
        {itemsFormatted?.map((item: any) => (
          <OrderItem key={item._id} item={item} order={order} />
        ))}

        <Separator />

        <OrderSummary />
      </div>
    </View>
  );
}
