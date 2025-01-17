import { useQuery } from "convex/react";
import useGetActiveStore from "../../hooks/useGetActiveStore";
import View from "../View";

import { BestSellers } from "./BestSellers";
import { FeaturedSection } from "./FeaturedSection";
import { api } from "~/convex/_generated/api";
import { EmptyState } from "../states/empty/empty-state";
import { Store } from "lucide-react";

export default function Home() {
  const { activeStore } = useGetActiveStore();

  const products = useQuery(
    api.inventory.products.getAll,
    activeStore?._id ? { storeId: activeStore._id } : "skip"
  );

  if (!activeStore || !products) return null;

  const Navigation = () => {
    return (
      <div className="container mx-auto flex gap-2 h-[40px]">
        <p className="text-3xl font-medium text-muted-foreground">Homepage</p>
      </div>
    );
  };

  const hasProducts = products.length > 0;

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      className="bg-background"
      header={hasProducts && <Navigation />}
    >
      {hasProducts && (
        <div className="container mx-auto grid grid-cols-2 gap-40">
          <BestSellers />
          <FeaturedSection />
        </div>
      )}

      {!hasProducts && (
        <div className="container mx-auto">
          <EmptyState
            icon={<Store className="w-16 h-16 text-muted-foreground" />}
            text={
              <div className="flex gap-1 text-sm">
                <p className="text-muted-foreground">No products found in</p>
                <p className="font-medium">{activeStore.name}</p>
              </div>
            }
          />
        </div>
      )}
    </View>
  );
}
