import { useQuery } from "convex/react";
import View from "../View";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { api } from "~/convex/_generated/api";
import AnalyticsItems from "./AnalyticsItems";
import AnalyticsProducts from "./AnalyticsProducts";
import { FadeIn } from "../common/FadeIn";
import StoreInsights from "./StoreInsights";
import { formatNumber } from "../../utils/formatNumber";

const StoreVisitors = () => {
  const { activeStore } = useGetActiveStore();

  const lifetimeVisitors = useQuery(
    api.storeFront.guest.getUniqueVisitors,
    activeStore?._id ? { storeId: activeStore._id } : "skip"
  );

  const uniqueVisitorsToday = useQuery(
    api.storeFront.guest.getUniqueVisitorsForDay,
    activeStore?._id ? { storeId: activeStore._id } : "skip"
  );

  return (
    <div className="flex items-center gap-16 border rounded-lg p-4">
      <div className="space-y-4">
        <p className="font-medium text-2xl">
          {formatNumber(uniqueVisitorsToday)}
        </p>
        <p className="text-sm text-muted-foreground">
          {uniqueVisitorsToday === 1
            ? "Unique visitor today"
            : "Unique visitors today"}
        </p>
      </div>

      <div className="space-y-4">
        <p className="font-medium text-2xl">{formatNumber(lifetimeVisitors)}</p>
        <p className="text-sm text-muted-foreground">Lifetime visitors</p>
      </div>
    </div>
  );
};

export default function AnalyticsView() {
  const { activeStore } = useGetActiveStore();

  const analytics = useQuery(
    api.storeFront.analytics.getAll,
    activeStore?._id ? { storeId: activeStore._id } : "skip"
  );

  if (!activeStore || !analytics) return null;

  const Navigation = () => {
    return (
      <div className="container mx-auto flex gap-2 h-[40px]">
        <div className="flex items-center">
          <p className="text-xl font-medium">Analytics</p>
        </div>
      </div>
    );
  };

  const items = analytics.sort((a, b) => b._creationTime - a._creationTime);

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      className="bg-background"
      header={<Navigation />}
    >
      <FadeIn className="space-y-8 py-8">
        <div className="flex items-start gap-16">
          <StoreInsights storeId={activeStore._id} />
          <StoreVisitors />
        </div>
        <div className="grid grid-cols-2 gap-16">
          <AnalyticsProducts items={items} />
          <AnalyticsItems items={items} />
        </div>
      </FadeIn>
    </View>
  );
}
