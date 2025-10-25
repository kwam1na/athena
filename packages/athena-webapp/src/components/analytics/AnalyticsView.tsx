import { useState } from "react";
import { useQuery } from "convex/react";
import View from "../View";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { api } from "~/convex/_generated/api";
import AnalyticsItems from "./AnalyticsItems";
import AnalyticsProducts from "./AnalyticsProducts";
import { FadeIn } from "../common/FadeIn";
import { formatNumber } from "../../utils/formatNumber";
import { Button } from "../ui/button";
import AnalyticsCombinedUsers from "./AnalyticsCombinedUsers";
import { Link } from "@tanstack/react-router";

const StoreVisitors = () => {
  const { activeStore } = useGetActiveStore();

  const uniqueVisitorsToday = useQuery(
    api.storeFront.guest.getUniqueVisitorsForDay,
    activeStore?._id ? { storeId: activeStore._id } : "skip"
  );

  // if (!activeStore) return null;

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
    </div>
  );
};

const ActiveCheckoutSessions = () => {
  const { activeStore } = useGetActiveStore();

  const activeCheckoutSessions = useQuery(
    api.storeFront.checkoutSession.getActiveCheckoutSessionsForStore,
    activeStore?._id ? { storeId: activeStore._id } : "skip"
  );

  // if (!activeCheckoutSessions) return null;

  return (
    <div className="flex items-center gap-16 border rounded-lg p-4">
      <div className="space-y-2">
        <div className="flex base justify-between">
          <p className="font-medium text-2xl">
            {activeCheckoutSessions?.length}
          </p>
          <Link
            to="/$orgUrlSlug/store/$storeUrlSlug/checkout-sessions"
            params={(p) => ({
              ...p,
              orgUrlSlug: p.orgUrlSlug!,
              storeUrlSlug: p.storeUrlSlug!,
            })}
          >
            <Button variant="link" className="p-0">
              View all
            </Button>
          </Link>
        </div>
        <p className="text-sm text-muted-foreground">
          {activeCheckoutSessions?.length === 1
            ? "Active checkout session"
            : "Active checkout sessions"}
        </p>
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

  const items = analytics?.sort((a, b) => b._creationTime - a._creationTime);

  if (!activeStore || !analytics || !items) return null;

  const Navigation = () => {
    return (
      <div className="container mx-auto flex justify-between items-center h-[40px]">
        <div className="flex items-center">
          <p className="text-xl font-medium">Analytics</p>
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
            <div className="grid grid-cols-2 gap-4">
              <ActiveCheckoutSessions />
              <StoreVisitors />
            </div>
          </div>
        </div>
        <div className="space-y-16">
          <AnalyticsCombinedUsers items={items} />
          <div className="grid grid-cols-2 gap-16">
            <AnalyticsProducts items={items} />
            <AnalyticsItems items={items} />
          </div>
        </div>
      </FadeIn>
    </View>
  );
}
