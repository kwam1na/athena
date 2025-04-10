import {
  Link,
  useNavigate,
  useParams,
  useSearch,
} from "@tanstack/react-router";
import PageHeader from "../common/PageHeader";
import View from "../View";
import { Button } from "../ui/button";
import { ArrowLeftIcon, Clock, User } from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import { Id } from "~/convex/_generated/dataModel";
import { BagItem } from "~/types";
import { getProductName } from "~/src/lib/productUtils";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import {
  capitalizeFirstLetter,
  currencyFormatter,
  getRelativeTime,
} from "~/src/lib/utils";

const Header = () => {
  const { o } = useSearch({ strict: false });

  const navigate = useNavigate();

  const handleBackClick = () => {
    if (o) {
      navigate({ to: o });
    } else {
      navigate({
        to: `/$orgUrlSlug/store/$storeUrlSlug/bags`,
        params: (prev) => ({
          ...prev,
          storeUrlSlug: prev.storeUrlSlug!,
          orgUrlSlug: prev.orgUrlSlug!,
        }),
      });
    }
  };

  return (
    <PageHeader>
      <div className="flex items-center gap-4">
        <Button
          onClick={handleBackClick}
          variant="ghost"
          className="h-8 px-2 lg:px-3 "
        >
          <ArrowLeftIcon className="h-4 w-4" />
        </Button>
        <p className="text-sm">Bag details</p>
      </div>
    </PageHeader>
  );
};

const BagItemView = ({ item }: { item: BagItem }) => {
  return (
    <Link
      to="/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug"
      params={(prev) => ({
        ...prev,
        orgUrlSlug: prev.orgUrlSlug!,
        storeUrlSlug: prev.storeUrlSlug!,
        productSlug: item.productId,
      })}
      search={{ variant: item.productSku }}
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

        <p className="text-sm">{getProductName(item)}</p>
      </div>
    </Link>
  );
};

export const BagView = () => {
  const { bagId } = useParams({ strict: false });

  const { activeStore } = useGetActiveStore();

  const bag = useQuery(
    api.storeFront.bag.getById,
    bagId ? { id: bagId as Id<"bag"> } : "skip"
  );

  if (!bag || !activeStore) return null;

  const bagTotal = bag.items.reduce(
    (acc: any, item: any) => acc + item.price * item.quantity,
    0
  );

  const formatter = currencyFormatter(activeStore.currency);

  return (
    <View header={<Header />}>
      <div className="container mx-auto h-full w-full p-8 space-y-12">
        <div className="grid grid-cols-2 gap-8">
          <div className="space-y-8">
            {bag.items.map((item: any) => (
              <BagItemView key={item._id} item={item} />
            ))}
          </div>

          <div className="space-y-8">
            <div className="space-y-2">
              <div className="flex items-center gap-1">
                <p className="text-sm text-muted-foreground">Total</p>
              </div>
              <p className="text-sm">{formatter.format(bagTotal)}</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex items-center gap-1">
                  <p className="text-sm text-muted-foreground">Created</p>
                </div>
                <p className="text-sm">
                  {capitalizeFirstLetter(getRelativeTime(bag._creationTime))}
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-1">
                  <p className="text-sm text-muted-foreground">Updated</p>
                </div>
                <p className="text-sm">
                  {capitalizeFirstLetter(getRelativeTime(bag.updatedAt))}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <User className="w-4 h-4" />
              <p className="text-sm">
                {`User-${bag.storeFrontUserId.slice(-5)}`}
              </p>
            </div>
          </div>
        </div>
      </div>
    </View>
  );
};
