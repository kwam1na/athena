import { useQuery } from "convex/react";
import View from "../View";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { api } from "~/convex/_generated/api";
import AnalyticsItems from "./AnalyticsItems";
import { AnalyticsChart } from "./chart";
import { Analytic } from "~/types";
import { AnalyticsProductsTable } from "./analytics-products-table/data-table";
import AnalyticsProducts from "./AnalyticsProducts";

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
          <p className="text-3xl font-medium">Analytics</p>
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
      <div className="grid grid-cols-2 gap-16">
        <AnalyticsProducts items={items} />
        <AnalyticsItems items={items} />
      </div>
    </View>
  );
}
