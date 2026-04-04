import React from "react";
import { ChevronDown } from "lucide-react";
import { getRelativeTime } from "~/src/lib/utils";
import {
  formatObservabilityLabel,
  getDeviceIcon,
  getObservabilityStatusStyles,
  type CustomerObservabilityTimelineEvent,
} from "~/src/lib/customerObservabilityTimeline";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent } from "../ui/card";
import { useGetCurrencyFormatter } from "~/src/hooks/useGetCurrencyFormatter";
import { toDisplayAmount } from "~/convex/lib/currency";
import { Link } from "@tanstack/react-router";
import { getOrigin } from "~/src/lib/navigationUtils";

interface TimelineEventCardProps {
  event: CustomerObservabilityTimelineEvent;
}

export function TimelineEventCard({ event }: TimelineEventCardProps) {
  const statusStyles = getObservabilityStatusStyles(event.status);
  const IconComponent = statusStyles.icon;
  const DeviceIcon = getDeviceIcon(event.device);
  const productLabel = event.productInfo?.name ?? event.productSku;

  const formatter = useGetCurrencyFormatter();

  return (
    <Card
      className={`relative border-l-4 transition-colors duration-200 ${statusStyles.borderClassName}`}
    >
      <CardContent className="p-4">
        <div className="flex items-start space-x-4">
          <div
            className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full ${statusStyles.badgeClassName}`}
          >
            <IconComponent className="h-5 w-5" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="mb-2 flex items-start justify-between gap-4">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">
                    {formatObservabilityLabel(event.journey)}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={statusStyles.badgeClassName}
                  >
                    {formatObservabilityLabel(event.status)}
                  </Badge>
                </div>

                <h4 className="text-sm font-medium text-gray-900">
                  {formatObservabilityLabel(event.step)}
                </h4>
              </div>

              <span className="whitespace-nowrap text-xs text-gray-500">
                {getRelativeTime(event._creationTime)}
              </span>
            </div>

            {productLabel && (
              <p className="flex gap-4 mb-3 rounded-lg bg-muted/40 px-3 py-2 text-sm text-gray-700">
                <Link
                  to="/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug"
                  params={(prev) => ({
                    ...prev,
                    orgUrlSlug: prev.orgUrlSlug!,
                    storeUrlSlug: prev.storeUrlSlug!,
                    productSlug: event.productId!,
                  })}
                  search={{ variant: event.productSku!, o: getOrigin() }}
                  className="flex items-center gap-4"
                >
                  <img
                    src={event.productInfo?.images?.[0]}
                    alt={event.productInfo?.name || "product image"}
                    className="w-16 h-16 aspect-square object-cover rounded-lg"
                  />
                  <div className="space-y-2">
                    <p className="text-sm font-medium capitalize">
                      {productLabel}
                    </p>
                    <p className="text-xs font-medium">
                      {formatter.format(
                        toDisplayAmount(event.productInfo?.price || 0),
                      )}
                    </p>
                  </div>
                </Link>
              </p>
            )}

            <div className="flex flex-col gap-2 text-xs text-gray-500">
              {DeviceIcon && (
                <span className="inline-flex items-center gap-1 rounded-full px-2 py-1">
                  <DeviceIcon className="h-3 w-3" />
                  {event.device}
                </span>
              )}

              {/* <span className="inline-flex items-center gap-1 rounded-full bg-muted/40 px-2 py-1">
                Session {event.sessionId}
              </span> */}

              {event.route && event.step == "category_browse" && (
                <span className="inline-flex items-center gap-1 rounded-full px-2 py-1">
                  {event.route}
                </span>
              )}

              {event.origin && (
                <span className="inline-flex items-center gap-1 rounded-full px-2 py-1">
                  From {formatObservabilityLabel(event.origin)}
                </span>
              )}

              {/* {event.checkoutSessionId && (
                <span className="inline-flex items-center gap-1 rounded-full bg-muted/40 px-2 py-1">
                  Checkout {event.checkoutSessionId}
                </span>
              )}

              {event.orderId && (
                <span className="inline-flex items-center gap-1 rounded-full bg-muted/40 px-2 py-1">
                  Order {event.orderId}
                </span>
              )} */}
            </div>

            {(event.errorCategory || event.errorCode || event.errorMessage) && (
              <div className="mt-3 rounded-lg border border-dashed border-muted-foreground/20 bg-background/80 p-3 text-sm">
                <p className="font-medium text-gray-900">
                  {formatObservabilityLabel(event.errorCategory)}
                  {event.errorCode ? ` • ${event.errorCode}` : ""}
                </p>

                {event.errorMessage && (
                  <p className="mt-1 text-gray-600">{event.errorMessage}</p>
                )}
              </div>
            )}

            {event.userData?.email && (
              <div className="mt-3 text-xs text-gray-500">
                {event.userData.email}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface TimelineEventListProps {
  events: CustomerObservabilityTimelineEvent[];
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
    const groupedEvents = events.reduce(
      (acc, event) => {
        const dayKey = new Date(event._creationTime).toDateString();

        if (!acc[dayKey]) {
          acc[dayKey] = [];
        }

        acc[dayKey].push(event);
        return acc;
      },
      {} as Record<string, CustomerObservabilityTimelineEvent[]>,
    );

    const sortedDays = Object.entries(groupedEvents)
      .sort(([leftDay], [rightDay]) => {
        if (sortDirection === "desc") {
          return new Date(rightDay).getTime() - new Date(leftDay).getTime();
        }

        return new Date(leftDay).getTime() - new Date(rightDay).getTime();
      })
      .slice(0, visibleEvents);

    return (
      <div className="space-y-4">
        <div
          ref={containerRef}
          className="space-y-6 max-h-[800px] overflow-y-auto p-4 scrollbar-thin scrollbar-thumb-gray-200 scrollbar-track-transparent"
        >
          {sortedDays.map(([day, dayEvents]) => (
            <div key={day} className="space-y-3">
              <div className="sticky top-0 z-10">
                <div className="flex justify-center">
                  <div className="inline-flex rounded-full bg-white px-3 py-1 shadow-sm ring-1 ring-gray-200">
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

              <div className="mt-4 space-y-3">
                {dayEvents
                  .sort((left, right) => {
                    if (sortDirection === "desc") {
                      return right._creationTime - left._creationTime;
                    }

                    return left._creationTime - right._creationTime;
                  })
                  .map((event) => (
                    <TimelineEventCard key={event._id} event={event} />
                  ))}
              </div>
            </div>
          ))}
        </div>

        {visibleEvents < Object.keys(groupedEvents).length && (
          <div className="flex justify-center border-t border-gray-100 p-4">
            <Button
              variant="outline"
              size="sm"
              onClick={loadMore}
              className="flex items-center space-x-2"
            >
              <ChevronDown className="h-4 w-4" />
              <span>Load More</span>
            </Button>
          </div>
        )}
      </div>
    );
  }

  const sortedEvents = [...events].sort((left, right) => {
    if (sortDirection === "desc") {
      return right._creationTime - left._creationTime;
    }

    return left._creationTime - right._creationTime;
  });

  return (
    <div className="space-y-4">
      <div
        ref={containerRef}
        className="max-h-[800px] space-y-3 overflow-y-auto p-4 scrollbar-thin scrollbar-thumb-gray-200 scrollbar-track-transparent"
      >
        {sortedEvents.slice(0, visibleEvents).map((event) => (
          <TimelineEventCard key={event._id} event={event} />
        ))}
      </div>

      {visibleEvents < sortedEvents.length && (
        <div className="flex justify-center border-t border-gray-100 p-4">
          <Button
            variant="outline"
            size="sm"
            onClick={loadMore}
            className="flex items-center space-x-2"
          >
            <ChevronDown className="h-4 w-4" />
            <span>Load More</span>
          </Button>
        </div>
      )}
    </div>
  );
}
