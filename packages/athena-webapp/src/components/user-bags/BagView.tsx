import { Link, useParams } from "@tanstack/react-router";
import View from "../View";
import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import { Id } from "~/convex/_generated/dataModel";
import { Bag, BagItem, OnlineOrder, OnlineOrderItem } from "~/types";
import { getProductName } from "~/src/lib/productUtils";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import {
  capitalizeFirstLetter,
  cn,
  currencyFormatter,
  getRelativeTime,
} from "~/src/lib/utils";
import { getOrigin } from "~/src/lib/navigationUtils";
import { FadeIn } from "../common/FadeIn";
import { SimplePageHeader } from "../common/PageHeader";

const BagItemView = ({
  item,
  formatter,
}: {
  item: BagItem | OnlineOrderItem;
  formatter: Intl.NumberFormat;
}) => {
  return (
    <Link
      to="/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug"
      params={(prev) => ({
        ...prev,
        orgUrlSlug: prev.orgUrlSlug!,
        storeUrlSlug: prev.storeUrlSlug!,
        productSlug: item.productId,
      })}
      search={{ variant: item.productSku, o: getOrigin() }}
      className="flex items-center gap-4"
    >
      <div className="flex items-center gap-4">
        {item.productImage ? (
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
        ) : (
          <div className="w-24 h-24 bg-gray-100 rounded-lg" />
        )}

        <div className="space-y-2">
          <p className="text-sm">{getProductName(item)}</p>
          <p className="text-sm text-muted-foreground">
            {item.price === 0
              ? "Free"
              : formatter.format((item.price || 0) * item.quantity)}
          </p>
        </div>
      </div>
    </Link>
  );
};

export const BagDetails = ({
  className,
  bag,
}: {
  className?: string;
  bag: Bag | OnlineOrder;
}) => {
  const { activeStore } = useGetActiveStore();

  if (!activeStore) return null;

  const bagTotal = bag?.items?.reduce(
    (acc: any, item: any) => acc + item.price * item.quantity,
    0
  );

  const formatter = currencyFormatter(activeStore.currency);

  const createdAt = getRelativeTime(bag._creationTime);
  const updatedAt = bag.updatedAt ? getRelativeTime(bag.updatedAt) : undefined;

  return (
    <div
      className={cn("container mx-auto h-full w-full space-y-12", className)}
    >
      <div className="space-y-16">
        <div className="space-y-4">
          {bag.items && bag.items?.length > 0 && (
            <p className="text-sm font-medium">Items</p>
          )}

          <div className="space-y-8">
            {bag.items &&
              bag.items.map((item: any) => (
                <BagItemView key={item._id} item={item} formatter={formatter} />
              ))}
          </div>

          {bag.items && bag.items.length === 0 && (
            <p className="text-sm text-muted-foreground">
              This user's bag is empty.
            </p>
          )}
        </div>

        <div className="space-y-8">
          <p className="text-sm font-medium">Summary</p>

          <div className="flex items-center gap-8">
            {bagTotal > 0 && (
              <>
                <div className="flex items-center gap-2">
                  <p className="text-sm text-muted-foreground">Total</p>
                  <p className="text-sm">{formatter.format(bagTotal)}</p>
                </div>

                <p className="text-xs text-muted-foreground">·</p>
              </>
            )}

            <div className="flex items-center gap-1">
              <p className="text-sm text-muted-foreground">Created</p>
              <p className="text-sm">{capitalizeFirstLetter(createdAt)}</p>
              <p className="text-sm">by</p>
              <Link
                to="/$orgUrlSlug/store/$storeUrlSlug/users/$userId"
                params={(p) => ({
                  ...p,
                  storeUrlSlug: p.storeUrlSlug!,
                  orgUrlSlug: p.orgUrlSlug!,
                  userId: bag.storeFrontUserId,
                })}
                search={{ o: getOrigin() }}
                className="flex items-center gap-2"
              >
                <p className="text-sm">
                  {`User-${bag.storeFrontUserId.slice(-5)}`}
                </p>
              </Link>
            </div>

            {createdAt != updatedAt && updatedAt && (
              <>
                <p className="text-xs text-muted-foreground">·</p>

                <div className="flex items-center gap-1">
                  <p className="text-sm text-muted-foreground">Updated</p>
                  <p className="text-sm">{capitalizeFirstLetter(updatedAt)}</p>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export const BagView = () => {
  const { bagId } = useParams({ strict: false });

  const bag = useQuery(
    api.storeFront.bag.getById,
    bagId ? { id: bagId as Id<"bag"> } : "skip"
  );

  if (!bag) return null;

  return (
    <View header={<SimplePageHeader title="Bag details" />}>
      <FadeIn>
        <BagDetails className="p-8" bag={bag} />
      </FadeIn>
    </View>
  );
};
