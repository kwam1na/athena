import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { useProduct } from "~/src/contexts/ProductContext";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import {
  ChartNoAxesColumn,
  Clock,
  ClockAlert,
  ClockArrowUp,
  Eye,
  TrendingUp,
  Users,
} from "lucide-react";
import useGetActiveProduct from "~/src/hooks/useGetActiveProduct";
import { getRelativeTime } from "~/src/lib/utils";
import { FadeIn } from "../common/FadeIn";
import { Skeleton } from "../ui/skeleton";

export const AnalyticsInsights = () => {
  const { activeStore } = useGetActiveStore();
  const { activeProductVariant } = useProduct();
  const { activeProduct } = useGetActiveProduct();

  const analytics = useQuery(
    api.storeFront.analytics.getAll,
    activeStore?._id
      ? {
          storeId: activeStore._id,
          action: "viewed_product",
          productId: activeProduct?._id,
        }
      : "skip",
  );

  if (!activeStore || !analytics || !activeProduct || !activeProductVariant)
    return null;

  // Filter analytics for this product and SKU
  const productAnalytics = analytics.filter(
    (analytic) => analytic.data.productSku === activeProductVariant.sku,
  );

  // Calculate metrics
  const totalViews = productAnalytics.length;

  const uniqueUsers = new Set(
    productAnalytics.map((analytic) => analytic.storeFrontUserId),
  ).size;

  const lastViewed = productAnalytics.sort(
    (a, b) => b._creationTime - a._creationTime,
  )[0]?._creationTime;

  return (
    <FadeIn className="space-y-8">
      <div className="flex items-center gap-2">
        <ChartNoAxesColumn className="w-4 h-4 text-muted-foreground" />
        <h3 className="font-medium text-muted-foreground">Analytics</h3>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-4">
          <div className="flex flex-row items-center gap-4 space-y-0 pb-2">
            <p className="text-sm text-muted-foreground">Total Views</p>
            <Eye className="h-4 w-4 text-muted-foreground" />
          </div>
          <div>
            <div className="text-xl font-bold">{totalViews}</div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex flex-row items-center gap-4 space-y-0 pb-2">
            <p className="text-sm text-muted-foreground">Unique Viewers</p>
            <Users className="h-4 w-4 text-muted-foreground" />
          </div>
          <div>
            <div className="text-xl font-bold">{uniqueUsers}</div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex flex-row items-center gap-4 space-y-0 pb-2">
            <p className="text-sm text-muted-foreground">Last Viewed</p>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </div>
          <div>
            <div className="pt-2 text-sm">
              {lastViewed ? (
                <div className="text-muted-foreground">
                  {getRelativeTime(lastViewed)}
                </div>
              ) : (
                <div className="text-muted-foreground">No views yet</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </FadeIn>
  );
};
