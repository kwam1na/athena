import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import { Id } from "~/convex/_generated/dataModel";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Badge } from "../ui/badge";
import { Skeleton } from "../ui/skeleton";
import {
  Activity,
  Eye,
  ShoppingCart,
  CreditCard,
  Package,
  Monitor,
  Smartphone,
  User,
  Clock,
  MousePointerClick,
} from "lucide-react";
import {
  getRelativeTime,
  capitalizeFirstLetter,
  snakeCaseToWords,
} from "~/src/lib/utils";
import { useGetCurrencyFormatter } from "~/src/hooks/useGetCurrencyFormatter";
import { Link } from "@tanstack/react-router";
import { getOrigin } from "~/src/lib/navigationUtils";

interface ActivityTimelineProps {
  storeId: Id<"store">;
  timeRange?: "24h" | "7d" | "30d" | "all";
}

// Activity type mappings with icons and colors
const activityTypeMap: Record<
  string,
  {
    icon: React.ComponentType<{ className?: string }>;
    color: string;
    label: string;
  }
> = {
  viewed_product: {
    icon: Eye,
    color: "text-blue-600 bg-blue-50 border-blue-200",
    label: "Viewed Product",
  },
  added_product_to_bag: {
    icon: ShoppingCart,
    color: "text-green-600 bg-green-50 border-green-200",
    label: "Added to Cart",
  },
  removed_product_from_bag: {
    icon: ShoppingCart,
    color: "text-red-600 bg-red-50 border-red-200",
    label: "Removed from Cart",
  },
  initiated_checkout: {
    icon: CreditCard,
    color: "text-orange-600 bg-orange-50 border-orange-200",
    label: "Started Checkout",
  },
  completed_checkout: {
    icon: Package,
    color: "text-purple-600 bg-purple-50 border-purple-200",
    label: "Completed Purchase",
  },
  searched_products: {
    icon: Activity,
    color: "text-indigo-600 bg-indigo-50 border-indigo-200",
    label: "Searched",
  },
};

export function ActivityTimeline({
  storeId,
  timeRange = "24h",
}: ActivityTimelineProps) {
  const timeline = useQuery(api.storeFront.analytics.getStoreActivityTimeline, {
    storeId,
    timeRange,
    limit: 15,
  });

  const formatter = useGetCurrencyFormatter();

  if (!timeline) {
    return <TimelineSkeleton />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4" />
          Recent Activity
        </CardTitle>
      </CardHeader>
      <CardContent>
        {timeline.length > 0 ? (
          <div className="space-y-3 max-h-80 overflow-y-auto">
            {timeline.map((activity) => {
              const activityType = activityTypeMap[activity.action] || {
                icon: MousePointerClick,
                color: "text-gray-600 bg-gray-50 border-gray-200",
                label: capitalizeFirstLetter(
                  activity.action.replace(/_/g, " ")
                ),
              };

              const IconComponent = activityType.icon;

              return (
                <div
                  key={activity._id}
                  className="flex items-start gap-3 p-2 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  {/* Icon */}
                  <div
                    className={`flex-shrink-0 w-8 h-8 rounded-full border flex items-center justify-center ${activityType.color}`}
                  >
                    <IconComponent className="w-4 h-4" />
                  </div>

                  {/* Content */}
                  <Link
                    to="/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug"
                    params={(params) => ({
                      ...params,
                      orgUrlSlug: params.orgUrlSlug!,
                      storeUrlSlug: params.storeUrlSlug!,
                      productSlug: activity.data?.product!,
                    })}
                    search={{
                      o: getOrigin(),
                      variant: activity.data?.productSku,
                    }}
                    className="flex-1 min-w-0 space-y-2"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-gray-900">
                        {activityType.label}
                      </span>
                      <span className="text-xs text-gray-500">
                        {getRelativeTime(activity._creationTime)}
                      </span>
                    </div>

                    {/* Product info if available */}
                    {activity.productInfo?.name && (
                      <p className="text-xs text-gray-600 mb-1 truncate">
                        {capitalizeFirstLetter(activity.productInfo.name)}
                        {activity.productInfo.price && (
                          <span className="text-green-600 ml-1">
                            {formatter.format(activity.productInfo.price)}
                          </span>
                        )}
                      </p>
                    )}

                    {/* Search query if available */}
                    {activity.action === "searched_products" &&
                      activity.data.query && (
                        <p className="text-xs text-gray-600 mb-1">
                          "{activity.data.query}"
                        </p>
                      )}

                    {/* Footer with device and user info */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {activity.device && (
                          <div className="flex items-center gap-1">
                            {activity.device === "desktop" ? (
                              <Monitor className="w-3 h-3 text-gray-400" />
                            ) : (
                              <Smartphone className="w-3 h-3 text-gray-400" />
                            )}
                            <span className="text-xs text-gray-500">
                              {activity.device}
                            </span>
                          </div>
                        )}
                        {activity.origin && (
                          <p className="text-xs px-1 py-0">
                            from{" "}
                            {capitalizeFirstLetter(
                              snakeCaseToWords(activity.origin)
                            )}
                          </p>
                        )}
                      </div>
                      {activity.userData?.email && (
                        <span className="text-xs text-gray-400 truncate max-w-24">
                          {activity.userData.email}
                        </span>
                      )}
                    </div>
                  </Link>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <User className="w-8 h-8 text-gray-400 mb-2" />
            <p className="text-sm text-gray-500">No recent activity</p>
            <p className="text-xs text-gray-400">
              Activity will appear here as customers interact with your store
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TimelineSkeleton() {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Skeleton className="w-4 h-4" />
          <Skeleton className="h-4 w-24" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-start gap-3 p-2">
              <Skeleton className="w-8 h-8 rounded-full" />
              <div className="flex-1 space-y-2">
                <div className="flex justify-between items-center">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-3 w-12" />
                </div>
                <Skeleton className="h-3 w-32" />
                <div className="flex justify-between items-center">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
