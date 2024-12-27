import { Ban, Check, Hand, StopCircle, XCircle } from "lucide-react";
import View from "../View";
import { Button } from "../ui/button";
import { useOnlineOrder } from "~/src/contexts/OnlineOrderContext";
import { getProductName } from "~/src/lib/productUtils";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { currencyFormatter } from "~/src/lib/utils";
import placeholder from "~/src/assets/placeholder.png";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "~/convex/_generated/api";
import { LoadingButton } from "../ui/loading-button";
import { HandIcon } from "@radix-ui/react-icons";

function OrderItem({ item }: { item: any }) {
  const [isUpdatingOrderItem, setIsUpdatingOrderItem] = useState(false);

  const updateOrderItem = useMutation(api.storeFront.onlineOrderItem.update);

  const { order } = useOnlineOrder();

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

  return (
    <div className="flex gap-4">
      <Link
        to="/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug"
        params={(prev) => ({
          ...prev,
          orgUrlSlug: prev.orgUrlSlug!,
          storeUrlSlug: prev.storeUrlSlug!,
          productSlug: item.productId,
        })}
      >
        <img
          src={item.productImage || placeholder}
          alt={item.productName || "product image"}
          className="w-40 h-40 aspect-square object-cover rounded-lg"
        />
      </Link>
      <div className="space-y-8">
        <div className="space-y-2">
          <p className="text-sm">{getProductName(item)}</p>
          <p className="text-sm text-muted-foreground">{item.price}</p>
          <p className="text-xs text-muted-foreground">{`x${item.quantity}`}</p>
        </div>

        {order?.status == "open" && (
          <div className="flex items-center gap-4">
            {!item?.isReady && (
              <LoadingButton
                isLoading={isUpdatingOrderItem}
                onClick={() => handleUpdateOrderItem(true)}
                variant="outline"
              >
                <Check className="h-4 w-4 mr-2" />
                Ready
              </LoadingButton>
            )}

            {item?.isReady && (
              <LoadingButton
                isLoading={isUpdatingOrderItem}
                onClick={() => handleUpdateOrderItem(false)}
                variant="outline"
              >
                <XCircle className="h-4 w-4 mr-2" />
                Not ready
              </LoadingButton>
            )}

            <Button className="text-red-700" variant="outline">
              <Ban className="h-4 w-4 mr-2" />
              Unavailable
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export function OrderItemsView() {
  const { order } = useOnlineOrder();

  const { activeStore } = useGetActiveStore();

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

  const itemsTotal =
    order?.items?.reduce(
      (acc: number, item: any) => acc + item.price * item.quantity,
      0
    ) || 0;

  return (
    <View
      className="h-auto w-full"
      header={
        <div className="flex gap-8">
          <p className="text-sm text-sm text-muted-foreground">
            {itemsCount > 1 ? `${itemsCount} items` : `${itemsCount} item`}
          </p>
          {/* <p className="text-sm text-sm text-muted-foreground">|</p>
          <p className="text-sm text-sm text-muted-foreground">
            {formatter.format(itemsTotal)}
          </p> */}
        </div>
      }
    >
      <div className="p-8 space-y-16">
        {itemsFormatted?.map((item: any) => (
          <OrderItem key={item._id} item={item} />
        ))}
      </div>
    </View>
  );
}
