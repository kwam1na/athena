import {
  Ban,
  Check,
  Hand,
  PackageCheck,
  RotateCcw,
  StopCircle,
  XCircle,
} from "lucide-react";
import View from "../View";
import { Button } from "../ui/button";
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
import { useMutation } from "convex/react";
import { api } from "~/convex/_generated/api";
import { LoadingButton } from "../ui/loading-button";
import { getOrderState } from "./utils";
import { Separator } from "../ui/separator";
import { OrderSummary } from "./OrderSummary";

function OrderItem({ item, order }: { item: any; order: any }) {
  const [isUpdatingOrderItem, setIsUpdatingOrderItem] = useState(false);

  const updateOrderItem = useMutation(api.storeFront.onlineOrderItem.update);

  const returnItemToStock = useMutation(
    api.storeFront.onlineOrder.returnItemsToStock
  );

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

  const isPickup = order.deliveryMethod == "pickup";

  const readyText = isPickup ? "Ready for pickup" : "Ready for delivery";

  const {
    isOrderOpen,
    isOrderReady,
    isPartiallyRefunded,
    hasOrderTransitioned,
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
          <img
            src={item.productImage}
            alt={item.productName || "product image"}
            className="w-40 h-40 aspect-square object-cover rounded-lg"
          />
        ) : (
          <div className="w-40 h-40 bg-gray-100 rounded-lg" />
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
          <p className="text-xs text-muted-foreground">{`x${item.quantity}`}</p>
        </Link>

        <div className="space-y-2">
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

              {/* <Button className="text-red-700" variant="outline">
                <Ban className="h-4 w-4 mr-2" />
                Unavailable
              </Button> */}
            </div>
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

  // console.log(order);

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
      price: formatter.format(item.price),
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
