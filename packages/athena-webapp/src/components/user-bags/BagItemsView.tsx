import { useQuery } from "convex/react";
import View from "../View";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { api } from "~/convex/_generated/api";
import { currencyFormatter } from "~/src/lib/utils";
import { BagItem } from "~/types";
import BagItems from "./BagItems";

export default function BagItemsView() {
  const { activeStore } = useGetActiveStore();

  const bags = useQuery(
    api.storeFront.bagItem.getBagItemsForStore,
    activeStore?._id ? { storeId: activeStore._id } : "skip"
  );

  if (!activeStore || !bags) return null;

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

  const items = bags
    .flatMap((bag) => bag.items)
    .sort((a, b) => b._creationTime - a._creationTime);

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      className="bg-background"
      header={hasBagItems && <Navigation />}
    >
      <BagItems items={items} />
    </View>
  );
}
