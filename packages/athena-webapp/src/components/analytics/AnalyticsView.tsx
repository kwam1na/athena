import { useState } from "react";
import { useQuery } from "convex/react";
import View from "../View";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { api } from "~/convex/_generated/api";
import AnalyticsItems from "./AnalyticsItems";
import AnalyticsProducts from "./AnalyticsProducts";
import { FadeIn } from "../common/FadeIn";
import StoreInsights from "./StoreInsights";
import { formatNumber } from "../../utils/formatNumber";
import EnhancedAnalyticsView from "./EnhancedAnalyticsView";
import { Button } from "../ui/button";
import { BarChart3, List } from "lucide-react";

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

  // const returningVisitorsToday = useQuery(
  //   api.storeFront.guest.getReturningVisitorsForDay,
  //   activeStore?._id ? { storeId: activeStore._id } : "skip"
  // );

  return (
    <div className="flex items-center gap-16 border rounded-lg p-4">
      <div className="space-y-2">
        <p className="font-medium text-2xl">
          {formatNumber(uniqueVisitorsToday)}
        </p>
        <p className="text-sm text-muted-foreground">
          {uniqueVisitorsToday === 1
            ? "Unique visitor today"
            : "Unique visitors today"}
        </p>
      </div>

      {/* <div className="space-y-2">
        <p className="font-medium text-2xl">
          {formatNumber(returningVisitorsToday)}
        </p>
        <p className="text-sm text-muted-foreground">
          {returningVisitorsToday === 1
            ? "Returning visitor today"
            : "Returning visitors today"}
        </p>
      </div> */}

      <div className="space-y-2">
        <p className="font-medium text-2xl">{formatNumber(lifetimeVisitors)}</p>
        <p className="text-sm text-muted-foreground">Lifetime visitors</p>
      </div>
    </div>
  );
};

export default function AnalyticsView() {
  const { activeStore } = useGetActiveStore();
  const [viewMode, setViewMode] = useState<"enhanced" | "classic">("classic");

  const analytics = useQuery(
    api.storeFront.analytics.getAll,
    activeStore?._id ? { storeId: activeStore._id } : "skip"
  );

  if (!activeStore || !analytics) return null;

  const Navigation = () => {
    return (
      <div className="container mx-auto flex justify-between items-center h-[40px]">
        <div className="flex items-center">
          <p className="text-xl font-medium">Analytics</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={viewMode === "enhanced" ? "default" : "outline"}
            size="sm"
            onClick={() => setViewMode("enhanced")}
            className="flex items-center gap-1"
            disabled={true}
          >
            <BarChart3 className="h-4 w-4" />
            Enhanced
          </Button>
          <Button
            variant={viewMode === "classic" ? "default" : "outline"}
            size="sm"
            onClick={() => setViewMode("classic")}
            className="flex items-center gap-1"
          >
            <List className="h-4 w-4" />
            Classic
          </Button>
        </div>
      </div>
    );
  };

  // Enhanced view
  // if (viewMode === "enhanced") {
  //   return (
  //     <View
  //       hideBorder
  //       hideHeaderBottomBorder
  //       className="bg-background"
  //       header={<Navigation />}
  //     >
  //       <EnhancedAnalyticsView />
  //     </View>
  //   );
  // }

  // Classic view
  const items = analytics.sort((a, b) => b._creationTime - a._creationTime);

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      className="bg-background"
      header={<Navigation />}
    >
      <FadeIn className="space-y-8 py-8">
        <div className="flex">
          {/* <StoreInsights storeId={activeStore._id} /> */}
          <div className="ml-auto">
            <StoreVisitors />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-16">
          <AnalyticsProducts items={items} />
          <AnalyticsItems items={items} />
        </div>
      </FadeIn>
    </View>
  );
}
