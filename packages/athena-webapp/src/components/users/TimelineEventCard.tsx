import { Monitor, Smartphone } from "lucide-react";
import {
  capitalizeFirstLetter,
  getRelativeTime,
  slugToWords,
  snakeCaseToWords,
} from "~/src/lib/utils";
import { EnrichedTimelineEvent } from "~/src/lib/timelineUtils";
import { Badge } from "../ui/badge";
import { Card, CardContent } from "../ui/card";
import { Button } from "../ui/button";
import { ChevronDown } from "lucide-react";
import React from "react";
import { useGetCurrencyFormatter } from "~/src/hooks/useGetCurrencyFormatter";
import { Link } from "@tanstack/react-router";
import { getOrigin } from "~/src/lib/navigationUtils";

interface TimelineEventCardProps {
  event: EnrichedTimelineEvent;
  showGrouping?: boolean;
}

export function TimelineEventCard({
  event,
  showGrouping = false,
}: TimelineEventCardProps) {
  const IconComponent = event.icon;
  const isProductView = event.action.includes("viewed_");
  const isBagAction =
    event.action === "added_product_to_bag" ||
    event.action === "removed_product_from_bag";
  const isSavedAction =
    event.action === "added_product_to_saved" ||
    event.action === "removed_product_from_saved";
  const showProductDetails = isProductView || isBagAction || isSavedAction;

  const currencyFormatter = useGetCurrencyFormatter();

  // Priority styling
  const priorityStyles = {
    high: "border-l-red-500 hover:border-l-red-600 bg-red-50/30",
    medium: "border-l-orange-400 hover:border-l-orange-500 bg-orange-50/30",
    low: "border-l-gray-200 hover:border-l-blue-300",
  };

  const priorityBorder = priorityStyles.low;

  return (
    <Card
      className={`relative border-l-4 transition-colors duration-200 ${priorityBorder}`}
    >
      <CardContent className="p-4">
        <div className="flex items-start space-x-4">
          {/* Icon Circle */}
          <div
            className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${event.color}`}
          >
            <IconComponent className="w-5 h-5" />
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            {/* Header with Action and Time */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center space-x-2">
                <h3 className="text-sm font-medium text-gray-900">
                  {capitalizeFirstLetter(event.title)}
                </h3>
                {/* <Badge variant="secondary" className="text-xs">
                  {event.category}
                </Badge> */}
              </div>
              <span className="text-xs text-gray-500">
                {getRelativeTime(event._creationTime)}
              </span>
            </div>

            {/* Product Information - Only shown for viewed_product */}
            {showProductDetails && event.productInfo && (
              <Link
                to="/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug"
                params={(p) => ({
                  ...p,
                  orgUrlSlug: p.orgUrlSlug!,
                  storeUrlSlug: p.storeUrlSlug!,
                  productSlug: event?.data.product!,
                })}
                search={{
                  o: getOrigin(),
                  variant: event.data.productSku,
                }}
                className="flex items-center space-x-3 mb-3 p-2 bg-gray-50 rounded-lg"
              >
                {event.productInfo.images?.[0] && (
                  <img
                    src={event.productInfo.images[0]}
                    alt={event.productInfo.name || "Product"}
                    className="w-12 h-12 rounded object-cover"
                  />
                )}
                <div className="flex-1 min-w-0">
                  {event.productInfo.name && (
                    <p className="text-sm font-medium text-gray-900 truncate capitalize">
                      {event.productInfo.name}
                    </p>
                  )}
                  <div className="flex items-center space-x-2 mt-1">
                    {event.data.productSku && (
                      <span className="text-xs text-gray-500">
                        SKU: {event.data.productSku}
                      </span>
                    )}
                    {event.productInfo.price && event.productInfo.currency && (
                      <span className="text-xs font-medium text-green-600">
                        {currencyFormatter.format(event.productInfo.price)}
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            )}

            {/* Footer with Device and Email */}
            <div className="flex items-center justify-between text-xs text-gray-500">
              <div className="flex items-center space-x-3">
                <div className="flex items-center space-x-1">
                  {event.device === "desktop" && (
                    <Monitor className="w-3 h-3" />
                  )}
                  {event.device === "mobile" && (
                    <Smartphone className="w-3 h-3" />
                  )}
                  <span>{event.device || "unknown"}</span>
                </div>
                {event.origin && (
                  <div className="flex items-center space-x-1">
                    <span>•</span>
                    <span>
                      from{" "}
                      {capitalizeFirstLetter(snakeCaseToWords(event.origin))}
                    </span>
                  </div>
                )}
              </div>
              {event.userData?.email && (
                <span className="text-gray-400 truncate">
                  {event.userData.email}
                </span>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Timeline Event List Component
interface TimelineEventListProps {
  events: EnrichedTimelineEvent[];
  groupByDay?: boolean;
  sortDirection: "asc" | "desc";
}

export function TimelineEventList({
  events,
  groupByDay = false,
  sortDirection,
}: TimelineEventListProps) {
  const [visibleEvents, setVisibleEvents] = React.useState(10);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const loadMore = () => {
    setVisibleEvents((prev) => Math.min(prev + 10, events.length));
  };

  if (groupByDay) {
    // Group events by day
    const groupedEvents = events.reduce(
      (acc, event) => {
        const date = new Date(event._creationTime);
        const dayKey = date.toDateString();

        if (!acc[dayKey]) {
          acc[dayKey] = [];
        }
        acc[dayKey].push(event);

        return acc;
      },
      {} as Record<string, EnrichedTimelineEvent[]>
    );

    const sortedDays = Object.entries(groupedEvents)
      .sort(([a], [b]) => {
        if (sortDirection === "desc") {
          return new Date(b).getTime() - new Date(a).getTime();
        }
        return new Date(a).getTime() - new Date(b).getTime();
      })
      .slice(0, visibleEvents);

    return (
      <div className="space-y-4">
        <Card className="border border-gray-200 rounded-lg">
          <div
            ref={containerRef}
            className="space-y-6 max-h-[800px] overflow-y-auto p-4 scrollbar-thin scrollbar-thumb-gray-200 scrollbar-track-transparent"
          >
            {sortedDays.map(([day, dayEvents]) => (
              <div key={day} className="space-y-3">
                {/* Day Header */}
                <div className="sticky top-2 z-10">
                  <div className="flex justify-center">
                    <div className="inline-flex px-3 py-1 rounded-full bg-white shadow-sm ring-1 ring-gray-200">
                      <span className="text-sm font-medium text-gray-600">
                        {new Date(day).toLocaleDateString("en-US", {
                          weekday: "long",
                          year: "numeric",
                          month: "long",
                          day: "numeric",
                        })}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Events for this day */}
                <div className="space-y-3 mt-4">
                  {dayEvents
                    .sort((a, b) => {
                      if (sortDirection === "desc") {
                        return b._creationTime - a._creationTime;
                      }
                      return a._creationTime - b._creationTime;
                    })
                    .map((event) => (
                      <TimelineEventCard key={event._id} event={event} />
                    ))}
                </div>
              </div>
            ))}
          </div>

          {visibleEvents < Object.keys(groupedEvents).length && (
            <div className="flex justify-center p-4 border-t border-gray-100">
              <Button
                variant="outline"
                size="sm"
                onClick={loadMore}
                className="flex items-center space-x-2"
              >
                <ChevronDown className="w-4 h-4" />
                <span>Load More</span>
              </Button>
            </div>
          )}
        </Card>
      </div>
    );
  }

  const sortedEvents = [...events].sort((a, b) => {
    if (sortDirection === "desc") {
      return b._creationTime - a._creationTime;
    }
    return a._creationTime - b._creationTime;
  });

  const slicedEvents = sortedEvents.slice(0, visibleEvents);

  return (
    <div className="space-y-4">
      <Card className="border border-gray-200 rounded-lg">
        <div
          ref={containerRef}
          className="space-y-3 max-h-[600px] overflow-y-auto p-4 scrollbar-thin scrollbar-thumb-gray-200 scrollbar-track-transparent"
        >
          {slicedEvents.map((event) => (
            <TimelineEventCard key={event._id} event={event} />
          ))}
        </div>

        {visibleEvents < events.length && (
          <div className="flex justify-center p-4 border-t border-gray-100">
            <Button
              variant="outline"
              size="sm"
              onClick={loadMore}
              className="flex items-center space-x-2"
            >
              <ChevronDown className="w-4 h-4" />
              <span>Load More</span>
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
