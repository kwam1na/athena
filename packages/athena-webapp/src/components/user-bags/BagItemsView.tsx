import { useQuery } from "convex/react";
import View from "../View";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { api } from "~/convex/_generated/api";
import { currencyFormatter } from "~/src/lib/utils";
import { BagItem } from "~/types";
import BagItems from "./BagItems";
import Bags from "./Bags";
import { FadeIn } from "../common/FadeIn";

export default function BagItemsView() {
  const { activeStore } = useGetActiveStore();

  const bags = useQuery(
    api.storeFront.bagItem.getBagItemsForStore,
    activeStore?._id ? { storeId: activeStore._id, cursor: null } : "skip"
  );

  if (!activeStore || !bags) return null;

  const formatter = currencyFormatter(activeStore.currency);

  const Navigation = () => {
    return (
      <div className="container mx-auto flex gap-2 h-[40px]">
        <div className="flex items-center">
          <p className="text-3xl font-medium">User bags</p>
        </div>
      </div>
    );
  };

  const hasBagItems = bags.length > 0;

  // const items = bags
  //   .flatMap((bag) => bag.items)
  //   .sort((a, b) => b._creationTime - a._creationTime);

  const data = bags
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((bag) => ({
      ...bag,
      totalValue: bag.items.reduce(
        (acc: any, item: any) => acc + item.price * item.quantity,
        0
      ),
      total: formatter.format(
        bag.items.reduce(
          (acc: any, item: any) => acc + item.price * item.quantity,
          0
        )
      ),
    }));

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      className="bg-background"
      header={hasBagItems && <Navigation />}
    >
      <FadeIn>
        <Bags />
      </FadeIn>
    </View>
  );
}
