import { useQuery } from "convex/react";
import useGetActiveStore from "../../hooks/useGetActiveStore";
import View from "../View";

import { BestSellers } from "./BestSellers";
import { FeaturedSection } from "./FeaturedSection";
import { api } from "~/convex/_generated/api";
import { EmptyState } from "../states/empty/empty-state";
import { Clapperboard, Info, Store, TvMinimalPlay, Video } from "lucide-react";
import { ShopLookSection } from "./ShopLook";
import { FadeIn } from "../common/FadeIn";
import { LandingPageReelVersion } from "./LandingPageReelVersion";

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
        <p className="text-xl font-medium">Homepage</p>
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
      <FadeIn>
        {hasProducts && (
          <div className="container mx-auto space-y-8 py-8">
            <div className="space-y-4">
              <div className="w-[228px]">
                <LandingPageReelVersion />
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <TvMinimalPlay className="h-4 w-4" />
                <p className="text-sm">
                  This is the video that loops on the landing page
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-40">
              <BestSellers />
              <FeaturedSection />
              <ShopLookSection />
            </div>
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
      </FadeIn>
    </View>
  );
}
