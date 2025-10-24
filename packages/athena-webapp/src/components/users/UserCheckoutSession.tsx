import { useParams } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import { Id } from "~/convex/_generated/dataModel";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import {
  capitalizeFirstLetter,
  currencyFormatter,
  getRelativeTime,
  getTimeRemaining,
} from "~/src/lib/utils";
import { BagItemView } from "../user-bags/BagView";
import { Badge } from "../ui/badge";
import {
  formatDeliveryAddress,
  getDiscountValue,
  getOrderAmount,
} from "~/convex/inventory/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import { Info, Store, Truck } from "lucide-react";
import { Address, CheckoutSession } from "~/types";

export const UserCheckoutSession = ({
  checkoutSession,
}: {
  checkoutSession?: CheckoutSession;
}) => {
  const { userId } = useParams({ strict: false });

  const bag = useQuery(
    api.storeFront.bag.getByUserId,
    userId ? { storeFrontUserId: userId as Id<"storeFrontUser"> } : "skip"
  );

  const { activeStore } = useGetActiveStore();

  if (!activeStore) return null;

  const formatter = currencyFormatter(activeStore.currency);

  if (!checkoutSession)
    return (
      <div className="space-y-8">
        <p className="text-sm font-medium">Checkout</p>
        <p className="text-sm text-muted-foreground">
          This user has no active checkout session.
        </p>
      </div>
    );

  const items =
    bag?.items?.map((item: any) => ({
      productSkuId: item.productSkuId,
      quantity: item.quantity,
      price: item.price || 0,
    })) || [];

  const orderAmount = getOrderAmount({
    items,
    discount: checkoutSession.discount,
    deliveryFee: checkoutSession.deliveryFee || 0,
    subtotal: checkoutSession.amount,
  });

  const discount = getDiscountValue(items, checkoutSession.discount);

  const startedAt = getRelativeTime(checkoutSession._creationTime);
  const expiresAt = checkoutSession.expiresAt
    ? getTimeRemaining(checkoutSession.expiresAt)
    : undefined;

  const hasExpired =
    checkoutSession.expiresAt && checkoutSession.expiresAt < Date.now();

  const { addressLine, country } = formatDeliveryAddress(
    checkoutSession.deliveryDetails as Address
  );

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-8">
        <div className="flex items-center gap-4">
          <p className="text-sm font-medium">Checkout</p>
          <Badge
            variant="outline"
            className="border-green-700 text-green-700 animate-pulse"
          >
            {checkoutSession.isFinalizingPayment
              ? "Finalizing payment"
              : "Active"}
          </Badge>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1">
            <p className="text-sm text-muted-foreground">Started</p>
            <p className="text-sm">{capitalizeFirstLetter(startedAt)}</p>
          </div>

          {expiresAt && (
            <>
              <p className="text-xs text-muted-foreground">·</p>

              <div className="flex items-center gap-1">
                <p className="text-sm text-muted-foreground">
                  {hasExpired ? "Expired" : "Expires"}
                </p>
                {!hasExpired && (
                  <p className="text-sm">{capitalizeFirstLetter(expiresAt)}</p>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="space-y-12">
        <div className="space-y-4">
          {bag?.items && bag?.items?.length > 0 && (
            <p className="text-sm font-medium">Items</p>
          )}

          <div className="space-y-8">
            {bag?.items &&
              bag?.items.map((item: any) => (
                <BagItemView key={item._id} item={item} formatter={formatter} />
              ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <p className="text-sm text-muted-foreground">Order total</p>
          <p className="text-sm">{formatter.format(orderAmount / 100)}</p>
          <TooltipProvider>
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <button className="outline-none">
                  <Info className="h-4 w-4 text-muted-foreground hover:text-foreground transition-colors" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="w-64 p-4" align="start">
                <div className="space-y-3">
                  <p className="text-sm font-medium">Order breakdown</p>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-muted-foreground">Subtotal</p>
                      <p className="text-sm">
                        {formatter.format(checkoutSession.amount / 100)}
                      </p>
                    </div>
                    {discount > 0 && (
                      <div className="flex items-center justify-between">
                        <p className="text-sm text-muted-foreground">
                          Discount
                        </p>
                        <p className="text-sm text-green-600">
                          - {formatter.format(discount / 100)}
                        </p>
                      </div>
                    )}
                    {checkoutSession.deliveryFee && (
                      <div className="flex items-center justify-between">
                        <p className="text-sm text-muted-foreground">
                          Delivery fee
                        </p>
                        <p className="text-sm">
                          {formatter.format(checkoutSession.deliveryFee)}
                        </p>
                      </div>
                    )}
                    <div className="pt-2 flex items-center justify-between">
                      <p className="text-sm font-medium">Total</p>
                      <p className="text-sm font-medium">
                        {formatter.format(orderAmount / 100)}
                      </p>
                    </div>
                  </div>
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        <div className="space-y-4">
          {checkoutSession.deliveryMethod === "delivery" && (
            <>
              <div className="flex items-center gap-2">
                <Truck className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Delivery to</p>
              </div>

              <div className="space-y-1">
                <p className="text-sm">{addressLine}</p>
                <p className="text-sm">{country}</p>
              </div>
            </>
          )}

          {checkoutSession.deliveryMethod === "pickup" && (
            <>
              <div className="flex items-center gap-2">
                <Store className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Store pickup</p>
              </div>

              <div className="space-y-1">
                <p className="text-sm">Wigclub Hair Studio</p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );

  // return <BagDetails bag={bag} />;
};
